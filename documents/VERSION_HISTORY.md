# Version history

Right-click a note (or Note actions) → **Version history…** lists earlier versions of the note, newest first, grouped by day. Select one to read it beside the list; **Restore this version** replaces the note's content and title with it.

## When versions are kept

- When a saved body changes, the body it replaces is kept, at most once every 10 minutes per note. So the version from before you started editing is always there, and a long editing session leaves a version roughly every 10 minutes.
- Before a sync replaces a note's local body with a different one, the local body is kept regardless of the interval.
- Before a restore, the current body is kept, so a restore can be undone by restoring again. In an open editor the restore is also an ordinary edit that Undo reverses.
- Changes that don't touch the body (title only, pinning, notebooks) keep nothing, and a body identical to the last version isn't kept twice.

Each note keeps its 50 newest versions; history goes away with the note. Versions stay on the device that kept them and don't sync, like undo history. Folder-linked notes have no version history in Stash, since their files live on disk.

Versions are full copies of the note's body, including embedded images, so notes with large images use more space. Schema 20 adds `note_versions` (`note_versions_schema.sql`, `storage/versions.rs`). The browser preview keeps the same history in memory for the session (`src/history/versions.ts`). Android doesn't show history yet, though its saves are kept by the same native store.
