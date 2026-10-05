# PDF-to-note integration handoff

Created: 2026-10-04
Workspace: `/Users/slowtyper/code/upnote2`
Status: Implemented in the working tree on 2026-10-04. This document preserves the approved scope. See [PDF_NOTES.md](PDF_NOTES.md) for implementation details, verification results, and remaining environment limits.

## Goal and approved decisions

Build a **PDF with a companion note** workflow using the existing viewer. The user wants to read a PDF while taking notes, with minimal interruption when collecting excerpts.

The user selected:

- PDF on the left, a resizable note editor on the right.
- One dedicated, normal note per PDF, accessible from All Notes and ordinary notebooks.
- Quote capture and links back to the source, without persistent PDF highlights in this delivery.
- Adding a quote keeps the user reading: append it to the note without moving PDF focus or position.

The existing viewer provides managed storage, stable document IDs, fingerprints, reading-position persistence, and page navigation. Extend these foundations. Read [PDF_VIEWER.md](PDF_VIEWER.md) for the existing implementation; [PDF_VIEWER_HANDOFF.md](PDF_VIEWER_HANDOFF.md) is the historical viewer brief, not the scope of this task.

## Working rules and starting points

Read `AGENTS.md`, `DESIGN.md`, and `/Users/slowtyper/.codex/OPINIONS.md` before implementation. Inspect the current working tree and preserve existing changes. Leave work unstaged. Do not create branches, commits, pushes, or pull requests. Keep unrelated defects outside this task and do not manually modify generated files or changelogs.

Current code pointers, verified during planning:

| Area | Starting points |
| --- | --- |
| PDF rendering, selection, and navigation | `src/pdf/PdfViewer.tsx`, `src/pdf/model.ts`, `src/pdf/pdf.css` |
| PDF source access and reading-state save queue | `src/pdf/store.ts` |
| Workspace state and composition | `src/workspace.ts`, `src/useWorkspace.ts`, `src/App.tsx` |
| Normal note editing and live editor ownership | `src/components/NoteEditor.tsx`, `src/editor/session.ts` |
| Library loading, mutation, and saving | `src/storage/library.ts`, `src/storage/saveQueue.ts`, `src/useNoteActions.ts` |
| Link validation, clipboard, and Markdown | `src/editor/links.ts`, `src/editor/clipboard.ts`, `src/editor/fileNavigation.ts`, `src/editor/markdown.ts` |
| Global shortcut routing | `src/useShortcuts.tsx` |
| Native PDF storage and command boundary | `src-tauri/src/storage/pdf.rs`, `src-tauri/src/storage/bridge.rs`, `src-tauri/src/lib.rs` |
| Schema, note validation, and sync bookkeeping | `src-tauri/src/storage/mod.rs`, `src-tauri/src/storage/sync.rs` |
| Existing browser verification | `playwright.pdf.config.ts` and the tests it selects |

Existing notes and PDFs are alternate views in one writing pane. The editor session cache owns one live editor per note. The existing shortcut dispatcher chooses handlers by registration order. These are integration constraints that must be addressed, not reasons to create a separate note editor or save mechanism.

## Reading and writing workflow

### Start and resume

- Add **Take notes** to the PDF header. On first use, create the companion note and open it beside the PDF. After creation, label the action **Show notes** or **Hide notes**.
- Create the note only after an explicit Take notes or Add quote action. Simply opening a PDF creates no note. Add page reference is also an explicit capture action and follows the same creation behavior.
- Name it `<PDF filename without extension> - Notes`. Start it in Uncategorized, with a source link at the top. Users can rename and organize it through existing note controls.
- Keep the companion association independent of note title and notebook.
- Remember whether the companion pane is open, its width, PDF reading position, and note scroll position. Preserve editor selection and undo history within the session.
- Closing the pane or PDF tab keeps the note and association.

### Layout

- Retain the shared tab strip. The PDF tab owns the reading-and-writing layout; opening its companion does not create another tab.
- Hide the middle Notes list as the viewer already does.
- Start with 60% PDF and 40% note. Use a keyboard-accessible resize divider, with minimum widths of 360px per pane.
- When the available content width is below 720px plus the divider, show a **PDF / Notes** switch instead of squeezing both panes. Preserve both positions when switching.
- Focus mode hides surrounding navigation and keeps the reading-and-writing layout.
- Reuse the normal note title, formatting tools, autosave status, and editor. Keep secondary actions in the existing menus.

