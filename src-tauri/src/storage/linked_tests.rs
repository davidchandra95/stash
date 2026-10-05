use super::file_io::{self, Change};
use super::linked::{FileRecord, Operation};
use super::*;
use serde_json::json;

fn input(note: &Note) -> SaveNote {
    SaveNote {
        id: note.id.clone(),
        title: note.title.clone(),
        notebook_ids: note.notebook_ids.clone(),
        quick_access: note.quick_access,
        tags: note.tags.clone(),
        content: note.content.clone(),
        text: note.text.clone(),
        pinned: note.pinned,
        trashed: note.trashed,
        expected_revision: note.revision,
        operation_id: uuid::Uuid::new_v4().to_string(),
        markdown: None,
        expected_fingerprint: note.source.as_ref().map(|s| s.fingerprint.clone()),
    }
}
fn setup() -> (tempfile::TempDir, tempfile::TempDir, Store, Note) {
    let library = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    fs::write(folder.path().join("a.md"), "# Original\n\nKeep this.\n").unwrap();
    let mut store = Store::open(library.path()).unwrap();
    let data = store
        .link_folder(folder.path().to_str().unwrap(), "My notebook", None)
        .unwrap();
    let note = store.load_note(&data.notes[0].id).unwrap();
    (library, folder, store, note)
}
fn save_books(store: &mut Store, books: Vec<Notebook>, operation_id: &str) {
    let revision = store.library().unwrap().preferences_revision;
    store
        .save_preferences(&SavePreferences {
            workspace: None,
            appearance: json!({
                "dark": true,
                "theme": "qrafthive",
                "width": 80,
                "size": 17,
                "uiFont": "system",
                "noteFont": "georgia",
                "codeFont": "menlo"
            }),
            notebooks: books,
            expected_revision: revision,
            operation_id: operation_id.into(),
        })
        .unwrap();
}
#[test]
fn imports_tree_without_writing_files_and_keeps_intermediate_folders() {
    let lib = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    for dir in ["C", "D", "E/F", ".git"] {
        fs::create_dir_all(folder.path().join(dir)).unwrap();
    }
    for (name, body) in [
        ("a.md", "a"),
        ("b.MD", "b"),
        ("C/pain.txt", "pain"),
        ("C/hehe.md", "hehe"),
        ("D/random.mp3", "music"),
        ("E/F/deep.md", "deep"),
        (".git/hidden.md", "ignore"),
    ] {
        fs::write(folder.path().join(name), body).unwrap();
    }
    std::os::unix::fs::symlink(folder.path().join("C"), folder.path().join("shortcut")).unwrap();
    let mut store = Store::open(lib.path()).unwrap();
    let data = store
        .link_folder(folder.path().to_str().unwrap(), "Display name", None)
        .unwrap();
    assert_eq!(data.notes.len(), 4);
    let names: Vec<_> = data.notebooks.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, vec!["Display name", "C", "E", "F"]);
    assert_eq!(fs::read_to_string(folder.path().join("a.md")).unwrap(), "a");
    assert!(!folder.path().join("Display name").exists());
    assert!(store
        .link_folder(folder.path().join("C").to_str().unwrap(), "Again", None)
        .is_err());
}
#[test]
fn edits_metadata_rename_and_external_conflicts_are_safe() {
    let (_lib, folder, mut store, note) = setup();
    let path = folder.path().join("a.md");
    let before = fs::metadata(&path).unwrap().modified().unwrap();
    let mut edit = input(&note);
    edit.pinned = true;
    store.save_note(&edit).unwrap();
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before);
    let saved = store.load_note(&note.id).unwrap();
    let mut edit = input(&saved);
    edit.markdown = Some("# Updated\n".into());
    store.save_note(&edit).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Updated\n");
    assert_eq!(store.save_note(&edit).unwrap().revision, saved.revision + 1);
    let saved = store.load_note(&note.id).unwrap();
    let mut stale = input(&saved);
    stale.markdown = Some("Local edits".into());
    fs::write(&path, "VS Code edits").unwrap();
    assert!(store
        .save_note(&stale)
        .unwrap_err()
        .starts_with("FILE_CONFLICT:"));
    assert_eq!(fs::read_to_string(&path).unwrap(), "VS Code edits");
    let external = store.load_note(&note.id).unwrap();
    assert_eq!(external.source.unwrap().markdown.unwrap(), "VS Code edits");
}
#[test]
fn linked_notebook_metadata_edits_keep_the_folder_and_linked_notes_use_trash() {
    let (_lib, folder, mut store, note) = setup();
    let root_id = note.source.as_ref().unwrap().root_id.clone();
    let original_path = folder.path().join("a.md");
    let mut root = store
        .notebooks()
        .unwrap()
        .into_iter()
        .find(|book| book.id == root_id)
        .unwrap();
    root.name = "Display label".into();
    root.color = "#c56a5d".into();
    root.icon = "archive".into();
    save_books(&mut store, vec![root.clone()], "linked-metadata");
    let saved_root = store
        .notebooks()
        .unwrap()
        .into_iter()
        .find(|book| book.id == root_id)
        .unwrap();
    assert_eq!(saved_root.name, "Display label");
    assert_eq!(saved_root.color, "#c56a5d");
    assert_eq!(saved_root.icon, "archive");
    assert_eq!(saved_root.relative_path.as_deref(), Some(""));
    assert!(original_path.exists());

    let mut local = root.clone();
    local.id = "local".into();
    local.name = "Local".into();
    local.icon = "notebook".into();
    local.root_id = None;
    local.relative_path = None;
    local.parent_id = None;
    save_books(&mut store, vec![root, local], "add-local");
    let mut joined = input(&store.load_note(&note.id).unwrap());
    joined.notebook_ids.push("local".into());
    store.save_note(&joined).unwrap();

    store
        .delete_notebook(&DeleteNotebookRequest {
            id: "local".into(),
            include_children: false,
            delete_notes: true,
            operation_id: "delete-local".into(),
        })
        .unwrap();
    assert!(!original_path.exists());
    let trashed = store.note(&note.id, true).unwrap();
    assert!(trashed.trashed);
    assert_eq!(trashed.notebook_ids, vec![root_id.clone()]);
    let trash_path = trashed.source.unwrap().trash_path.unwrap();
    assert!(Path::new(&trash_path).exists());
    assert!(trash_path.contains("file-trash"));

    let mut restore = input(&store.note(&note.id, true).unwrap());
    restore.trashed = false;
    restore.operation_id = "restore-linked".into();
    store.save_note(&restore).unwrap();
    assert!(original_path.exists());
}

