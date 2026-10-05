# Offline storage

## Editable drawings

Ordinary notes can contain Excalidraw drawing blocks. Each block stores its own ID, format version, scene elements, canvas background/grid settings, embedded image files, content revision, and a cached PNG preview with its source revision. Scenes use the existing note JSON, SQLite transaction, retry, and save-before-quit paths. No database migration is needed. Drawing insertion/deletion participates in note undo; edits inside an open canvas use Excalidraw's own undo history, which does not survive closing the canvas.

Scene changes enter the save queue synchronously. Preview rendering is separate, throttled, and limited to a 1,600-pixel long edge. Late results apply only to the matching block and scene revision. Flush participants finish previews before the save queue drains; a narrowly scoped cache update can finish during sync/quit while user editing is frozen. Preview failure retains the scene and shows a placeholder instead of an outdated image. Saved is still shown only after the storage queue succeeds. Browser preview remains session-only.

Malformed and unknown drawing versions remain in the document unchanged and display an error placeholder. Older clients reject unknown drawing nodes when opening the note. Keep all editing clients updated before using drawings. Ordinary note duplication and internal rich clipboard paste copy scene data with fresh block IDs. External HTML and linked-Markdown paste receive a preview image; plain-text paste receives a drawing label. A private clipboard MIME type carries the scene. If a WebView strips that type, an opaque HTML token can recover the most recent copy within the same running Stash session, without embedding scene data in external HTML. Linked-folder conversion refuses editable drawings.

The first version supports desktop editing and Android viewing. Raster images (PNG, JPEG, GIF, WebP) can be embedded in a scene. Drawing files, online libraries, collaboration, external embeds, and searching text inside drawings are outside this version. Fonts ship locally and Excalidraw loads only when opening the desktop canvas. Dependency overrides pin patched transitive dependencies required by the stable Excalidraw package.

Run `npx vitest run src/drawing`, `npx playwright test --config playwright.drawing.config.ts`, and the Rust storage tests for focused verification. The browser test blocks external requests and covers canvas editing, preview export, Escape handling, and portrait/landscape mobile viewing.

October 4, 2026 drawing verification:

- All 19 focused drawing tests pass, including stale preview completion, save failure/retry, quit flushing, deletion undo, duplication, clipboard event routing, malformed data preservation, and Markdown rejection. The final full frontend run passed 540 of 541 tests; the existing Account menu keyboard-focus test failed. An earlier run also exposed the existing header-actions focus test failing intermittently. Neither unrelated focus behavior was changed.
- Both browser tests pass. They cover actual canvas editing with an embedded PNG, local-only requests, theme/palette and app-style combinations at 900px and 1,280px desktop widths, keyboard focus/Escape, and portrait/landscape mobile previews. Android behavior was checked in the mobile browser preview, not on an Android device.
- The production frontend build and isolated macOS debug app build pass. The Rust suite passed 79 tests, with its two existing ignored entries. PostgreSQL-backed server tests, including drawing sync/conflict-copy round trips, pass with the race detector; `go vet ./...` also passes.
- The isolated native app uses `local.upnote2.drawing-review`. Native checks confirmed insertion, editable copy/paste with a fresh block ID, Enter to reopen, and immediate edit-then-Cmd+Q recovery. After restart, the canvas and SQLite retained both shapes with a matching preview revision. The normal installed Stash app and its library were not replaced.
- Vite still reports large chunks, including the lazy Excalidraw canvas bundle. The dependency audit retains the pre-existing low-severity DOMPurify advisory; no new moderate/high advisories remain from this integration.

Implemented September 9, 2026. This replaces the native app's session-only prototype storage. The browser preview remains temporary and does not access the Mac library.

## Storage and ownership

The native app opens `~/Library/Application Support/local.upnote2.prototype/library.sqlite3`. The application identifier is deliberately unchanged so later app updates use the same library. A fresh library starts empty. **Add sample notes** explicitly adds fictional examples when the library is empty; personal UpNote data is not imported.

React/Tiptap owns immediate editing, selection and session undo. The TypeScript library controller holds pending changes and loads full documents on demand. Rust owns SQLite access, schema migration, transaction boundaries and revision checks. Note summaries include derived text and task flags so navigation does not load all rich documents. Indexed search remains phase 4.

