# PDF viewer handoff

Created: 2026-10-04
Workspace: `/Users/slowtyper/code/upnote2`

Implementation follow-up: the standalone viewer is implemented. See [PDF_VIEWER.md](PDF_VIEWER.md) for the final storage model, behavior, validation, and remaining scope. The handoff below records the earlier planning context.

## Goal and current status

Build a PDF viewer in Stash that can later connect to notes. The user's original request was: "can i add a pdf viewer that later will be integrated with our note?"

This handoff is based on a read-only code inspection and a discussion of the recommended approach. At the time this handoff was written, no PDF implementation or dependency installation had been done. The user requested this handoff for another agent. The details below are recommended implementation defaults, not a record of separately approved product decisions.

Deliver the standalone viewer and its storage foundation first. Later note integration should reuse the same document identity, navigation, and rendering APIs.

## Read first

1. Read `AGENTS.md`, `DESIGN.md`, and `/Users/slowtyper/.codex/OPINIONS.md`. Preserve existing working-tree changes. Leave new work unstaged; the user has not authorized branches, commits, pushes, or pull requests.
2. Inspect the code pointers below before choosing the implementation. Existing documents describe earlier releases, so current code is the source of truth for schema versions and behavior.
3. Record the chosen document storage, tab model, reading-position format, and supported platforms in a short implementation note. Resolve routine implementation choices directly; raise a question only for a material change to this scope.

## First delivery

Recommended platform scope: native desktop persistence, with a browser preview for viewer validation. Keep the viewer reusable on mobile; full Android file import is later work. Preserve existing mobile note behavior.

- Provide a clear **Open PDF** action using the native file picker. Opening imports a managed copy, so the viewer remains usable after the original download is moved or removed. Provide a simple way to reopen imported PDFs after their tabs are closed, without redesigning the note sidebar.
- Open PDFs in dedicated workspace tabs. Show the filename or document title, support switching and closing, and restore saved PDF tabs at restart. Existing note tabs, preview tabs, navigation history, and unsaved edits must continue working.
- Provide continuous page scrolling, current page and page count, jump to page, zoom in/out, and fit to width.
- Support text selection and copy, plus in-document search with next/previous results. Scanned PDFs without embedded text still render; explain when no searchable text is available. OCR is later work.
- Remember the reading position and zoom per document. Restore the position correctly after reopening and after changes in window size.
- Show loading and useful error states. Handle invalid files, unreadable files, missing managed copies, and encrypted PDFs. For the first delivery, either support a password prompt or clearly report that password-protected files are unsupported; document the chosen behavior.
- Bundle the renderer and worker for offline use. Opening a local PDF must not require an external viewer or CDN.

Browser preview may use temporary user-selected files, following the existing browser storage boundary. Label its persistence limits honestly. Native persistence acceptance must run against the rebuilt native app.

## Recommended architecture

Use Mozilla PDF.js as the rendering engine, with React controls styled for Stash. Check its current official documentation and compatibility with the project's Vite build and Tauri WebView before selecting a version:

