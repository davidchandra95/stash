# PDF viewer implementation

## Scope and entry points

The desktop PDFs section, directly below Notebooks, imports managed copies and reopens them in permanent workspace tabs. PDF reading hides the Notes pane without resetting it. Notes and their preview/history behavior remain separate from PDF commands. Password-protected files show an unsupported message.

Native storage is implemented through the existing Rust service on desktop. macOS was exercised in an isolated rebuilt app; Windows and Linux native file picking have not been exercised. Browser preview uses session-only `File` objects. The companion-note workflow is documented in [PDF_NOTES.md](PDF_NOTES.md). Android import, note attachments, persistent annotations, OCR, PDF sync, and linked-folder PDFs are deferred.

## Ownership and APIs

- Rust owns document identity, managed bytes, metadata, crash recovery, and durable reading state.
- `src/pdf/store.ts` provides the native/browser source boundary and an ordered reading-state save queue. Save failures remain pending and appear with Retry. Its flush joins the library's existing quit barrier.
- `src/workspace.ts` understands note and PDF targets; legacy `{id, noteId, preview}` preferences still load. PDF preferences are `{id, kind: "pdf", documentId}`. Native preference validation accepts both kinds. Tabs with missing managed bytes remain available because metadata still exists.
- The independent reader accepts `PdfSource {id, size, read(begin, end)}`, saved reading state, optional page navigation, and reading-state callbacks. It does not mount or depend on a Tiptap editor.

Native commands are `list_pdfs`, `import_pdf {path}`, `read_pdf_range {id, begin, end}`, and `save_pdf_reading {id, reading}`. Reads return binary IPC responses, are capped at 1 MiB each, and resolve only registered document IDs. Large range requests are split by the frontend source adapter. No PDF bytes enter note JSON or image/base64 commands.

## Storage, recovery, and identity

Schema 8 adds `pdf_documents` and `pdf_reading`. Bytes live in `<library>/pdfs/<UUID>.pdf`. Filenames are labels; the UUID is identity; SHA-256 identifies the imported byte revision. Importing identical bytes reuses the document and reading position. Same-name files with different bytes get separate IDs. Reimporting the exact original bytes repairs a missing managed copy while retaining its ID.

Imports write and hash a unique `.import` file, flush it, rename it atomically, sync the directory on Unix, and then commit metadata. Failures remove the new unregistered files. Startup, under the library lock, removes abandoned UUID-named `.import` files and unregistered UUID-named `.pdf` files. It never removes registered metadata or replaces missing bytes with empty data. Recovery errors are surfaced through storage startup rather than silently ignored.

The existing migration creates a SQLite backup before upgrading. **This backup does not include PDF bytes.** A complete library backup must include SQLite and the `pdfs/` directory, ideally after clean shutdown; a live SQLite backup must use SQLite's backup facilities rather than copying the database alone. The companion-note integration upgrades the database to schema 9; older schema-7/8 apps reject it. To return to an older build, restore the pre-migration SQLite backup and retain the PDF directory separately for recovery. PDFs imported after that backup are not represented in it.

PDF metadata and bytes do not join note sync. Moving or deleting the original source after successful import does not affect reading. Unexpected modification of managed bytes is not a supported editing workflow; truncated or missing files produce errors.

## Rendering and position

PDF.js 6.4.299 uses its legacy display/viewer builds, a matching bundled worker, and local character maps, standard fonts, ICC profiles, image assets, and WASM decoders. The Vite asset plugin serves these locally during development and emits them into the app bundle. Generic vendor styles are scoped to `.pdf-reader`, and build output preserves function/class names. No CDN or remote viewer is involved.

The WebView compatibility helper adds async iteration only when native `ReadableStream` lacks it. This is necessary for PDF.js text extraction on the tested Mac. It releases stream locks and cancels on early exit. PDF scripting and form editing are not enabled. Internal PDF page links work; external PDF links are disabled for this delivery.

PDF.js renders visible pages plus its bounded nearby cache. Page canvases are limited to 8 megapixels each; its detail rendering supports larger zoom levels. Closing/switching cancels obsolete work, disconnects observers/listeners, and destroys the document worker. Search uses PDF.js text extraction and match highlighting, including pages without retained canvases. A no-text message appears only after all pages were checked; there is no OCR.

Reading state is `{page, x, y, zoom}`. Pages are one-based. `x` and `y` are normalized offsets from the displayed page's top-left corner to the viewport's top-left, clamped to `[0,1]`; coordinates use the PDF's intrinsic page rotation. Zoom is `"width"` or a scale from `0.25` to `5`, where `1` is 100%. Fit-width is recomputed for the viewport; numeric zoom is retained. Position is restored after page geometry is available. Closing uses the last valid connected viewport state, not geometry from a detached element.

These reading coordinates are not an annotation format. Future note references should include document ID, fingerprint, page, and explicitly defined PDF-space selection geometry. A revision mismatch must be checked before reusing that geometry.

## Verification

Commands:

```sh
npm test
npm run test:pdf
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

The browser suite uses synthetic text, rotated, scanned, 300-page, corrupt, and encrypted PDFs. It checks note-edit retention, duplicate import, reading restore, zoom/resize, search into distant pages, bounded canvases, rapid switching, selection/copy, both app layouts and all palettes, desktop widths, and mobile note screens.

Native review uses a separate identifier/product name and `UPNOTE2_DATA_DIR` in a debug build. The installed app and real library are not used. Native picker/import, local worker rendering, Cmd+F/search, and restart with the original source moved were verified. The same document ID reopened on page 4 with the saved fractional position and 158% zoom.

Latest checks: 5 browser tests passed; 74 Rust tests passed with 2 ignored; the full frontend suite passed 510 tests and failed the existing AccountMenu focus-return test. Production and isolated native builds passed.

Known unrelated checks: the existing AccountMenu Escape focus-return test fails in isolation; npm audit reports a low-severity DOMPurify issue. Neither was changed in this task. Production build also reports the large-bundle warning; the PDF reader is loaded as a separate lazy chunk.