#[test]
fn linked_notebooks_cannot_be_deleted() {
    let (_lib, folder, mut store, note) = setup();
    let root_id = note.source.as_ref().unwrap().root_id.clone();
    let error = store
        .delete_notebook(&DeleteNotebookRequest {
            id: root_id.clone(),
            include_children: true,
            delete_notes: true,
            operation_id: "delete-linked".into(),
        })
        .unwrap_err();
    assert!(error.contains("Folder-linked"));
    assert!(folder.path().join("a.md").exists());
    assert!(store
        .notebooks()
        .unwrap()
        .iter()
        .any(|book| book.id == root_id));
}
#[test]
fn rename_updates_inline_and_reference_links_but_not_code() {
    let (_lib, folder, mut store, note) = setup();
    fs::write(
        folder.path().join("b.md"),
        "[go](a.md#original)\n\n[ref][a]\n\n[a]: a.md\n\n```\n[code](a.md)\n```\n",
    )
    .unwrap();
    let root = note.source.as_ref().unwrap().root_id.clone();
    store.refresh_root(&root).unwrap();
    let mut edit = input(&store.load_note(&note.id).unwrap());
    edit.title = "renamed".into();
    store.save_note(&edit).unwrap();
    assert!(!folder.path().join("a.md").exists());
    assert!(folder.path().join("renamed.md").exists());
    let links = fs::read_to_string(folder.path().join("b.md")).unwrap();
    assert!(links.contains("[go](renamed.md#original)"));
    assert!(links.contains("[a]: renamed.md"));
    assert!(links.contains("[code](a.md)"));
}
#[test]
fn creates_duplicates_children_and_restores_without_overwriting() {
    let (_lib, folder, mut store, note) = setup();
    let root = note.source.as_ref().unwrap().root_id.clone();
    let child = store
        .create_child(&root, "Child")
        .unwrap()
        .notebooks
        .into_iter()
        .find(|b| b.name == "Child")
        .unwrap();
    assert!(folder.path().join("Child").is_dir());
    store.refresh_root(&root).unwrap();
    assert!(store
        .library()
        .unwrap()
        .notebooks
        .iter()
        .any(|b| b.id == child.id));
    let mut new = input(&note);
    new.id = uuid::Uuid::new_v4().to_string();
    new.expected_revision = 0;
    new.markdown = Some("new".into());
    new.content = Some(json!({"type":"doc","content":[{"type":"paragraph"}]}));
    store.save_note(&new).unwrap();
    assert!(folder.path().join("a 2.md").exists());
    let mut trash = input(&store.load_note(&note.id).unwrap());
    trash.trashed = true;
    store.save_note(&trash).unwrap();
    assert!(!folder.path().join("a.md").exists());
    let saved = store.load_note(&note.id).unwrap();
    assert!(Path::new(saved.source.as_ref().unwrap().trash_path.as_ref().unwrap()).exists());
    fs::write(folder.path().join("a.md"), "new external file").unwrap();
    let mut restore = input(&saved);
    restore.trashed = false;
    assert!(store
        .save_note(&restore)
        .unwrap_err()
        .starts_with("NAME_COLLISION:"));
    restore.title = "restored".into();
    store.save_note(&restore).unwrap();
    assert_eq!(
        fs::read_to_string(folder.path().join("a.md")).unwrap(),
        "new external file"
    );
    assert!(folder.path().join("restored.md").exists());
}
#[test]
fn moves_across_roots_and_copies_local_assets() {
    let (_lib, source, mut store, note) = setup();
    let target = tempfile::tempdir().unwrap();
    fs::create_dir(source.path().join("assets")).unwrap();
    fs::write(source.path().join("assets/pic.png"), [1, 2, 3]).unwrap();
    fs::write(source.path().join("a.md"), "![pic](assets/pic.png)\n").unwrap();
    let data = store
        .link_folder(target.path().to_str().unwrap(), "Target", None)
        .unwrap();
    let target_id = data
        .roots
        .iter()
        .find(|r| Path::new(&r.path) == fs::canonicalize(target.path()).unwrap())
        .unwrap()
        .id
        .clone();
    let mut edit = input(&store.load_note(&note.id).unwrap());
    edit.notebook_ids = vec![target_id];
    store.save_note(&edit).unwrap();
    assert!(!source.path().join("a.md").exists());
    let markdown = fs::read_to_string(target.path().join("a.md")).unwrap();
    assert!(markdown.contains("assets/"));
    assert_eq!(
        fs::read_dir(target.path().join("assets")).unwrap().count(),
        1
    );
    assert!(source.path().join("assets/pic.png").exists());
}
#[test]
fn restart_recovers_an_interrupted_file_write_and_keeps_newer_external_bytes() {
    let (lib, folder, store, note) = setup();
    let path = fs::canonicalize(folder.path()).unwrap().join("a.md");
    let mut edit = input(&note);
    edit.markdown = Some("durable next".into());
    let source = note.source.as_ref().unwrap();
    let change = Change::new(
        path.clone(),
        Some(fs::read(&path).unwrap()),
        Some(b"durable next".to_vec()),
        &edit.operation_id,
    );
    let op = Operation {
        notebook: None,
        directory: None,
        id: edit.operation_id.clone(),
        changes: vec![change],
        note: Some(edit),
        records: vec![FileRecord {
            note_id: note.id.clone(),
            root_id: source.root_id.clone(),
            relative_path: source.relative_path.clone(),
            markdown: "durable next".into(),
            fingerprint: file_io::hash(b"durable next"),
            trash_path: None,
        }],
    };
    store
        .conn
        .execute(
            "INSERT INTO file_operations VALUES(?,?,'prepared')",
            params![op.id, serde_json::to_string(&op).unwrap()],
        )
        .unwrap();
    op.changes[0].apply().unwrap();
    drop(store);
    let mut store = Store::open(lib.path()).unwrap();
    store.open_linked_library().unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "durable next");
    assert_eq!(store.note(&note.id, false).unwrap().revision, 2);
    let mut conflict = op.clone();
    conflict.id = uuid::Uuid::new_v4().to_string();
    conflict.changes[0].before = Some(b"durable next".to_vec());
    conflict.changes[0].after = Some(b"another edit".to_vec());
    store
        .conn
        .execute(
            "INSERT INTO file_operations VALUES(?,?,'prepared')",
            params![conflict.id, serde_json::to_string(&conflict).unwrap()],
        )
        .unwrap();
    fs::write(&path, "newer external").unwrap();
    drop(store);
    let mut store = Store::open(lib.path()).unwrap();
    store.open_linked_library().unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "newer external");
}
#[test]
fn missing_files_are_read_only_and_assets_cannot_escape_the_root() {
    let (_lib, folder, mut store, note) = setup();
    fs::remove_file(folder.path().join("a.md")).unwrap();
    assert!(store
        .load_note(&note.id)
        .unwrap()
        .source
        .unwrap()
        .unavailable
        .is_some());
    assert!(store.read_asset(&note.id, "../../secret.png").is_err());
    assert!(!folder.path().join("a.md").exists());
}

