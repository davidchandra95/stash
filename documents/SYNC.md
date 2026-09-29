# Manual server sync

Stash keeps working offline in SQLite. The Sync button is the only trigger for network synchronization. PostgreSQL holds the shared library at `https://stash.slowtyper.cloud`; the Mac never connects directly to PostgreSQL.

## What syncs

Ordinary notes (including embedded data-URL images), notebooks and their hierarchy, body-derived tag indexes, memberships, pin/Quick Access state, and Trash state sync. Folder-linked notes, local assets and paths, appearance, shortcuts, workspace tabs, and editor undo history stay local. Changing an ordinary note into a folder-linked note removes its shared record, while preserving the local file. A local-only notebook shell is retained when necessary to preserve a linked note's membership after a remote notebook deletion.

There is one private library. Each device has its own revocable bearer token. The server stores only its SHA-256 hash. The Mac stores its token in Keychain, scoped to its local library identity. The URL and remote library identity are stored in SQLite. HTTPS certificate verification is required; redirects are not followed. This is transport encryption, not end-to-end encrypted server storage.

Connection settings are under Settings → Sync. On macOS, open the David account menu in the sidebar and choose Sync; first use opens that settings category. Saving a connection does not start a sync. Android keeps Sync in its navigation drawer and shows the last-sync time in the device’s local time using a 24-hour format. After connection, one click saves pending edits, uploads queued operations, downloads remote changes, and applies them locally. Editing is paused during that operation. On macOS, a failure appears in the workspace alert with a retry action. Local notes remain available and the durable sync cycle is ready for another click. If edits were made after a failed cycle, recovery preserves them and reports that another sync is needed.

## Protocol and recovery

The Go service provides `GET /healthz`, authenticated `GET /v1/info`, `POST /v1/push`, and `GET /v1/pull?after=N&target=M`.

Push accepts one operation: `operationId`, `kind` (`note` or `notebook`), `id`, `baseRevision`, `deleted`, and `data`. Records retain the native camelCase note/notebook shape. Notes require document format 1. Local note revisions and server revisions are independent. Each operation has a stable immutable payload and ID. A response includes the original operation ID, conflict information and the current canonical record. Reusing an operation ID with different content fails.

A library-row lock serializes PostgreSQL transactions. Entity changes, immutable change-log entries, operation receipts and the library cursor commit together, so a cursor never skips an uncommitted write. Pull pages contain at most 100 records, with a roughly 64 MiB data budget; a fixed target bounds each cycle. Requests are limited to 64 MiB. Oversized records fail visibly and remain queued. Tombstones and operation receipts are retained without automatic cleanup.

SQLite schema 7 adds a migration ledger for the body-owned tag upgrade. The existing tag field stays in the sync payload as a generated index, so the server API does not change. Schema 6 added transactional dirty tracking, per-record server revisions, a durable outbox, a staged inbox and cycle checkpoints. Existing version 5 and 6 libraries receive a consistent pre-upgrade backup. Changes are captured in immutable operations when a cycle begins. Page downloads and their checkpoint commit together. Once all pages arrive, records and the final cursor apply in one transaction. Changes made after a failed cycle are not overwritten by its download; their old server revision forces proper conflict handling on the following sync.

Concurrent note changes keep the accepted server record and create one visible conflict copy of the incoming record. Copies are placed outside Trash so recovered content is discoverable. A repeated request cannot create extra copies. Concurrent notebook metadata changes retain the server version and show a warning. Notebook deletion removes shared memberships, reparents surviving children, and retains note content. Deleted notebook IDs cannot be silently resurrected.

Sync checks the remote library identity before uploading. A different server library or incompatible protocol fails closed. Changing to another library requires a separate local profile. Restoring an older PostgreSQL backup is an operator recovery action: do not reset client cursors or overwrite the live database casually. Export/preserve unsynced client data and reconcile it before resuming.

## Server operations

The server runs from `/srv/stash` with a dedicated PostgreSQL volume and private database network. Only the API joins the existing Caddy network. Neither service publishes a host port. Existing Caddy terminates HTTPS and proxies `stash.slowtyper.cloud` to `stash-sync:8080`.

