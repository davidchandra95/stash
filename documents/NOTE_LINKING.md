# Note linking

Implemented September 9, 2026.

Type `[[` anywhere in rich text to search note titles. Results include notebook names, ignore sidebar filters, and exclude Trash. Use arrow keys and Enter, or click a result. Escape keeps the text as written. Code and escaped triggers remain literal.

If no exact title exists, select **Create “title”**. This creates an empty note in the source notebook and inserts its reference without leaving your writing. Undo removes the reference, but the new note remains.

References follow the target's current title through its stable ID. They are selectable inline units and can carry formatting. Click or keyboard-activate one to open its target. **Back to previous note** restores the source view, editor selection and scroll position. Trashed or unavailable targets produce an explanation without creating replacements.

## Implementation

`noteReference` stores `noteId` and `fallbackTitle` in the existing document JSON. No SQLite migration is needed. Node views resolve labels from note summaries and subscribe to label updates without changing the source document or undo history. Rich HTML copy/paste uses a validated `data-note-id`; plain text uses the displayed label. Older app versions that do not understand this node will reject the document instead of silently deleting the reference.

New targets enter the save queue before their source references. Replacing a queued source snapshot moves it after its newly queued target. Failed saves retain both jobs and use the existing retry/quit protection. Creating a note and inserting a link are not a single cross-document undo operation.

Back history is session-only. Backlinks, heading links, external deep links and separate preview windows are not included. Saved derived search text may retain the last saved reference label after a target rename; visible references resolve the current title immediately. Full indexed search is a later backend phase.

## UpNote evidence and limits

UpNote's official guide describes `[[`, title filtering, Enter insertion and creating a missing note: https://help.getupnote.com/write-and-edit/links-between-notes

Direct testing was attempted in UpNote 9.22.2. Both the new-note shortcut and New Note control opened the Premium screen instead of a disposable note. The first attempt inserted `[[` into the selected note; it was immediately undone. No further writing tests were performed in UpNote. Autocomplete details in this implementation follow the approved plan and documentation, not a claimed direct match of unobserved behavior.

## Verification

Automated checks cover title ranking, duplicate/untitled/Unicode titles, literal and composition contexts, nested content, closing brackets, mouse and keyboard insertion, Escape, undo/redo, rename-aware labels, HTML/JSON round-trips, invalid attributes, save ordering and failure retention. A React integration test covers navigation across notebook filters, Back selection/scroll restoration, rename updates and trashed-target feedback. A Rust test verifies references survive database reopen and rejects malformed reference attributes.

Native Mac validation was initially blocked because the Mac was locked. Final validation status is recorded in the delivery message.
