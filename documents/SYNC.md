# Optional self-hosted sync

Stash is local-first. A new library stores notes in SQLite and does not contact a sync server. Sync stays inactive until a user explicitly saves both an HTTPS server URL and a device token under Settings → Sync. Saving the connection verifies the server identity but does not synchronize notes. Synchronization starts only when the user presses Sync.

The desktop app connects only to the HTTPS API. It never connects directly to PostgreSQL. The supplied server is a starting point for running one private library. Operators may replace the deployment layout, reverse proxy, and infrastructure as long as the API protocol remains compatible.

## What syncs

Ordinary notes, embedded data-URL images, notebooks and their hierarchy, body-derived tag indexes, notebook memberships, pin and Quick Access state, and Trash state sync. Folder-linked notes, local assets and paths, appearance, shortcuts, workspace tabs, and editor undo history stay on each device.

Each device has its own revocable bearer token. The server stores only the token's SHA-256 hash. macOS stores the token in Keychain, and Android stores it with Android Keystore. The server URL and remote library identity are stored in the local SQLite library. HTTPS certificate verification is required and redirects are not followed. This provides transport encryption, not end-to-end encrypted server storage.

After a connection is configured, one Sync action saves pending local edits, uploads queued operations, downloads remote changes, and applies them locally. Editing pauses during that operation. Failures leave local notes available and preserve the durable queue for a later retry.

## Server requirements

The reference deployment requires:

- A Linux host with Docker Engine and Docker Compose.
- An existing external Docker network connected to an HTTPS reverse proxy.
- A DNS name and valid HTTPS certificate for the API.
- A private environment file with a strong PostgreSQL password and deployment-specific values.
- Off-host backup storage if recovery from total server loss is required.

The database uses an internal Docker network and publishes no host port. Only the API joins the external proxy network. Configure the reverse proxy to send the chosen HTTPS origin, such as `https://stash.example.com`, to `stash-sync:8080` on that network.

## Configure and start the server

Build the Go binary and image from the `server` directory. Replace `<image-tag>` with an operator-selected immutable version:

```sh
cd server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o stash ./cmd/stash
docker build -t stash-sync:<image-tag> .
```

Copy `deploy/.env.example` to a private file outside the repository, then replace every placeholder. The systemd unit expects `/etc/stash/stash.env`:

```sh
sudo install -d -m 700 /etc/stash
sudo install -m 600 deploy/.env.example /etc/stash/stash.env
sudoedit /etc/stash/stash.env
```

Configuration values are required:

- `POSTGRES_PASSWORD`: a new strong database password.
- `STASH_VERSION`: the image tag built above.
- `STASH_PROXY_NETWORK`: the existing external Docker network used by the reverse proxy.
- `STASH_INSTALL_DIR`: the absolute directory containing `compose.yaml` and `backup.sh`.

Start the services with the private environment file. Replace `<deploy-directory>` with the same path used for `STASH_INSTALL_DIR`:

```sh
docker compose --env-file /etc/stash/stash.env -f <deploy-directory>/compose.yaml up -d
```

Keep the previous API image available before an upgrade and take a database backup first. Roll back the API image only when it is compatible with the current schema. Never downgrade PostgreSQL in place.

## Connect devices

Create a separate device token for each client:

```sh
docker compose --env-file /etc/stash/stash.env -f <deploy-directory>/compose.yaml \
  exec -T api /stash create-device DEVICE_NAME
```

The command prints the device ID and token once. Enter the HTTPS origin and token in the app's Sync settings. Do not put the token in logs, screenshots, source control, or command-line arguments.

Revoke a device when it should no longer have access:

```sh
docker compose --env-file /etc/stash/stash.env -f <deploy-directory>/compose.yaml \
  exec -T api /stash revoke-device DEVICE_ID
```

For trusted scripted macOS provisioning, close Stash and pass JSON containing `url` and `token` on standard input to the packaged executable with `--configure-sync`. It verifies the endpoint identity and stores the token in Keychain without starting a sync. Open the app and press Sync afterward.

## Backups and recovery

`backup.sh` resolves its deployment directory from the script location, creates a custom-format PostgreSQL dump, verifies that the dump can be listed, and retains seven days of completed local backups. A failed dump is not promoted to a completed backup.

Install `stash-backup.service` and `stash-backup.timer` under `/etc/systemd/system`, then enable the timer:

```sh
sudo install -m 644 deploy/stash-backup.service deploy/stash-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stash-backup.timer
```

Check backup runs with `systemctl status stash-backup.service` and `journalctl -u stash-backup.service`. Local dumps do not protect against total server loss. Copy backups to separate storage and verify restores in a separate database using `pg_restore --exit-on-error`. Never test a restore over the live library.

Sync checks the remote library identity before uploading. A different library or incompatible protocol fails closed. Switching a device to another library requires a separate local profile. Before restoring an older server backup, preserve unsynced client data and reconcile it instead of resetting client cursors or overwriting the live database without review.

## Protocol

The Go server provides `GET /healthz`, authenticated `GET /v1/info`, `POST /v1/push`, and `GET /v1/pull?after=N&target=M`.

Push accepts one note or notebook operation with a stable operation ID, base revision, deletion state, and record data. Reusing an operation ID with different content fails. Entity changes, operation receipts, change-log entries, and the library cursor commit in one PostgreSQL transaction.

Concurrent note changes keep the accepted server record and create one visible conflict copy of the incoming record. Concurrent notebook metadata changes retain the server version and produce a warning. Pull pages and checkpoints are durable, and downloaded records apply atomically only after the bounded cycle is complete.

## Verification

- Run `npm test` for frontend sync and recovery behavior.
- Run `cargo test --manifest-path src-tauri/Cargo.toml` for SQLite migration, queue, conflict, and interrupted-cycle behavior.
- In `server/`, run `TEST_DATABASE_URL=... go test -race ./...` against a dedicated disposable PostgreSQL database. These tests reset its public schema.
- Run `go vet ./...` in `server/`.
- Run `docker compose --env-file /etc/stash/stash.env -f <deploy-directory>/compose.yaml config` before starting or updating services.
- Confirm public `GET /healthz` returns 200 and unauthenticated `GET /v1/info` returns 401.
- Create two test devices against an isolated test library and verify upload, download, conflict handling, revocation, restart recovery, and a repeated no-op sync.
- Build the packaged app and confirm the connection survives an app restart without making Sync automatic.

The ignored Rust integration test `two_sqlite_clients_through_real_http_service` exercises two SQLite stores through a real Go service. Supply `STASH_SYNC_TEST_DEVICE_FILE`, optionally set `STASH_SYNC_TEST_URL`, and run it only against an isolated test service. Never point it at a personal library.