Build the Go binary for the server and the Docker image:

```sh
cd server
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o stash ./cmd/stash
docker build -t stash-sync:VERSION .
```

Keep `.env` owner-readable only, containing `POSTGRES_PASSWORD` and `STASH_VERSION`. `deploy/compose.yaml` is the deployment definition. Preserve the previous image tag and take a backup before upgrades. Roll back the API image only if compatible with the current schema. Never downgrade either database in place.

Create a device on the server:

```sh
cd /srv/stash
docker compose exec -T api /stash create-device DEVICE_NAME
```

This outputs a device ID and token once. Enter the token in Stash's connection settings. Do not put it in logs, screenshots, source control or command-line arguments. Revoke a device with:

```sh
docker compose exec -T api /stash revoke-device DEVICE_ID
```

For trusted scripted Mac provisioning, close Stash and pass JSON containing `url` and `token` on stdin to the packaged executable with `--configure-sync`. It verifies the endpoint identity and stores the token in Keychain, without syncing. This command uses the normal Mac library and refuses while it is open. Open the app and click Sync afterward.

`stash-backup.timer` runs a daily custom-format `pg_dump`, retaining seven days. Failed dumps are not promoted to completed backups. Check `systemctl status stash-backup.service` and `journalctl -u stash-backup.service`. Backups are local to the server and do not protect against total server loss. Verify restores in a separate database using `pg_restore --exit-on-error`; never test a restore over the live library.

## Verification

- `npm test`: frontend tests, including save-before-sync, blocked overlapping edits/quit, reload after sync and failure recovery.
- `cargo test --manifest-path src-tauri/Cargo.toml`: SQLite migration/backup, durable queue, interrupted cycles, local edit preservation, linked-folder exclusion, atomic apply and invalid cursor/document handling.
- In `server/`, `TEST_DATABASE_URL=... go test -race ./...` against a dedicated disposable PostgreSQL database. These tests reset its public schema. They cover two devices, conflict-copy retry, concurrent writes, pagination, notebook deletion, invalid/revoked tokens and database failure. `go vet ./...` checks the backend.
- The explicitly enabled Rust integration test `two_sqlite_clients_through_real_http_service` exercises two SQLite stores through the actual Go HTTP service, including restart and a committed upload with a lost response. Supply `STASH_SYNC_TEST_DEVICE_FILE` (device ID on line 1, token on line 2), optionally `STASH_SYNC_TEST_URL`, and run it with `-- --ignored` against an isolated test service. Do not point it at a personal library.
- `make release` builds the packaged Mac app. Native UI verification checks Sync in the account menu, the first-use connection dialog, progress/disabled editing, the failure alert and persistence after restart.

Existing Vite bundle-size warnings and the jsdom `scrollBy` warning are unrelated to sync.

## September 16, 2026 deployment verification

The live API runs as `stash-sync:20260916-2` on `69.161.221.169`, with version `20260916-1` retained. Public HTTPS `/healthz` returned 200; unauthenticated `/v1/info` returned 401. PostgreSQL has no public host port. Vaultwarden and Memos returned 200 and Karakeep retained its 307 redirect after the Caddy change.

The packaged release app was paired using Keychain and completed its first button-triggered sync: 15 ordinary notes and 3 notebooks on the server, 8 linked notes kept local. Restart retained the connection and last-sync time. A repeated sync left the server cursor at 18 with no duplicate records or pending uploads. The local schema-5 backup exists. A PostgreSQL dump containing the synced notes restored into a separate database with matching record counts. The daily backup timer is enabled.

Validation passed: 182 frontend tests, 47 regular Rust tests, the separately enabled two-SQLite-client HTTP integration test, 5 PostgreSQL-backed Go tests with the race detector, `go vet`, frontend build and packaged release build. The existing Rust crash helper is invoked by its parent test; the explicit HTTP integration test is excluded from the default Rust test run because it needs a dedicated service.
