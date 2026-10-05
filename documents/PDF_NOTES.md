# PDF companion notes

Implemented in the working tree on 2026-10-04 from [PDF_NOTES_HANDOFF.md](PDF_NOTES_HANDOFF.md). See [PDF_VIEWER.md](PDF_VIEWER.md) for managed PDF storage and rendering.

## Reading and writing

**Take notes**, **Add quote to note**, or **Add page reference** creates one normal note named `<filename> - Notes`, initially in Uncategorized with a source link. Opening a PDF alone creates no note. The note stays accessible through All Notes, can be renamed and organized, and uses the existing editor, autosave, conversion, and note sync paths.

The PDF tab owns a resizable reading-and-writing layout, initially 60% PDF and 40% note. Each pane has a 360px minimum with an 8px divider. Below 728px of available content width, a PDF / Notes switch preserves both panes. The divider supports pointer dragging, arrow keys, Home, and End. Focus mode keeps the pair together. Visibility, ratio, selected compact pane, and note scroll are workspace preferences; PDF reading position uses the existing reader store.

New quote captures append an ordinary blockquote with a linked citation after the final quoted paragraph’s text, separated by one space. Preserve quote paragraph and line breaks. Citation labels use `(p. 252)` or `(pp. 252–253)` without the filename; standalone page references use the same labels in an ordinary paragraph. Keep an empty writing paragraph after each capture, preserve the reader anchor and note cursor, and leave existing captures unchanged. Page references work without selectable text. The reader preserves its anchor and selection through fit-width reflow. Feedback offers View in note, Undo, and Dismiss; it is separate from disk-save status. View in note focuses the paragraph following the capture. Feedback Undo tracks only that capture through subsequent edits, preserves unrelated later writing, and refuses to remove a capture that has itself been edited. Normal editor Undo also treats the original capture as one step.

Clicking a source link navigates the adjacent PDF and briefly outlines the quoted region. Repeated clicks navigate again. A companion opened normally has Open PDF. A citation copied to another note opens the source PDF while keeping the originating note's tab. No source navigation action creates a companion by itself.

Find and note commands follow the focused pane. The shortcut boundary also handles native WebKit `beforeinput` history commands: macOS Undo/Redo can otherwise reach the last editable element after the reader gains focus. PDF focus blocks these commands; note focus retains normal editing history.

## Ownership and persistence

Schema 9 adds `pdf_companions`: a unique document ID points to a unique normal note ID, with foreign keys and delete cascades. `ensure_pdf_companion` creates the note and association in one SQLite transaction, using the normal note writer and sync bookkeeping. Repeated calls return the same note. The frontend deduplicates concurrent creation requests, flushes pending writes first, and merges the result without replacing newer local edits. Browser preview keeps equivalent associations only for its current session.

Trashing the note retains the association and exposes Restore note. Permanent note deletion removes the association, allowing later explicit recreation. Renaming, notebook changes, and content duplication do not transfer ownership. The session cache continues to own one editor per note, mounted in one place at a time; switching between its normal tab and paired layout preserves in-session selection and history.

Migration uses the existing pre-upgrade SQLite backup. Old workspace preferences load with defaults. Schema-8 and earlier apps reject schema 9. To return to an older build, restore its pre-upgrade database backup after shutdown and retain the managed `pdfs/` directory separately. The database backup does not include PDF bytes or changes made after the backup.

Companion content participates in ordinary note sync. PDF bytes, PDF metadata, companion ownership, and paired workspace preferences remain local. On another device, quotes remain readable but source links need the PDF to be imported locally. This delivery does not provide cross-device companion pairing.

## Citation format and boundaries

Links use `upnote2://pdf/v1/<document-id>?fingerprint=<sha256>&page=<one-based-page>`, optionally followed by encoded `regions` containing per-page rectangles in PDF coordinates. The shared parser validates version, identity, fingerprint, page numbers, geometry, duplicate parameters, and size limits. The viewer validates actual page bounds before drawing. PDF.js coordinate transforms account for rotation and zoom.

Resolution uses document ID first, then an exact fingerprint among imported PDFs, never a filename. A changed fingerprint shows a warning and omits the region outline. Missing, malformed, unsupported, and out-of-range sources produce in-app messages. Internal links never go to the external URL handler. Valid links survive HTML clipboard sanitation and Markdown round trips; invalid links do not gain a sanitation exemption.

The reader emits selection and navigation data; the workspace coordinates capture; the editor performs the insertion. Capture is blocked during sync, conversion, or quit and for trashed, unavailable, or conflicted notes. Existing pending-save retry and quit protection remain responsible for persistence failures.

Main modules: `src/pdf/PdfWorkspace.tsx`, `selection.ts`, `citations.ts`, `capture.ts`, `PdfViewer.tsx`, `src/App.tsx`, `src/storage/library.ts`, and `src-tauri/src/storage/pdf.rs`.

## Verification on 2026-10-04

| Environment | Result |
| --- | --- |
| Focused frontend | 12/12 passed: citation and capture tests, native-history event guard, existing shortcut dispatcher. |
| Full frontend | Latest run: 520 passed, 2 failed, 522 total. The unchanged AccountMenu and workspace note-action Escape focus-return tests fail intermittently. An earlier run before the last added test passed 521/521; the workspace test also passed a focused rerun. These unrelated tests were not changed for this feature. |
| Rust library | 78 passed, 2 ignored. Includes durable identity, trash/deletion, transaction rollback and sync bookkeeping, schema-8 backup/migration, and preferences. |
| Browser | All 10 PDF tests passed, including 5 new integration tests. Single-page, multipage and rotated capture, scanned-page references, selection/anchor retention, repeated citations, focused Find, drafts and targeted Undo, normal-note Open PDF, copied citations, unavailable/invalid targets, trash restoration, narrow layouts, and existing mobile note screens. |
| Builds | Production frontend and isolated debug macOS bundle passed. Existing large-bundle warning remains. |
| Native macOS | Isolated rebuilt app exercised import, companion creation, editing, page/quote capture, selection retention, source outline, split controls, autosave, and repeated quit/restart. Same companion ID, content, PDF page 4, split ratio, and note scroll reopened. Final build verified PDF-focused Cmd+Z/Cmd+Shift+Z leave the note unchanged and note-focused Cmd+Z still works. |

The native review uses product `Stash PDF Notes Review`, identifier `local.upnote2.pdfnotes.review`, and `UPNOTE2_DATA_DIR=<workspace>/.artifact-work/pdf-notes-review/library`. The installed app and real library were not modified. Browser screenshots are emitted beneath `.artifact-work/pdf-tests/`; the paired 1280px and compact 900px views were visually inspected. Native layout was inspected separately.

Windows/Linux native behavior, physical Android devices, live cross-device sync, and injected native disk-full autosave recovery were not exercised. Creation rollback is covered with a failing database trigger; ordinary save retry behavior remains covered by the existing storage suite. No OCR, persistent PDF highlights, PDF editing, multiple companions, or general split-tab workspace is included.