SQLite runs in WAL mode with `synchronous=FULL`, foreign keys and a three-second busy timeout. Blocking database work runs outside the UI thread. A process-held file lock protects the library, and the Tauri single-instance plugin focuses the running app on a second launch.

The original schema version 1 stores:

- Notes: separate title, JSON body, document format version, plain text, task flag, notebook, pinned state, trash timestamp, creation/update timestamps, revision and last operation ID.
- A derived hashtag index in a separate association table. Tags belong to note body text, not manual header metadata.
- Notebooks and appearance settings, including theme, fonts, note size and percentage width.

The first migration creates the schema transactionally. Unknown, newer or corrupt libraries fail visibly and are not replaced with an empty database. Schema version 2 adds saved workspace tabs. Schema version 3 replaces the single notebook column with `note_notebooks` memberships and adds an independent `quick_access` flag. Schema version 4 adds notebook parents and linked-folder metadata. Schema version 5 adds a persisted built-in notebook icon, defaulting existing rows to `notebook`. Before upgrading an existing version 1, 2, 3, or 4 library, SQLite creates a consistent `VACUUM INTO` backup under the library’s `backups/` directory and syncs it to disk. Backup failure stops opening; migration failure rolls back all schema changes. Existing notebook assignments and linked-folder metadata are preserved. Older app versions reject version 5 libraries; downgrading requires restoring the complete pre-upgrade backup with the app closed, losing changes made since that backup. Full backup/restore and note history remain phase 5.

## Autosave contract

Editing updates the controller synchronously. Disk writes run after a 350 ms pause, or within two seconds during continuous typing. Explicit note switches, app focus loss and normal quit flush pending jobs sooner. The UI reports **Saving**, **Saved on this Mac**, or **Couldn't save**; Saved is shown only after all pending database writes have been acknowledged.

Writes are serialized. Each job captures immutable content and a unique operation ID. The expected revision is chosen when that job starts. A failed job is retained unchanged, including its operation ID, while newer edits wait behind it. This makes retry safe when a commit succeeds but its response is interrupted. A revision conflict fails rather than overwriting a newer version. Notebook/settings changes are written before dependent notes.

Quit waits for the queue. On failure, the window stays open with **Retry and quit** and **Keep editing**. On macOS the predefined Quit menu calls AppKit's `terminate:` directly, bypassing Tauri's ExitRequested event. `macos_quit.rs` adds the optional `applicationShouldTerminate:` delegate veto to route Cmd+Q, menu and Dock termination into the save handshake. It does not replace any existing delegate method; if Tao later supplies one, startup fails until the integration is reviewed. Window close and Tauri exit requests use the same handshake.

Force Quit, power loss and WebView crashes can lose changes still marked Saving. Previously committed data remains the recovery point. Session undo does not survive restart. Do not manually copy only the live `.sqlite3` file as a backup: WAL may contain committed changes.

## Images and other scope limits

Managed attachment storage is phase 3. Existing embedded data-URL images are included in the saved JSON as-is; there is no attachment directory, deduplication or garbage collection yet. No account, sync service, encryption layer, permanent deletion UI, indexed search, backup UI or revision history was added. Database notebooks can be deleted from their menu. The delete operation can promote children or remove the full subtree, keep notes, or move notes to recoverable Trash. Folder-linked notebooks cannot be deleted.

The previous prototype's in-memory changes cannot be automatically recovered after that old process exits. The old prototype window was kept open during implementation. The new native library starts separately from those transient sample edits.

## Verification

- Frontend tests cover coalescing, continuous typing deadlines, in-flight edits, failed-save retention, exact operation retries, revision ordering, lazy note loading, startup errors, save-before-quit, notebook menus, metadata editing, icon and color selection, child promotion, and delete choices.
- Rust tests cover real database reopen, notebook/settings/tag/trash persistence, metadata-only updates, icon migration and persistence, ordinary and linked metadata edits, subtree deletion, child promotion, shared memberships, recoverable linked-file Trash moves, idempotency, stale revisions, failed transactions, read-only failures, process locking and corrupt/newer database rejection.
- A child-process test terminates a writer with an uncommitted transaction and verifies that reopening retains only committed data. The ignored `crash_writer_helper` test is invoked by that parent test; it is not a skipped acceptance check.
- An isolated packaged **Upnote2 Storage Review** app uses `local.upnote2.storage-review`, keeping native test data away from the real library. Native checks confirmed the persistent note body, checklist, pin and Catppuccin setting after restart. An external SQLite write lock caused a save failure; Cmd+Q stayed open, Retry and quit succeeded after the lock was released, and reopening retained the pending text. An immediate type-then-Cmd+Q test also retained the final input after restart.
- Native checks also confirmed separate note bodies, notebook assignments and tags after switching notes and restarting. Closing the window immediately after typing preserved the final text. Launching a second process exited successfully and kept the existing window.
- Final validation: 51 frontend tests and 10 Rust tests passed, and the normal macOS app bundle built successfully. Vite still reports the existing large JavaScript chunk warning; bundle splitting is outside these storage phases.

