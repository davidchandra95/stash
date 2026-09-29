# Folder-linked Markdown notebooks

## Using the feature

Choose **New notebook**, enter a display name, and optionally select **Link a folder from this computer**. The native folder picker is available in the desktop app. An empty name is filled from the selected folder; a typed name only changes the notebook label. Without a folder, the notebook remains database-backed. Browser preview supports ordinary nested notebooks and explains why folder selection needs the desktop app.

The scanner includes `.md` files without regard to extension case, preserves intermediate folders leading to Markdown, and ignores `.git`, symbolic links, and branches without Markdown. An empty root is allowed. The notebook menu creates a sub-notebook: linked parents create an actual folder, while ordinary parents create a database-only notebook. Manually created empty children remain visible. Notebook menus also create a note in the clicked notebook, edit its Stash metadata, and delete database notebooks. Delete can promote children or remove a whole database subtree, while keeping notes or moving them to recoverable Trash. Folder-linked notebooks are protected from deletion. A notebook shows its direct notes; assignment pickers show full notebook paths.

Linked note titles come from filenames. Editing a title commits on Enter or blur and renames the file, leaving document headings unchanged. New notes and duplicates use unused filenames. Invalid names are rejected; a rename or restore never overwrites an existing destination. A linked note has one physical folder and may also belong to ordinary notebook collections. Use **Move file to notebook** to change the physical folder. Moving preserves the note ID and ordinary memberships. An ordinary note can move into a linked notebook only when its content is supported by Markdown.

Moves and renames update relative Markdown links within participating roots, rebase outgoing links, and copy referenced local assets into a new root when needed. Other roots are not searched for backlinks. Trash moves the file into recoverable app storage and leaves assets in place. Restore uses the original path, requesting a different filename if occupied.

## Markdown and images

The dedicated editor uses pinned `@tiptap/markdown` 3.31.3 with adapters for Stash lists and tasks. It supports headings, paragraphs, emphasis, strike, lists and tasks, quotes, fenced code, tables, links, and images. Mermaid stays a fenced code block.

Frontmatter, comments, HTML, reference definitions, and detected unsupported extension syntax appear as labeled source blocks. HTML is displayed as source and is never executed. Original Markdown is retained until content changes. Edited documents can normalize Markdown layout while retaining the original newline style and untouched source blocks. Unsupported rich-text features are disabled, and transactions and serialization are validated before writing.

Relative links and heading fragments navigate between linked notes. New linked-note references serialize as relative Markdown paths; database-note references use Stash links. Local images are read through a root-scoped native command. Pasted, dropped, or selected image files are saved under the note's adjacent `assets/` folder with content-derived names. Existing URLs stay unchanged; unused assets are not removed automatically.

## Refresh and conflict recovery

Stash rescans at startup, on entering a linked notebook, and through **Refresh folder**. Opening or reactivating a note checks its current disk contents. External edits do not interrupt an active editing session. Clean stale documents reload and only their old editor/undo session is reset.

Every file-changing save checks the expected content fingerprint. A mismatch retains both versions and offers **Load disk version**, **Save my edits as a copy**, and **Overwrite disk version**. Resolution checks the file again. A failed resolution retains the draft and retries the same operation. Conflicting notes do not block unrelated saves, but they do block normal quit until resolved.

A missing or inaccessible file keeps its cached document read-only, with Retry and root-folder reselection. Stash does not silently recreate it. Editing a linked notebook's name changes only its Stash label and does not rename the disk folder. The filesystem journal and source cache are stored in SQLite schema 4; notebook icons are stored in schema 5. See [local storage](LOCAL_STORAGE.md) for migration and durability details.

## Boundaries

- One folder per root; overlapping roots are rejected.
- No metadata is inserted into Markdown and no background watcher is installed.
- Folder renaming/reparenting and conversion back to database-only storage are outside this feature. Folder-linked notebooks cannot be deleted, while database notebooks support child promotion or whole-subtree deletion.
- Safe filesystem mutations currently require macOS atomic swap and exclusive rename support. An unsupported filesystem fails visibly.
- Session undo does not survive restart. A conflict draft and journal protect attempted saves, but Force Quit can still lose edits before autosave starts.

## Validation

The frontend suite passes 179 tests; Rust passes 40 tests (plus the existing ignored crash helper, invoked by its parent test). Automated tests use temporary folders and libraries. Coverage includes the supplied A/C/D tree, deeper descendants, symlinks, empty roots, Unicode names, uppercase extensions, Markdown round trips, metadata-only saves, icon persistence, image persistence, creation/duplication, rename and reference link changes, cross-root moves and asset copying, notebook deletion, child promotion, shared memberships, trash/restore collisions, missing files, permission failures, conflicts, schema-3 backup and rollback, stale editor replacement, and recovery at six save stages and two child-folder stages. Existing ordinary-note, editor-session, workspace, and quit tests remain included.

An isolated **Stash Folder Review** desktop bundle (`local.upnote2.folder-review`) verified the native picker, recursive import, custom notebook display name, unchanged source bytes after import, editing the actual Markdown file, and conflict detection. Saving a conflict copy preserved both the external file and the local copy, but exposed a React cleanup failure. That failure was fixed and reproduced in a passing mounted-editor regression test. The final native recheck is pending because macOS locked during validation. This status must be updated after checking the rebuilt app on an unlocked Mac.

The real Stash library and `/Users/slowtyper/Work/ech0/ech0-technical-docs` were not used for write tests. The existing Vite large-chunk warning and jsdom `scrollBy` warning remain unrelated to this change. An existing preview behavior also remains: selecting an empty notebook can leave the previous note open in the editor while its note list is empty.

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
make release
```
