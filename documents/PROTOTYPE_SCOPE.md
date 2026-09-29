# macOS notes prototype

## Purpose

Build an interactive macOS notes prototype to review the writing experience before implementing durable storage or a backend. Priorities are unrestricted note creation, rich editing including tables and code blocks, and independent interface and note fonts. Visual modernization is secondary to comfortable daily use.

## First review

- A compact notebook sidebar, note list, and writing area.
- Sample notes, notebook navigation, search, and note switching.
- Create and edit notes in memory, with a clear indication that this is a temporary prototype.
- Real text editing, headings, emphasis, lists, checklists, tables, and code blocks.
- Independent interface, note, and code font roles.
- Light and dark appearance.
- Focus mode and contextual writing controls.

The first review is a working slice of the agreed feature scope, not a claim that every retained feature is complete.

## Retained scope for subsequent UI work

Nested notebooks, notebook membership, spaces, tags, Quick Access, pinning, duplicate and trash, Today/Uncategorized/Todo views, search within notes, replace, internal note links, navigation history, colors, alignment, subscript/superscript, collapsible sections, quotes, dividers, images, attachments/PDF preview, video embedding, date/time insertion, formatting removal, typography and spacing controls, Markdown input, slash menu, spell check, code wrapping, default note format, edit protection, list settings, language/text direction, panels, and separate windows.

External video playback cannot be assumed to work offline; its eventual behavior needs a separate decision.

## Deferred by David

- Templates.
- Unsynced view.
- Equations.
- System appearance and extra themes; use light and dark only.
- Global shortcuts and desktop startup/menu bar integration.
- The entire backup, sharing, and plans section: sync, version history, backups, restore, import, export, print, web sharing, accounts, and subscriptions.
- Mobile implementation. Focus on macOS first.

## Data boundary

Use fictional sample content. Do not import personal UpNote notes. Keep prototype state in memory, without a database, server, sync service, or paid editor service. Clearly distinguish changes kept during the running session from durable saving.

## Stack decision

David selected Tauri + React + Tiptap after clarification. Use TypeScript and Vite for the web UI inside the macOS Tauri window. Rust is currently only the application shell. Do not add SwiftUI wrappers or an FFI layer. Mobile and durable local storage remain future work.

## Writing implementation update

The three writing phases are implemented in the session-only prototype: typing/slash/paste, flexible formatting/tables/images, and rich collapsible sections. See [WRITING_EXPERIENCE.md](WRITING_EXPERIENCE.md) for behavior and verification. The broader retained scope above remains a roadmap, not a completion claim.


## Offline storage scope update - September 9, 2026

David approved backend phases 1 and 2: persistent local notes/settings and reliable autosave. This supersedes the historical session-only boundary above for the native Mac app. The browser preview remains temporary. See [LOCAL_STORAGE.md](LOCAL_STORAGE.md) for implementation, acceptance evidence and deferred phases.
