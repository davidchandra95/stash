# Offline dictation

Dictation is available in the native macOS app. Click the microphone in the note toolbar, or assign **Dictate note** in Settings > Shortcuts. Settings > Editor > Dictation manages the speech model and language.

## Use

1. In Settings > Editor > Dictation, choose multilingual **Small** (default, 487,601,967 bytes) or **Base** (147,951,465 bytes), and Auto, English, or Bahasa Indonesia. Prefer an explicit language for short recordings and use one language per recording. Automatic detection is not reliable for mixed English-Indonesian speech.
2. Click the microphone. A floating bar opens and recording starts right away; allow microphone access when macOS asks. If the selected model is missing, the bar offers Download model and starts recording when it finishes. Download needs internet; later dictation does not.
3. Speak. Recording automatically stops at five minutes and goes to review.
4. Stop and review (the square, or the microphone or shortcut again) transcribes into a small text box where you can edit, Copy, or Dictate more, which appends another take. Insert into note (the arrow) inserts the text. Clicking the arrow while recording transcribes and inserts in one step.

Text is inserted at the note's cursor as it is at that moment, without replacing a selection or interpreting Markdown/HTML. Undo removes the insertion as one step. The note stays editable while the bar is open. Cancel or Escape stops the operation; Discard closes review without editing the note. Cancelling a Dictate more take returns to the existing text. If the original note disappears or becomes read-only, insertion is refused and Copy remains available. If another note is showing, the bar names the note it inserts into. Recording uses the system's default microphone. Change the input in macOS Sound settings before starting.

Permission errors point to System Settings > Privacy & Security > Microphone. Disconnecting the microphone or a transcription failure leaves the note unchanged. Corrupt models must be removed and downloaded again. There is no cloud fallback, translation, rewriting, audio attachment, live partial transcript, or Android/browser recording.

## Ownership and privacy

The Rust worker owns microphone capture (CPAL), mono conversion and 16 kHz resampling (Rubato), and inference (`whisper-rs` / `whisper.cpp`, Metal enabled). One worker operation can run at a time. Capture holds at most five minutes of mono samples at the device rate; audio never crosses the frontend bridge and is never written to disk. Only one loudness value per 100 ms (`dictation-level`) reaches the frontend, to draw the waveform. Audio and model contexts are released when inference finishes or is cancelled. Transcript text remains in memory during review, and becomes ordinary saved/synced note content only when inserted. Copy transcript explicitly writes it to the system clipboard.

Whisper/GGML logging hooks discard native logs because debug output can contain decoded text. The app does not log recordings or transcripts. Only the ignored synthetic-fixture test prints its synthetic transcript.

Models live in the app's local data directory under `dictation-models`, outside note attachments and sync. Debug builds with `UPNOTE2_DATA_DIR` use that isolated directory. Preferences use the device-local `stash.dictation.v1` key and do not sync.

Downloads use the `ggerganov/whisper.cpp` model repository at revision `5359861c739e955e79d9a303bcbc70fb988958b1`. They are streamed into a partial file with cancellation, timeouts, a size bound, and SHA-256 verification before rename. The selected file is verified again before recording.

