# Android acceptance - 2026-09-17

## Delivered build

- Stash 0.1.0, package `local.upnote2.prototype`, ARM64, Android API 24 minimum / API 36 target.
- Self-contained debug APK: `.artifact-work/mobile/Stash-android-arm64-debug.apk`, 45.3 MiB.
- SHA-256: `a2aa179f85119ef6c053d1383b4ff6570549cd03e4db14b7d3a2ef9c37bb3ba3`.
- APK Signature Scheme v2 verification passed. Rust debug symbols were omitted; debug assertions and WebView inspection remain enabled.
- Final APK installed and launched from its embedded frontend at `http://tauri.localhost/`. No Vite connection was used.
- APK inspection confirmed only ARM64 native code, Stash icons, and no fixture CA or test network-security configuration.

## Automated checks

- Frontend: 212 tests passed across 34 files, including separate notebook expansion/navigation, direct-note filtering, search/scroll restoration, new-note title focus and Next, settings pages, failed-save navigation blocking, selection formatting/undo/redo, and immediate save scheduling with acknowledgement.
- Frontend TypeScript and production Vite build passed.
- Rust: 59 tests passed; two environment-dependent tests are ignored by the default run.
- The ignored `two_sqlite_clients_through_real_http_service` test was separately run and passed against a disposable PostgreSQL database and the existing Go sync service. It exercises two SQLite clients, conflicts, restart and lost-response retry.
- Android debug APK build passed.
- macOS `make release` passed and rebuilt `src-tauri/target/release/bundle/macos/Stash.app`. Shared desktop behavior is covered by the frontend/Rust suites.

## Pixel 8 API 35 emulator

Native checks used the installed APK on the available ARM64 Pixel emulator, including its older Android System WebView 124.

Passed:

- Empty-library startup, Stash branding, system-bar colors and inset handling.
- Notebook and child-notebook creation, independent drawer expansion and navigation, immediate children above direct notes, and new notes assigned to the current notebook.
- Settings category/detail/Back navigation; independent title-font changes persisted to SQLite and across restart. Folder-linking controls were absent.
- Existing notes opened with no focus or keyboard request. New notes focused the title; Next entered the body.
- Touch toolbar preserved the selected text. Bold, undo, redo, link editing, table insertion, image insertion/decoding, nested-list indent and outdent worked with the shared commands.
- Real Gboard text entry, synthetic composition events, long title wrapping and title resizing. Full acceptance with multiple language keyboards remains part of physical-device testing.
- Toolbar above the keyboard; final caret/paragraph visible. Portrait and landscape worked, including a compact landscape layout with a tall keyboard. Rotation settings were restored after testing.
- Android Back dismissed the keyboard first, then returned to the list. Back at a library root moved the task to the Android launcher after the save guard.
- A simulated failed native save response retained the draft, showed Retry, and blocked Back. Restoring the bridge and Retry saved the draft. This is bridge fault injection, not an actual full-disk test.
- Offline editing with the sync connection unavailable. A full acknowledged document, including rich content, and its SQLite revision survived backgrounding and forced process restart. Cold launch returned to All notes.
- Android encrypted token persisted across process restart. The token was absent from its ciphertext file in private `no_backup`. Direct frontend invocation of credential loading was denied by plugin permissions.
- Saving a connection did not sync. Manual sync exchanged notes with the isolated server, refreshed the library, and cleared pending operations.
- Android offline edits conflicting with another client were preserved as conflict copies. Dropping a response after the server committed it produced a recoverable error; Retry completed with no pending operations.
- Invalid credential ciphertext produced reconnection guidance without removing notes. Reconnecting replaced the invalid credential. A revoked server token was rejected with reconnection guidance.

The isolated HTTPS test build trusted only its explicit fixture CA. The delivered APK was rebuilt without that feature and reinstalled. All native test data belonged to this disposable emulator library. It was cleared after acceptance so the installed delivery app starts with an empty, unpaired library. The local test server and database were removed.

## Remaining checks and build warnings

- Physical-device acceptance is still pending. No physical Android device was available.
- The rebuilt macOS app's visual smoke check is pending: the computer-use tool reported that the Mac was locked. A passing build does not prove its packaged UI behavior.
- No iOS build or runtime acceptance was performed.
- Vite reports the existing large-chunk warning. Gradle reports deprecated build APIs. Both builds complete successfully; those unrelated warnings were not addressed in this mobile change.

Commands and architecture are documented in [Android development](ANDROID.md).