#[test]
fn version_seven_moves_linked_legacy_tags_into_markdown_and_retries_when_the_file_returns() {
    let (library, folder, store, note) = setup();
    store
        .conn
        .execute(
            "DELETE FROM tag_body_migrations WHERE note_id=?",
            [&note.id],
        )
        .unwrap();
    store
        .conn
        .execute("INSERT INTO note_tags VALUES(?,'My Project')", [&note.id])
        .unwrap();
    store
        .conn
        .execute_batch("DROP TABLE pdf_companions; DROP TABLE pdf_reading; DROP TABLE pdf_documents; DROP TABLE tag_body_migrations; PRAGMA user_version=6;")
        .unwrap();
    fs::remove_file(folder.path().join("a.md")).unwrap();
    drop(store);

    let mut store = Store::open(library.path()).unwrap();
    store.open_linked_library().unwrap();
    let unavailable = store.note(&note.id, false).unwrap();
    assert_eq!(unavailable.tags, vec!["My Project"]);
    assert!(unavailable.source.unwrap().unavailable.is_some());

    fs::write(folder.path().join("a.md"), "# Original\n\nKeep this.\n").unwrap();
    store.open_linked_library().unwrap();
    assert_eq!(
        fs::read_to_string(folder.path().join("a.md")).unwrap(),
        "# Original\n\nKeep this.\n\nTags: #my-project\n"
    );
    let migrated = store.note(&note.id, true).unwrap();
    assert_eq!(migrated.tags, vec!["my-project"]);
    assert_eq!(
        store
            .conn
            .query_row(
                "SELECT count(*) FROM tag_body_migrations WHERE note_id=?",
                [&note.id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    let revision = migrated.revision;
    store.open_linked_library().unwrap();
    assert_eq!(
        fs::read_to_string(folder.path().join("a.md")).unwrap(),
        "# Original\n\nKeep this.\n\nTags: #my-project\n"
    );
    assert_eq!(store.note(&note.id, false).unwrap().revision, revision);
}

#[test]
fn empty_roots_manual_children_unicode_and_uppercase_extensions_survive_restart() {
    let lib = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let mut store = Store::open(lib.path()).unwrap();
    let data = store
        .link_folder(folder.path().to_str().unwrap(), "Empty", None)
        .unwrap();
    assert!(data.notes.is_empty());
    let root = data.notebooks[0].id.clone();
    store.create_child(&root, "日本語 café").unwrap();
    fs::write(folder.path().join("UPPER.MD"), "# Heading stays\r\n").unwrap();
    store.refresh_root(&root).unwrap();
    let id = store.library().unwrap().notes[0].id.clone();
    let note = store.load_note(&id).unwrap();
    let mut edit = input(&note);
    edit.markdown = Some("# Heading stays\r\n\r\nEdited\r\n".into());
    store.save_note(&edit).unwrap();
    assert!(folder.path().join("UPPER.MD").is_file());
    assert!(!folder.path().join("UPPER.md").exists() || cfg!(target_os = "macos"));
    assert_eq!(
        store
            .file_source(&id, false)
            .unwrap()
            .unwrap()
            .relative_path,
        "UPPER.MD"
    );
    drop(store);
    let mut store = Store::open(lib.path()).unwrap();
    let data = store.open_linked_library().unwrap();
    assert!(data.notebooks.iter().any(|b| b.name == "日本語 café"));
    assert!(folder.path().join("日本語 café").is_dir());
}

#[test]
fn image_assets_are_durable_and_symlinks_are_rejected() {
    use base64::Engine;
    let (_lib, folder, mut store, note) = setup();
    let data = base64::engine::general_purpose::STANDARD.encode(b"test image bytes");
    let href = store.write_asset(&note.id, "photo.png", &data).unwrap();
    assert_eq!(
        store.write_asset(&note.id, "photo.png", &data).unwrap(),
        href
    );
    assert_eq!(
        store.read_asset(&note.id, &href).unwrap(),
        format!("data:image/png;base64,{data}")
    );
    fs::rename(
        folder.path().join("assets"),
        folder.path().join("original-assets"),
    )
    .unwrap();
    std::os::unix::fs::symlink(
        folder.path().join("original-assets"),
        folder.path().join("assets"),
    )
    .unwrap();
    assert!(store.read_asset(&note.id, &href).is_err());
    assert!(store.write_asset(&note.id, "other.png", &data).is_err());
}

#[test]
fn recovery_checks_paths_again_after_parent_becomes_a_symlink() {
    let (lib, folder, store, note) = setup();
    let root = note.source.as_ref().unwrap().root_id.clone();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("a.md"), "outside").unwrap();
    fs::create_dir(folder.path().join("child")).unwrap();
    let path = fs::canonicalize(folder.path()).unwrap().join("child/a.md");
    let op = Operation {
        id: "symlink-recovery".into(),
        notebook: None,
        directory: None,
        note: Some(input(&note)),
        records: vec![],
        changes: vec![Change::new(path, None, Some(b"unsafe".to_vec()), "symlink")],
    };
    store
        .conn
        .execute(
            "INSERT INTO file_operations VALUES(?,?,'prepared')",
            params![op.id, serde_json::to_string(&op).unwrap()],
        )
        .unwrap();
    fs::remove_dir(folder.path().join("child")).unwrap();
    std::os::unix::fs::symlink(outside.path(), folder.path().join("child")).unwrap();
    drop(store);
    let mut store = Store::open(lib.path()).unwrap();
    store.open_linked_library().unwrap();
    assert_eq!(
        fs::read_to_string(outside.path().join("a.md")).unwrap(),
        "outside"
    );
    assert_eq!(store.pending_conflicts().unwrap().len(), 1);
    assert!(store.root_path(&root).is_ok());
}

#[test]
fn child_directory_recovers_before_and_after_exclusive_rename() {
    for applied in [false, true] {
        let (lib, folder, store, note) = setup();
        let source = note.source.unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let path = fs::canonicalize(folder.path())
            .unwrap()
            .join("Manual empty");
        let directory = file_io::DirectoryChange::stage(path.clone(), &id).unwrap();
        let op = Operation {
            id: id.clone(),
            notebook: Some(Notebook {
                id: id.clone(),
                name: "Manual empty".into(),
                color: "green".into(),
                icon: "folder".into(),
                parent_id: Some(source.root_id.clone()),
                root_id: Some(source.root_id),
                relative_path: Some("Manual empty".into()),
            }),
            directory: Some(directory),
            note: None,
            records: vec![],
            changes: vec![],
        };
        store
            .conn
            .execute(
                "INSERT INTO file_operations VALUES(?,?,'prepared')",
                params![id, serde_json::to_string(&op).unwrap()],
            )
            .unwrap();
        if applied {
            op.directory.as_ref().unwrap().apply().unwrap();
        }
        drop(store);
        let mut store = Store::open(lib.path()).unwrap();
        let data = store.open_linked_library().unwrap();
        assert!(path.is_dir());
        assert_eq!(data.notebooks.iter().filter(|b| b.id == id).count(), 1);
    }
}

#[test]
fn recovery_is_idempotent_at_every_save_stage() {
    for stage in 0..6 {
        let (lib, folder, mut store, note) = setup();
        let path = fs::canonicalize(folder.path()).unwrap().join("a.md");
        let mut edit = input(&note);
        edit.markdown = Some("Complete replacement".into());
        let source = note.source.as_ref().unwrap();
        let op = Operation {
            id: edit.operation_id.clone(),
            notebook: None,
            directory: None,
            note: Some(edit.clone()),
            changes: vec![Change::new(
                path.clone(),
                Some(fs::read(&path).unwrap()),
                Some(b"Complete replacement".to_vec()),
                &edit.operation_id,
            )],
            records: vec![FileRecord {
                note_id: note.id.clone(),
                root_id: source.root_id.clone(),
                relative_path: source.relative_path.clone(),
                markdown: "Complete replacement".into(),
                fingerprint: file_io::hash(b"Complete replacement"),
                trash_path: None,
            }],
        };
        store
            .conn
            .execute(
                "INSERT INTO file_operations VALUES(?,?,'prepared')",
                params![op.id, serde_json::to_string(&op).unwrap()],
            )
            .unwrap();
        if stage == 1 {
            file_io::write_new(&op.changes[0].staging, b"Complete replacement").unwrap();
        }
        if stage >= 2 {
            op.changes[0].apply().unwrap();
        }
        if stage >= 3 {
            store
                .conn
                .execute(
                    "UPDATE file_operations SET state='applied' WHERE id=?",
                    [&op.id],
                )
                .unwrap();
        }
        if stage >= 4 {
            store.save_note_record(&edit).unwrap();
        }
        if stage >= 5 {
            store.execute_operation(&op).unwrap();
        }
        drop(store);
        let mut store = Store::open(lib.path()).unwrap();
        store.open_linked_library().unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "Complete replacement",
            "stage {stage}"
        );
        assert_eq!(
            store.note(&note.id, false).unwrap().revision,
            2,
            "stage {stage}"
        );
        assert_eq!(
            store
                .file_source(&note.id, true)
                .unwrap()
                .unwrap()
                .markdown
                .as_deref(),
            Some("Complete replacement")
        );
        assert_eq!(store.save_note(&edit).unwrap().revision, 2);
    }
}

#[test]
fn directory_permission_failure_leaves_original_bytes_and_can_retry() {
    use std::os::unix::fs::PermissionsExt;
    let (_lib, folder, mut store, note) = setup();
    let path = folder.path().join("a.md");
    let before = fs::read(&path).unwrap();
    let mut edit = input(&note);
    edit.markdown = Some("New bytes".into());
    fs::set_permissions(folder.path(), fs::Permissions::from_mode(0o555)).unwrap();
    let failed = store.save_note(&edit);
    fs::set_permissions(folder.path(), fs::Permissions::from_mode(0o755)).unwrap();
    assert!(failed.is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    store.save_note(&edit).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "New bytes");
}
