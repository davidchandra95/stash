# Editor retention

Implemented October 9, 2026. Navigation keeps note content, selection, stored marks, find state, scroll, undo and redo. This policy manages session resources without changing the saved document format or the session-only undo contract.

## Policy

- Keep at most four recently used editor views after work settles. Suspend older edited editors using Tiptap unmount/mount, preserving their EditorState and history.
- Protect mounted consumers, including hidden PDF companions, and pending clipboard, image and drawing work. These can temporarily exceed the view budget. Async work belongs to the originating editor.
- Destroy unchanged, history-free editors when they leave the warm cache. Keep compact selection, marks, find/reveal and scroll state, then reconstruct from the current note model.
- Native saved-body cache: 32 notes or 32 MiB of estimated serialized body data, whichever is reached first. Calculate estimates at load/save boundaries, not on each edit. Drop full JSON, linked Markdown and comparison snapshots together, retaining summaries.
- Protect current/mounted notes, pending saves, failed saves, conflicts, recovery errors, unavailable sources, active reads and sessions with undo or redo. Compare editor content with the authoritative model before releasing it. A save receipt alone does not allow discarding undo.
- Reject late body reads after a revision, fingerprint, content or sync generation changes. Reload the current generation when needed.
- Keep browser-preview bodies because they are the only copy. Remove orphaned sessions and navigation state when library reconciliation removes notes.

Edited-session history remains in memory. There is no total byte/count cap across edited notes. Adding one requires a separate product decision about history storage or retention.

## Reproduction

Run `node scripts/profile-editor-retention.mjs [absolute-results-path.json]`. It starts a temporary Vite server on port 1446, disables HMR/file watching, uses a fresh headless Chromium context and fictional data, forces collection before samples, then closes the browser/server. It prints the result path. It never opens native storage. The script fails if settled view/body counts exceed the budgets or the edited session/remount probe loses its document, selection or undo.

The workload uses the actual session registry, writing extensions, React EditorContent mounts and LibraryStore with mocked persistence. Each body has 100 paragraphs, roughly 13 KB of text. Edited notes receive one undoable edit and a selection at position 4. The clean-note workload opens 10,000 fictional summaries and lazily loads their bodies, followed by 100 repeated switches.

October 9 run, Chromium 151.0.7922.34, development modules, heap after forced collection:

| Workload | JS heap MiB | DOM nodes | Event listeners | Live editors | Loaded bodies |
| --- | ---: | ---: | ---: | ---: | ---: |
| 200 edited notes, previous implementation | 53.06 | 41,620 | 14,359 | 200 | not included |
| 200 edited notes, new policy | 47.06 | 1,245 | 443 | 4 | not included |
| 1,000 clean saved notes | 22.42 | 853 | 443 | 4 | 32 |
| 10,000 clean saved notes | 24.18 | 853 | 443 | 4 | 32 |
| 100 further clean switches | 23.99 | 853 | 443 | 4 | 32 |

At 200 edited notes, document selectionchange listeners dropped from 601 to 13 and window resize listeners from 800 to 16. The first note retained its text, selection and undo. Remount no longer throws. Clean-note growth mainly retains compact session records and summaries. The previous baseline did not import LibraryStore, so heap totals are illustrative rather than a controlled total-app comparison. Retained edited states still hold lightweight editor objects and some detached elements; heavy views and their global listeners no longer accumulate with every edited note.

The saved reproduction script also instruments timers and observers. Its follow-up run passed all retention assertions: at 1,000 and 10,000 clean notes and after 100 more switches, it retained five MutationObservers (one baseline plus four views), four ResizeObservers, no IntersectionObservers, one baseline interval and no pending timeouts. DOM/listener counts stayed at 853/443. Instrumentation slightly changed heap samples to 22.48, 24.22 and 24.04 MiB respectively.

## Acceptance and limits

Focused tests cover StrictMode React switches, rich blocks/tables/lists/sections, drawings, Mermaid, Markdown, undo/redo, selection/marks/find/scroll, stale releases, delayed clipboard/image work, drawing leases, clean body eviction/reload, failed-save retry, mounted/history protection, byte limits, linked metadata saves and a late linked-file read after refresh. Existing storage, sync, conversion and navigation checks were also run. The production frontend build passes.

The isolated macOS release used identifier `local.upnote2.editor-lifecycle-review`, a separate empty SQLite library seeded with 10,000 fictional notes, and the shared working tree at build time. Native checks loaded notes, switched away from an edited note through 12 other notes, restored undo, repeated navigation, restored redo and quit normally. SQLite then held the synthetic edit at revision 4. The installed Stash application and its library were not replaced. This proves those native flows; it does not provide a controlled WebView heap profile or event-to-visible-paint latency measurements.

An unsigned Android arm64 release APK builds. It was not installed for device profiling. Android memory, device navigation and the proposed typing/switch latency targets remain unmeasured. Existing Gradle/Rust warnings and Vite large-chunk warnings were left unchanged.

The shared tree contains concurrent performance work. The latest full frontend run at this point passed 719 of 722 tests, with failures in the account-menu/header-menu Escape focus checks and a note-link navigation test that tries to click an asynchronous body-search result before it exists. Focused navigation checks had passed earlier. These unrelated failures were not changed by this task; full-suite green is not claimed.