Run:

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --bundles app
```

Debug builds alone accept `UPNOTE2_DATA_DIR` for isolated failure tests. Release builds always resolve Tauri's app data directory.

## Note context menu verification

The note-row context menu and titlebar actions share handlers. Notebook dialogs apply changes explicitly; creating a notebook inside a picker persists that notebook even if assignment is cancelled. Hashtags are parsed from the body and Ctrl/Cmd-click opens their tag view while an ordinary click edits text. Copying uses `upnote2://note/<id>` links within the current library, without registering an external URL handler. Duplication loads the complete document before creating a copy; loading does not replace newer summary metadata or save revisions.

September 9, 2026 verification: frontend regression tests cover note actions, pickers, keyboard opening, clipboard failures, reference paste and lazy duplication. Rust tests cover version 1/2 upgrades, readable backups, backup failure, migration rollback, multiple memberships, Quick Access, metadata-only writes and restart persistence. An isolated `local.upnote2.context-review` native app confirmed adding a second notebook to an unopened note, native clipboard copy/paste and link navigation, and notebook/Quick Access persistence after quit and reopen. Browser visual checks covered light/dark menus and the notebook picker. The existing Vite large-chunk warning remains.

## Folder-linked Markdown notebooks and notebook metadata (schema 5)

September 16, 2026: Schema 4 adds notebook parents, registered linked roots, file mappings, source fingerprints and cached Markdown, pending conflict drafts, and a durable filesystem operation journal. Schema 5 adds the persisted built-in notebook icon. Existing notes and linked-folder metadata remain database-backed. Upgrading an existing version 1, 2, 3, or 4 library uses the same synced SQLite backup before the transaction. A failed migration leaves the old schema intact. Older app builds reject a version 5 library; restoring a pre-upgrade backup requires closing Stash first.

Linked Markdown is the content source of truth. SQLite stores app metadata and cached source for unavailable files. Import, open, pin, and ordinary collection assignments do not rewrite Markdown. Existing manual tags are migrated into a `Tags: #example` Markdown paragraph through the normal guarded file journal. Content edits may normalize supported Markdown, while preserved source sections and newline conventions are retained.

Rust validates paths against registered roots, skips symbolic links, checks the content fingerprint before a file change, and journals file replacements before execution. On macOS, synced staging files use atomic swap or exclusive rename. Displaced bytes are checked after replacement. Unsupported filesystems report an error; there is no unsafe replacement fallback. Recovery replays completed steps by their recorded bytes, never replacing an unexpected newer file. Empty child folders use staged directories with recorded filesystem identities.

Saved includes the required file and database acknowledgments. Conflicting notes retain a durable draft and block quit; unrelated notes can still save. Resolve with the current disk version, a new copy, or explicit overwrite. Missing files are cached read-only and are not recreated automatically. Trash stores Markdown under application data in `file-trash/`; original paths and memberships are kept for restore. Assets remain beside their original notes and are not automatically deleted.

See [Folder notebooks](FOLDER_NOTEBOOKS.md) for supported Markdown, refresh behavior, tests, and remaining native validation.

## Manual sync (schema 6)

Schema 6 adds durable manual synchronization with PostgreSQL through an authenticated HTTPS API. Existing version 5 libraries receive a consistent pre-upgrade backup. Local saves remain authoritative for offline editing; synced state and local-save revisions are separate. See [Manual sync](SYNC.md) for scope, conflict handling, recovery, device tokens and verification. Earlier no-sync statements above describe the original storage release.