### Capture while reading

- Selecting PDF text reveals **Add quote to note**, also available through a keyboard-accessible selection action.
- Capture the selection before toolbar interaction can clear it.
- Append a blockquote followed by a citation such as `Document.pdf · p. 12` or `pp. 12–13`.
- Preserve selected wording and paragraph boundaries; do not paraphrase or automatically rewrite hyphenated words.
- Keep PDF scroll, zoom, selection, and focus unchanged. Preserve the note's current cursor and scroll position.
- Show brief feedback with **View in note** and **Undo**. View in note scrolls to the inserted quote and focuses the paragraph after it; Undo removes that capture as one editor transaction.
- Provide **Add page reference** for thoughts about the current page and for scanned PDFs without selectable text.
- If capture creates the companion note, open its pane while preserving the reading anchor. Retain the captured selection during creation; failed creation must not lose it.
- Opening or resizing the companion pane may recompute fit-to-width zoom. Preserve the same source reading anchor and selection through that reflow.

### Return to the source

- Clicking a citation inside the companion navigates the adjacent PDF and briefly outlines the quoted region. Keep the note's position and focus.
- Repeated clicks on the same citation navigate again.
- A companion opened from All Notes has an **Open PDF** action that returns to its paired layout and preserves the current note position.
- Citations copied into other notes remain usable. They open the source PDF's paired layout while leaving the originating note available in its existing tab.
- Opening a citation does not itself create a companion when one does not exist. Creation remains tied to an explicit writing or capture action.

## Storage and interfaces

### Companion ownership

- Add a local association with a unique document ID and unique note ID. Each PDF has one companion, and each companion belongs to one PDF.
- Add an idempotent native "ensure companion" operation. Create the normal note and association in one transaction, using existing note revision, indexing, and sync bookkeeping.
- Flush pending library work before this operation and merge the result without overwriting newer edits. Concurrent clicks and retries return the same note.
- Provide equivalent association and creation behavior in the browser preview, within its existing temporary storage boundary.
- Use the existing migration and backup conventions. The inspected implementation uses schema 8; verify the current version before assigning the next migration.
- Trashing a companion retains its association. Show **Restore note** rather than silently replacing it. After permanent deletion, allow explicit creation of a new companion.
- Duplicating a note copies its content and citations but does not transfer companion ownership.

### Citations

- Store quotes as ordinary note content and citations as standard link marks. Avoid a new editor node type so existing note serialization, Markdown, and sync remain usable.
- Define versioned internal PDF links containing document ID, fingerprint, and one-based page number. Quote links also carry per-page selection rectangles in PDF page coordinates.
- Use PDF.js coordinate transforms for rotation and zoom. Existing normalized reading offsets are not selection geometry.
- Add shared, validated citation parsing and serialization. Preserve valid internal links through editing, clipboard operations, and Markdown conversion without weakening URL sanitization.
- Resolve by document ID first. If that ID is unavailable, allow an exact fingerprint match to an already imported PDF. Never reconnect by filename.
- If the revision differs, show the mismatch and omit the region overlay. Keep the quote readable.
- Missing PDFs produce an in-app unavailable message. Do not send internal citation links to an external URL handler.
- Reject malformed or unsupported citation targets visibly. Validate page numbers and geometry before navigation; do not let invalid coordinates reach rendering code.

### Viewer and workspace

- Extend the reader with selection output and citation navigation. Include a navigation request identifier so repeated requests to the same location are handled.
- Extend workspace preferences with companion visibility, split ratio, and note scroll state. Older saved tabs remain valid. Update native preference serialization and validation alongside the TypeScript model.
- The reader emits selection data; the workspace coordinates capture; the note editor performs the insertion. Keep note mutations out of the PDF renderer.
- Reuse the existing one-editor-per-note session. Mount each editor in only one location at a time and load the full note before appending content.
- Route Find, Undo/Redo, formatting, and other document commands according to the focused pane. The current global shortcut registration order must not decide which pane receives a command.
- Append through the existing editor and save queue, preserving undo grouping and failure recovery. Capture feedback must remain distinct from successful disk-save status.
- The feedback Undo action targets the captured insertion in its note; it must not act on an unrelated editor just because focus remains in the PDF. Do not undo later unrelated writing to remove an old capture.