| File | SHA-256 |
| --- | --- |
| `ggml-small.bin` | `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` |
| `ggml-base.bin` | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` |

The native bridge provides status, download, delete-model, start, stop, and cancel commands under `dictation_*`. Progress/completion uses `dictation-progress`; the frontend also polls status to recover missed events. Each operation has a caller-generated session ID. Stop/cancel and frontend completion handling are scoped to that session. Cancel retains the worker reservation until resources have been released. Quit paths cancel active work.

## Validation, 2026-11-03

- Frontend suite: 103 files, 969 tests passed, including literal insertion, original-note targeting, changed/read-only/destroyed editors, undo/redo, and preference validation.
- Native dictation tests: model allowlist/integrity, corrupt file rejection, cancellation during verification, one-worker ownership, stale stop/cancel, clearing retained transcripts, stalled-network cancellation, and resampling duration.
- Isolated Playwright suite: download/record/review/edit/insert/undo/redo, changed-note refusal, permission error and cancellation, and screenshots of Native/Workspace themes in light/dark at 1280x800 and 900x650. Native operations are mocked in these UI tests.
- Frontend production build and Android ARM64 Rust cross-check passed. Existing bundle-size and Android warnings are separate from this feature. `npm ci` reported 10 existing dependency vulnerabilities (4 low, 2 moderate, 3 high, 1 critical); no dependency-audit remediation was included.
- Real Metal inference was run with downloaded, checksum-verified Base and Small models and synthetic macOS English and Indonesian voices. Small reproduced both single-language samples correctly with explicit language selection and Auto. Base misspelled `catatan` and `proyek` in the Indonesian sample. Warm-run inference including model loading was approximately 0.3 seconds for Base and 0.7 seconds for Small on this Mac, using 5.24-second English and 7.80-second Indonesian clips. Initial Metal compilation took longer. These are tiny synthetic checks, not a general speed or accuracy benchmark.
- A 13.03-second English-then-Indonesian synthetic clip in Auto mode omitted the English portion with both models. This remains a known model limitation, including after removing an extra segment filter. Review the transcript and use separate recordings for each language.
- Native preview: the bundled app opened with an isolated test library, exposed the dictation dialog, recognized the preloaded Small model, and downloaded Base through the actual native command. The downloaded file matched the pinned checksum. The microphone usage description is present in the bundle.
- Live microphone permission, physical-device capture/disconnection, and accuracy with the user's real speech still need hands-on acceptance. No recording of the user's voice was made during these checks.

Run checks:

```sh
npm test
npm run build
npx playwright test --config playwright.dictation.config.ts
CARGO_BUILD_JOBS=2 cargo test --manifest-path src-tauri/Cargo.toml dictation:: --lib
```

The UI suite uses port 1428 and refuses an existing server, so it cannot silently test another worktree. Its screenshots and traces are in `.artifact-work/dictation-ui`.

For the ignored real-model smoke test, provide `STASH_DICTATION_TEST_MODEL` (model file), `STASH_DICTATION_TEST_AUDIO` (16 kHz mono float32 little-endian PCM), `STASH_DICTATION_TEST_LANGUAGE` (`en`, `id`, or `auto`), and optionally `STASH_DICTATION_TEST_EXPECT` (a required substring). Run the `dictation::native::transcribe_fixture` test with `--ignored --nocapture`. Use synthetic or explicitly consented recordings; its output includes the transcript.

A separate ad-hoc-signed debug preview was built at `src-tauri/target/debug/bundle/macos/Stash Dictation Preview.app` with identifier `local.upnote2.dictation-validation`. It does not replace `/Applications/Stash.app`. Its current test session uses `UPNOTE2_DATA_DIR=/tmp/stash-dictation-preview`; a normal launch without that variable uses the preview identifier's own app data directory. This is a local preview, not a notarized release.

## Main worktree integration, 2026-11-03

After the user tested the preview, dictation was integrated into `/Users/slowtyper/code/upnote2` on its existing `claude/sync-desktop-android` branch as uncommitted changes. Existing activity-rail/calendar edits and newer Android/Sepia changes were preserved. Cargo regenerated the lockfile while retaining the existing calendar dependencies.

The main worktree's frontend build, Rust check, five native dictation tests, four focused dictation editor tests, and all seven dictation Playwright tests passed. The real-model fixture test remains opt-in and was not rerun for this integration. The raw full frontend run reported 1,839 passing tests and three failing settings assertions that still expect only Light/Dark/Auto instead of including Sepia. Those same three assertions fail in an isolated copy of the pre-integration files. The raw runner also discovers a Node-test prototype inside `.claude/worktrees/serene-edison-19baaa` and reports no Vitest suite there. These existing test issues were left unchanged.

## Floating bar rework, 2026-11-03

The modal dialog was replaced by the floating recording and review bar, and model and language choices moved to Settings only. The dictation Playwright suite (13 tests, native operations mocked, Native/Workspace in light/dark at 1280x800 and 900x650), focused unit tests, frontend build and five native dictation tests passed. The live level event has not yet been checked with a real microphone in the native app.
