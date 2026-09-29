# Prototype review

Verified on macOS on 8 September 2026.

## Build

- TypeScript checking and Vite production compilation passed.
- Tauri debug app bundle built successfully and opened at its `tauri://localhost` URL, without a running frontend server.
- Dependencies installed without reported npm audit vulnerabilities.
- Vite reports one advisory about the approximately 939 kB minified JavaScript chunk. Bundle splitting and long-note performance remain later work.

## Direct interaction checks

- Browser: created a note, entered a title and two paragraphs, inserted a table, typed into a table cell, and added a row.
- Browser: switched away and back, confirming the edited note and table remained in the running session.
- Browser: changed the note font independently and selected dark appearance.
- Packaged macOS app: created a note and typed two paragraphs in the native WebView.
- Packaged macOS app: selected a code block, changed its language to Rust, and undid the change.
- Packaged macOS app: reviewed light layout and dark appearance settings visually.
- Final packaged build: selected Avenir Next for notes while interface and code settings remained System Sans and Menlo; returned the note font to Georgia for review.

## Limits

This is an interactive first mockup. Notes, edits, and preferences reset on reload or app restart. There is no durable storage, backend, or sync. Not every feature in the retained product scope has been implemented or tested. Long documents, large note collections, full keyboard accessibility, input-method composition, and mobile behavior have not been comprehensively tested.

The macOS app bundle is at `src-tauri/target/debug/bundle/macos/Stash.app`. Use `npm run tauri dev` for continued development or `npm run tauri build -- --debug --bundles app` to refresh the standalone local app.