## Boundaries and failure behavior

- Deliver desktop integration and browser preview support. Keep Android note editing working; Android PDF import remains outside this task.
- Companion notes use normal note sync. PDF bytes and companion associations remain local in this delivery. Synced quotes and citations stay readable when the source is unavailable. This is not cross-device companion pairing.
- Keep the companion as a normal note, including existing organization and conversion behavior. Preserve citation links through supported conversions.
- Persistent PDF highlights, annotation management, OCR, PDF editing, multiple companions, and a general split-tab workspace are later work. The temporary citation outline is navigation feedback, not a saved annotation.
- Block capture when the note cannot be edited or the app is syncing, converting, or quitting. Explain the reason without interrupting reading.
- Save failures retain pending edits and use the existing retry and quit protections.
- Update `DESIGN.md` for the approved paired layout and focus behavior. Leave unrelated issues unchanged.

## Suggested implementation sequence

1. Add the companion association, migration, and idempotent creation operation. Verify repeat creation, failure rollback, note sync bookkeeping, and deletion behavior with temporary libraries.
2. Add the citation format and round-trip support, then PDF selection capture and source navigation. Verify rotation, multiple pages, and missing or changed sources before wiring quote insertion.
3. Compose the paired workspace using the normal note editor and save queue. Add responsive switching, position restoration, focus ownership, and normal-note Open PDF navigation.
4. Connect quote/page capture, non-interrupting feedback, View in note, and capture Undo. Verify pending edits and asynchronous loading cannot replace content or lose a selection.
5. Complete the acceptance checks, update implementation and design documentation, and report evidence by environment.

## Acceptance checks

Use disposable PDFs and isolated libraries. Existing PDF fixtures and browser tests are a starting point, not evidence for the new integration.

- **Complete workflow:** Open PDF, take notes, type, capture several quotes without losing reading position, follow citations, close, restart, and resume.
- **Identity:** Repeated clicks, retries, and reimporting identical PDF bytes reuse the same companion. Renaming or organizing the note preserves its association.
- **Capture:** Single-page and multipage text, rotated pages, zoom changes, scanned-page references, repeated citation navigation, and one-step capture undo.
- **Editing:** Unsaved text, selection, undo history, and scroll survive switching between the companion layout and its normal note tab. Capture appends without replacing content or moving focus.
- **Shortcuts:** Find and Undo act on the focused pane; PDF controls never trigger note formatting or deletion.
- **Recovery:** Missing PDF, changed fingerprint, trashed or deleted companion, failed creation, failed autosave, and synced citations without local source bytes.
- **Compatibility:** Old workspace preferences restore; migration preserves notes and PDFs; citations survive clipboard, Markdown conversion, and note sync.
- **Visual and native checks:** Follow the design checklist, including narrow windows and mobile note regressions. Verify persistence and paired editing in an isolated rebuilt native app.

Run the current project commands after confirming their definitions:

```sh
npm test
npm run test:pdf
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Use the existing isolated native review approach documented in `PDF_VIEWER.md`, with a separate app identifier and test data directory. Keep the installed app and real user library unchanged. A successful browser run or build does not prove native restart persistence.

The viewer's implementation document records an existing AccountMenu focus-return failure and other unrelated warnings. Recheck their status when encountered; do not assume those historical results describe the current tree, and do not fix unrelated issues inside this task.

## Completion report

Deliver the changes in the working tree and report:

- The completed reading, writing, capture, and source-return workflow.
- Migration and compatibility behavior, including local-only PDFs and companion associations.
- Automated results, browser evidence, and isolated rebuilt-native evidence separately.
- Any unverified acceptance checks or remaining limitations.

Completion requires the real paired workflow, durable native companion ownership, safe quote capture, and working source navigation. A split-screen mockup alone does not complete this task.
