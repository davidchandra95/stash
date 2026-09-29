# Writing experience

Implemented for the session-only macOS prototype using React, Tiptap and a Tauri shell. The title is still a separate plain-text field. No storage, server, sharing, templates, equations or mobile implementation was added.

## What to try

Open **A garden journal** for an original nested-content example. Its header includes formatted text, a link, an inline checkbox and a local image. Its body includes a colored quote containing a table, mixed lists, a merged cell and another section. The paragraph following each section stays outside it.

- Type `/` at the start of a text block or after whitespace, including inside list items and table cells. The compact menu groups commands into categories; Right or Enter opens a category and Left returns. Search results include their category path. Filter by typing, use Up/Down and Enter, or select with the mouse. Escape keeps the literal command text. Code blocks and paths containing another slash do not trigger commands.
- Use the bottom toolbar for common formatting. **More formatting and insert** contains colors, highlights, alignment, link editing, table sizes, contextual cell controls, sections and local image insertion.
- Switch a bullet, numbered or task item with Cmd+7, Cmd+8 or Cmd+9. Ordered numbering counts numbered items only, including across intervening bullet/task items. Tab and Shift+Tab nest and unnest items.
- Enter creates compact paragraphs; pressing it twice keeps an intentional blank paragraph. Shift+Enter creates a line break. Heading Enter returns to a paragraph.
- Code Enter and Shift+Enter add code lines. Cmd+Enter or the code exit control moves below the block. Tab indents code, including multiline selections; Shift+Tab removes indentation.
- In a section header, Enter moves into the body and Shift+Enter adds a header line. In a quote or section body, an empty final paragraph exits one level. Cmd+Enter explicitly exits the nearest code/quote/section container.
- Section controls include toggle, expand all, collapse all, wrap and unwrap. Wrapping includes the selected text blocks; unwrapping retains both header and body content. Cmd+. toggles; Cmd+Shift+. expands all; Cmd+Shift+, collapses all.
- Tables support cell navigation, column dragging, rows/columns, merge/split, header toggles and backgrounds. Use a cell selection for merge. Rich content stays editable inside cells.
- Images can be inserted from a local file, clipboard image data or file drop. Select an image for resizing handles or width/removal controls. Paragraph alignment positions inline images.

## Clipboard and session state

Rich HTML is preferred when available and sanitized with DOMPurify, then parsed into the supported schema. Plain-text Markdown is converted with marked. Code pastes stay literal. Cmd+Shift+V reads plain text through Tauri's clipboard plugin because this macOS WebView does not emit a normal paste event for that shortcut. Only read-text permission is granted, and the read happens on the paste shortcut. The browser preview uses the browser clipboard API.

Pastes form separate undo actions. Local image bytes are data URLs held only in memory. There is no file upload or durable media store. Remote image URLs are not fetched by the native shell; the app's existing image CSP still permits only self/data/blob sources.

Each note owns one in-memory Editor instance, preserving its document, selection, marks, collapse attributes and undo stack. Note-model callbacks remain connected for asynchronous image/clipboard completions after a switch. Typing updates are synchronous. Sample HTML, pasted HTML and Markdown use the same JSON normalization path; search text and counts come from the document.

## Source map

- `src/editor/extensions.ts`: shared schema and editor extension configuration.
- `src/editor/commands.ts`: action registry for slash commands, common toolbar actions and shortcuts.
- `src/editor/typing.ts`: context-specific keyboard rules.
- `src/editor/clipboard.ts`, `plainPaste.ts`, `images.ts`: input normalization, clipboard and session images.
- `src/editor/mixedLists.ts`, `richNodes.ts`, `collapsibles.ts`: rich document structures.
- `src/editor/session.ts`: per-note editor lifetime and model updates.
- `src/components/WritingTools.tsx`: selection-preserving compact contextual controls.
- `src/editor/fixtures.ts`, `writing.test.ts`: original example and behavioral checks.

## Verification

Run `npm test` for the behavioral suite and `npm run build` for TypeScript and production assets. Package with `npm run tauri build -- --debug --bundles app`.

The suite covers paragraphs, repeated Enter, Shift+Enter, tabs, heading/code/list/container exits, mixed styles and nested-style isolation, slash dismissal/selection/unmatched text, Markdown and literal paste, HTML sanitization, paste undo, per-note history/selection/model callbacks, composition-event protection, table navigation/colors, image drop, nested sections and JSON/HTML round trips.

Each phase was reviewed in the packaged macOS WebView before proceeding. Direct observations include compact typing, searchable slash commands, heading exit, Markdown paste and one-step undo; mixed numbering, table Tab navigation and cell backgrounds; independent nested boundaries, session collapse retention and undo after switching notes. The final native pass also confirmed Cmd+Shift+V inserts literal Markdown, slash-triggered local image insertion removes its command text, and dragging an image handle resizes it. Light and dark layouts were inspected. A low-contrast colored-text case in dark mode was corrected using a display-only color mix while retaining the document's original color.

### UpNote observation limit

A disposable-note attempt was made first in UpNote 9.22.2. Both the selected notebook's New Note control and Cmd+N from All Notes opened the Premium panel. During that initial implementation, no disposable note was created and no personal note was edited. Therefore, this implementation follows David's explicit keyboard contract and does not claim directly verified UpNote typing behavior.

### Remaining manual acceptance

The automated composition tests exercise actual ProseMirror composition-event handling. A native dead-key attempt through the computer tool did not produce an accented character, so it is not evidence of full IME acceptance. A human pass with the user's Chinese/Japanese/Korean input method is still needed. Native OS file dragging and all third-party clipboard formats also need broader acceptance coverage; the file-drop path is covered by the behavioral tests.

The existing Vite large-chunk warning remains. The macOS build is a local debug app, not a signed release.

Native clipboard setup follows the [official Tauri clipboard documentation](https://v2.tauri.app/plugin/clipboard/). The body-feature reference is the [shared UpNote example](https://getupnote.com/share/notes/y4NYv23IvoNYGb1UAPy1OjwRXoy1/fdb7668f-d5ce-4956-bbe4-4be881dc1c0a); the example fixtures in this project are original.


### Checkbox and slash-menu review - September 9, 2026

With David's later permission to write test content, a labeled test was appended to the stock UpNote welcome note because new-note creation remained premium-gated. Directly observed: compact icon rows; Heading, Format, Text Color, Highlight, List, Text Align, Table, Date and Time submenus; Right/Left navigation; filtered paths such as `List / Checklist`; slash activation after ordinary text plus whitespace; table choices from 2x2 to 10x10; and date/time format choices. These observed menu behaviors now guide the prototype. Other UpNote typing behavior is still subject to the earlier observation limit.

Inline and list checkboxes now share an SVG checkmark and outlined box instead of font-dependent glyphs. They retain click toggling, accessible checked state and undo support. Slash actions use an isolated transaction so a successful command removes only its slash text, while a failed action preserves input. The prototype also retains its inline checkbox, image, link and rich-section actions.

Validation: 37 automated tests pass, including category navigation, filtered commands after existing text, table sizing, dismissal, path/code exclusions and both checkbox controls. The packaged macOS app was checked for light/dark checkbox rendering and toggling, keyboard submenu navigation, filtered checklist insertion, preservation of text before the slash, table insertion, and date insertion inside a table cell. Long date choices use a wider menu for readability.


### Native persistence update - September 9, 2026

The native app now persists notes and settings using Rust/SQLite. Earlier session-only descriptions are historical; browser previews remain temporary. See [LOCAL_STORAGE.md](LOCAL_STORAGE.md) for save and recovery behavior. Managed attachment storage and restart-persistent undo are not included.
