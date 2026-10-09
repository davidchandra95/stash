# Stash

<!-- impeccable:product-schema 1 -->

## Platform

web

Stash uses a shared React/Tiptap interface inside Tauri for desktop macOS and mobile Android. These are the current target platforms. Platform-specific controls support desktop and touch use; this record does not imply iOS support or separate native UI implementations.

## Users

People taking personal notes every day. The main job is to write, organize, and find their own notes, with desktop and mobile access.

## Product Purpose

Make daily note-taking comfortable and reliable. Users should be able to keep writing offline, organize their library, and return to their notes without losing saved work.

## Positioning

Local-first personal notes with rich editing, user-controlled appearance, and optional self-hosted sync are current product facts. A specific difference from other notes apps has not been confirmed. Do not invent competitive claims.

## Operating Context

- macOS provides a desktop workspace with navigation, a note list, and a writing area. Focus mode supports concentrated writing.
- Android provides touch-oriented navigation and editing using the shared editor and settings definitions.
- Native libraries persist locally in SQLite. Browser previews use fictional, session-only data and do not represent durable native storage.
- Sync is optional and starts when the user requests it. Saving a connection or resuming the app does not start synchronization.
- On desktop, users can link a local folder and edit its Markdown files in place. Folder linking is outside the current Android milestone.

## Capabilities and Constraints

- Notes can use notebooks, nested notebooks, multiple notebook memberships, body hashtags, pinning, Quick Access, search, and recoverable Trash.
- Rich editing supports headings, lists, checklists, tables, code, links, images, collapsible sections, and slash commands. The repository also contains PDF workflows and editable drawings; their detailed limits remain in the feature documents.
- Interface, note, and code typography settings are independent. Appearance and writing settings belong to the user's device.
- Native autosave uses revision checks and visible failure recovery. Normal quit waits for pending saves; session undo does not survive restart.
- Optional self-hosted sync transfers ordinary notes and library organization. Linked-folder content, local paths, appearance, shortcuts, workspace tabs, and undo history stay on each device. HTTPS transport encryption is not a claim of end-to-end encrypted server storage.
- Android can view drawing previews; desktop can edit their scenes.
- Current implementation and acceptance limits are described in the documents below. Historical prototype scope is not proof that a feature is implemented or still deferred.
- Product-specific accessibility requirements and a distinct competitive position remain open decisions.

## Brand Commitments

The current product name is Stash. The repository and application identifier retain the older upnote2 name. No new brand promise or marketing claim was established during init.

## Evidence on Hand

- `README.md`: current product overview, run commands, and screenshots.
- `DESIGN.md`: existing UI rules and review boundaries; it remains the authority for visual conventions.
- `documents/LOCAL_STORAGE.md`: persistence, autosave, recovery, drawings, and verification limits.
- `documents/SYNC.md`: optional sync behavior, exclusions, protocol, and operations.
- `documents/ANDROID.md` and `documents/ANDROID_ACCEPTANCE.md`: mobile behavior and acceptance boundaries.
- `documents/FOLDER_NOTEBOOKS.md`, `documents/WRITING_EXPERIENCE.md`, and PDF documents: feature-specific behavior and limits.
- `assets/screenshots/`: existing screenshots use fictional browser-preview content. They are examples, not customer evidence or proof of current installed-app behavior.

## Product Principles

1. Support comfortable daily writing and finding notes.
2. Keep local work available without requiring a sync server.
3. Make save failures visible and preserve recoverable work.
4. Share product behavior across desktop and mobile while respecting their different input methods.
5. Preserve the user's independent appearance and writing choices.
