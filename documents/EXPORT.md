# Export

Desktop exports notes as files. Print is not part of this.

- **One note**: right-click it (or Note actions) → **Export as Markdown…** or **Export as HTML…**, then choose where to save. Markdown writes the note's embedded images into a `<name> images` folder beside the file. HTML is one self-contained page with its images embedded. The browser preview downloads the file instead, with images embedded in the Markdown.
- **A notebook**: its menu → **Export notebook…**, then choose a folder. Stash creates a new folder named after the notebook (with a number if one exists already) holding its notes and sub-notebooks as folders.
- **Everything**: command palette → **Export all notes…**. Stash creates `Stash export <date>` with a folder per top-level notebook and notes outside notebooks at the top.

Folder exports write Markdown only. Embedded images go once each into a top-level `images` folder, links between exported notes point at each other's files, and a note in several exported notebooks is written once, in the first of them. Trashed notes are skipped. Exports never overwrite: a folder export always goes into a new folder, and a single file is replaced only when the save dialog asked you to confirm it. If some notes can't be read, the rest are exported and the notice lists the failures.

## Markdown conversion

Folder notebooks need lossless Markdown and refuse anything else; export instead turns what Markdown can't hold into the nearest thing it can (`src/export/exportDocument.ts`):

- Collapsible sections become a bold line followed by their contents.
- Drawings become their preview image, or a note when no preview exists yet.
- Inline checkboxes become ☐ and ☑.
- Colors, highlights, underline, subscript, superscript, alignment and image sizes are dropped.
- Table cells become one line each; merged cells are split and the first row becomes the header.
- A `# Title` heading is added when the note doesn't already start with one.

The native `export_files` command (`src-tauri/src/export.rs`) accepts only relative paths without `..`, and creates the export folder itself. Android doesn't export yet.