- [PDF.js getting started](https://mozilla.github.io/pdf.js/getting_started/)
- [PDF.js API documentation](https://mozilla.github.io/pdf.js/api/)
- [PDF.js repository](https://github.com/mozilla/pdf.js)

Keep three responsibilities separate:

| Part | Responsibility |
| --- | --- |
| Native document storage | Import and retain PDF bytes, assign document IDs, persist metadata and reading state, report storage failures |
| PDF viewer | Render pages and text layers, search, select text, navigate, report reading position |
| Workspace | Open/close/switch tabs and route document navigation |

The viewer should accept a document source and a navigation target without depending on a mounted Tiptap editor. This allows later use beside a note or inside an attachment view.

### Identity and durable storage

- Give each PDF a stable ID separate from its filename, path, and content fingerprint. The fingerprint identifies a particular file revision; it is not the document's identity.
- Keep PDF bytes outside note JSON. Store metadata and reading state through the native storage layer. Avoid transporting large files as base64 strings through the existing image command merely because that command already exists.
- Define import failure and crash recovery behavior across filesystem writes and database registration. A successful import means its bytes and metadata are durable. Failures must leave the library usable and allow a clear retry.
- Define repeat-import behavior. Content deduplication is optional, but must not silently replace an existing document or lose its reading state.
- Introduce the schema migration using the current backup and migration conventions. Verify the actual current version before editing it. A SQLite-only migration backup does not include newly added PDF files; document this boundary and the files needed for recovery.
- A missing managed file must remain a visible unavailable document rather than disappearing from the library or becoming an empty replacement.
- Persist page-relative reading positions rather than raw screen pixels alone. Document page numbering and coordinate conventions. Future selections should use PDF page coordinates or normalized page coordinates with explicit rotation handling.

For a later linked-folder PDF source, retain the document ID when the app knows a file was renamed or moved. Stable IDs alone do not discover arbitrary external moves. Detect unavailable or changed files and require a verified match before reconnecting references.

### Tabs and lifecycle

The current workspace assumes every tab location has a `noteId`. Extend this to an explicit note-or-PDF target and migrate old saved preferences safely. Trace every consumer of the current location, including keyboard shortcuts and back/forward history. PDF tabs must not be passed through note saving, deletion, or editor commands.

Render visible pages and a small nearby buffer instead of retaining full-resolution canvases for every page. Cancel obsolete render work when zooming, switching documents, or closing tabs. Release document workers, canvases, listeners, and temporary URLs when no longer needed. Search and text selection must remain usable with page virtualization.

Use existing theme, sizing, focus, icon, and reduced-motion rules. Read the desktop wheel-scrolling behavior in `DESIGN.md` before integrating PDF scrolling and zoom gestures.

## Later note integration

Design the first delivery so these additions fit, but leave their UI and persistence for a later task:

- Attach one PDF to one or more notes without copying it into each note.
- Show a PDF and a note side by side.
- Insert a quote with a reference that reopens the source PDF page and selected region.
- Store highlights and comments separately from the original PDF bytes, with references to the document ID and file revision.
- Support PDFs located in linked notebooks while preserving the folder's ownership of the source file.

Future reference data should include a document ID, revision fingerprint, page, and optional selection geometry and quoted text. A changed source revision must be detected before reusing old selection coordinates. Do not build unused annotation tables or freeze a public link format during the first delivery.

PDF sync, OCR, editing PDF contents, writing annotations back into PDF files, collaboration, a full document library redesign, and system-wide file associations are outside the first delivery. Existing note sync does not automatically provide PDF-byte sync.

## Current code pointers

Verified during this handoff; recheck before editing:

| Path | Why it matters |
| --- | --- |
| `package.json` | React, Tiptap, Vite, and Tauri project; no PDF renderer dependency was present |
| `src/model.ts` | Note and linked-file models; ordinary notes have rich document content and linked notes carry a `FileSource` |
| `src/workspace.ts` | Saved tabs, locations, restoration, preview tabs, and navigation currently depend on note IDs |
| `src/components/NoteTabs.tsx` | Existing tab presentation and keyboard interaction |
| `src/App.tsx` | Workspace composition, tab selection, editor mounting, and shortcut routing |
| `src/components/NoteEditor.tsx` | Linked-note image commands and file-link navigation |
| `src/editor/noteReferences.ts` | Existing stable-ID note references; a useful pattern for later PDF references |
| `src/storage/library.ts` and `src/storage/useLibrary.ts` | Frontend library commands and state ownership |
| `src-tauri/src/storage/mod.rs` | Native SQLite ownership and migrations; inspected code supports schema version 7 |
| `src-tauri/src/storage/bridge.rs` and `src-tauri/src/lib.rs` | Native command boundary and registration |
| `src-tauri/src/storage/linked.rs` | `read_asset` and `write_asset` support images only, despite generic command names |
| `src-tauri/src/storage/file_io.rs` and `file_links.rs` | Existing filesystem operations, fingerprints, and scoped linked-file handling |
| `src-tauri/src/storage/sync.rs` | Inspect before making any claims about how new document metadata interacts with sync |
| `documents/LOCAL_STORAGE.md`, `FOLDER_NOTEBOOKS.md`, and `NOTE_LINKING.md` | Storage and navigation context; historical details may lag current code |

## Acceptance and delivery

Use disposable PDFs and an isolated test library. Include a multipage text PDF, a scanned PDF, a large document, rotated pages, a corrupt file, and an encrypted file.

1. Import, close, restart, and reopen a PDF. Confirm its ID, content, reading position, and zoom survive. Moving the original source file must not break a managed import.
2. Confirm page navigation, search navigation, selection/copy, zoom, resize, and keyboard focus work in the rendered viewer. Check selection alignment on rotated pages.
3. Switch rapidly between PDFs and notes, close a PDF during rendering, and change zoom repeatedly. Confirm obsolete work is cancelled and note edits are retained.
4. Cover storage failure, missing bytes, duplicate import behavior, old workspace preference restoration, and schema upgrade preservation with focused behavioral tests.
5. Follow the `DESIGN.md` review checklist. Check narrow desktop windows and mobile note regressions. Update the design reference only if the implemented change alters a shared convention.
6. Run frontend tests and the production build. Run Rust tests when native storage or commands change. Build and inspect an isolated native bundle for file picking, worker loading, offline rendering, and restart persistence. Do not replace the installed app or use the user's real library for write tests.
7. Deliver the changes in the working tree with a short report: what works, files changed, tests run, browser evidence, rebuilt native evidence, known limitations, and the next note-integration step. Report unrelated failures separately instead of fixing them inside this task.

Completion means a usable standalone viewer with durable native document storage and working PDF tabs. A browser-only preview or a successful build alone does not satisfy native persistence acceptance.
