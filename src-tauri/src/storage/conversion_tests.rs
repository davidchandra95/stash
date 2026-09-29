use super::conversion::Document;
use super::*;
use serde_json::json;

fn setup() -> (tempfile::TempDir, tempfile::TempDir, Store, String) {
    let library = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    fs::create_dir_all(folder.path().join("child")).unwrap();
    fs::write(folder.path().join("a.md"), "# First\n\nText").unwrap();
    fs::write(folder.path().join("child/b.md"), "# Second").unwrap();
    let mut store = Store::open(library.path()).unwrap();
    let data = store
        .link_folder(folder.path().to_str().unwrap(), "Imported", None)
        .unwrap();
    let id = data.roots[0].id.clone();
    let child = data.notebooks.iter().find(|b| b.name == "child").unwrap();
    store.create_child(&child.id, "empty").unwrap();
    (library, folder, store, id)
}
fn documents(notes: &[Note]) -> Vec<Document> {
    notes.iter().map(|n| Document { id: n.id.clone(), text: n.source.as_ref().unwrap().markdown.clone().unwrap(), content: json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Native content"}]}]}) }).collect()
}
#[test]
fn conversion_preserves_identity_metadata_empty_folders_and_survives_restart() {
    let (lib, folder, mut store, id) = setup();
    let before = store.library().unwrap();
    let note_id = before.notes[0].id.clone();
    store
        .conn
        .execute(
            "UPDATE notes SET pinned=1,quick_access=1 WHERE id=?",
            [&note_id],
        )
        .unwrap();
    store
        .conn
        .execute("INSERT INTO note_tags VALUES(?,'kept')", [&note_id])
        .unwrap();
    let prepared = store.prepare_conversion(&id).unwrap();
    assert_eq!(prepared.notes.len(), 2); // Includes documents never opened in the editor.
    assert!(prepared.library.notebooks.iter().any(|b| b.name == "empty"));
    let data = store
        .commit_conversion(&prepared.token, documents(&prepared.notes))
        .unwrap();
    assert!(data.roots.is_empty());
    assert!(data
        .notebooks
        .iter()
        .all(|b| b.root_id.is_none() && b.relative_path.is_none()));
    for original in &prepared.notes {
        let native = store.load_note(&original.id).unwrap();
        assert!(native.source.is_none());
        assert_eq!(native.created, original.created);
        assert_eq!(native.updated, original.updated);
        assert_eq!(native.notebook_ids, original.notebook_ids);
        assert_eq!(native.tags, original.tags);
        assert_eq!(native.pinned, original.pinned);
        assert_eq!(native.quick_access, original.quick_access);
        assert_eq!(native.revision, original.revision + 1);
    }
    assert_eq!(
        fs::read_to_string(folder.path().join("a.md")).unwrap(),
        "# First\n\nText"
    );
    assert!(store.sync_status().unwrap().pending >= 5);
    drop(store);
    let moved = lib.path().join("detached-original");
    fs::rename(folder.path(), &moved).unwrap();
    let mut reopened = Store::open(lib.path()).unwrap();
    assert!(reopened.open_linked_library().unwrap().roots.is_empty());
    assert_eq!(
        reopened.load_note(&note_id).unwrap().content.unwrap()["content"][0]["content"][0]["text"],
        "Native content"
    );
}
#[test]
fn conversion_rejects_changed_inventory_markdown_images_and_library() {
    for change in ["new", "markdown", "image", "library", "directory"] {
        let (_lib, folder, mut store, id) = setup();
        fs::write(folder.path().join("pic.png"), b"first").unwrap();
        let prepared = store.prepare_conversion(&id).unwrap();
        let note = prepared
            .notes
            .iter()
            .find(|n| n.source.as_ref().unwrap().relative_path == "a.md")
            .unwrap();
        let image = store
            .conversion_image(&prepared.token, &note.id, "pic.png")
            .unwrap();
        assert!(image.starts_with("data:image/png;base64,"));
        match change {
            "new" => fs::write(folder.path().join("new.md"), "new").unwrap(),
            "markdown" => fs::write(folder.path().join("a.md"), "Changed").unwrap(),
            "image" => fs::write(folder.path().join("pic.png"), "other").unwrap(),
            "directory" => fs::create_dir(folder.path().join("new-empty")).unwrap(),
            _ => {
                store
                    .conn
                    .execute(
                        "UPDATE notes SET revision=revision+1 WHERE id=?",
                        [&note.id],
                    )
                    .unwrap();
            }
        }
        assert!(
            store
                .commit_conversion(&prepared.token, documents(&prepared.notes))
                .is_err(),
            "{change}"
        );
        assert_eq!(store.roots().unwrap().len(), 1);
        assert!(store
            .library()
            .unwrap()
            .notes
            .iter()
            .all(|n| n.source.is_some()));
    }
}
#[test]
fn conversion_stops_on_missing_sources_without_partial_preparation() {
    let (_lib, folder, mut store, id) = setup();
    let before = serde_json::to_string(&store.library().unwrap()).unwrap();
    fs::remove_file(folder.path().join("a.md")).unwrap();
    assert!(store.prepare_conversion(&id).unwrap_err().contains("a.md"));
    assert_eq!(store.roots().unwrap().len(), 1);
    assert_eq!(
        serde_json::to_string(&store.library().unwrap()).unwrap(),
        before
    );
}
#[test]
fn conversion_rolls_back_database_failure_and_rejects_invalid_or_partial_documents() {
    let (_lib, _folder, mut store, id) = setup();
    let prepared = store.prepare_conversion(&id).unwrap();
    assert!(store.commit_conversion(&prepared.token, vec![]).is_err());
    let mut invalid = documents(&prepared.notes);
    invalid[0].content = json!({"type":"doc","content":[{"type":"rawMarkdown"}]});
    assert!(store.commit_conversion(&prepared.token, invalid).is_err());
    store.conn.execute_batch("CREATE TEMP TRIGGER fail_conversion BEFORE DELETE ON linked_roots BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(store
        .commit_conversion(&prepared.token, documents(&prepared.notes))
        .is_err());
    for original in &prepared.notes {
        let note = store.note(&original.id, true).unwrap();
        assert!(note.source.is_some());
        assert_eq!(note.revision, original.revision);
    }
    assert!(store
        .notebooks()
        .unwrap()
        .iter()
        .all(|b| b.root_id.is_some()));
    store
        .conn
        .execute_batch("DROP TRIGGER fail_conversion")
        .unwrap();
    assert!(store
        .commit_conversion(&prepared.token, documents(&prepared.notes))
        .is_ok());
}
#[test]
fn conversion_includes_trash_and_rejects_child_or_conflicted_notebooks() {
    let (_lib, folder, mut store, id) = setup();
    let library = store.library().unwrap();
    let child = library.notebooks.iter().find(|b| b.id != id).unwrap();
    assert!(store.prepare_conversion(&child.id).is_err());
    let note = &library.notes[0];
    let trash = store.path.parent().unwrap().join("file-trash");
    fs::create_dir(&trash).unwrap();
    let trash_path = trash.join("test.md");
    fs::rename(
        folder
            .path()
            .join(&note.source.as_ref().unwrap().relative_path),
        &trash_path,
    )
    .unwrap();
    store
        .conn
        .execute(
            "UPDATE linked_notes SET trash_path=? WHERE note_id=?",
            params![trash_path.to_str().unwrap(), note.id],
        )
        .unwrap();
    store
        .conn
        .execute("UPDATE notes SET trashed_at=123 WHERE id=?", [&note.id])
        .unwrap();
    let prepared = store.prepare_conversion(&id).unwrap();
    assert!(prepared.notes.iter().any(|n| n.trashed));
    store
        .commit_conversion(&prepared.token, documents(&prepared.notes))
        .unwrap();
    let native = store.load_note(&note.id).unwrap();
    assert_eq!(native.trashed_at, Some(123));
    assert!(native.source.is_none());
    assert!(trash_path.exists());
}
#[test]
fn conversion_missing_images_and_symlinks_are_rejected() {
    let (_lib, folder, mut store, id) = setup();
    let prepared = store.prepare_conversion(&id).unwrap();
    let note = prepared
        .notes
        .iter()
        .find(|n| n.source.as_ref().unwrap().relative_path == "a.md")
        .unwrap();
    assert!(store
        .conversion_image(&prepared.token, &note.id, "missing.png")
        .is_err());
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("pic.png"), "image").unwrap();
    std::os::unix::fs::symlink(outside.path(), folder.path().join("assets")).unwrap();
    assert!(store
        .conversion_image(&prepared.token, &note.id, "assets/pic.png")
        .is_err());
    assert_eq!(store.roots().unwrap().len(), 1);
}
#[test]
fn conversion_accepts_a_completely_empty_root() {
    let library = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let mut store = Store::open(library.path()).unwrap();
    let data = store
        .link_folder(folder.path().to_str().unwrap(), "Empty", None)
        .unwrap();
    let prepared = store.prepare_conversion(&data.roots[0].id).unwrap();
    let result = store.commit_conversion(&prepared.token, vec![]).unwrap();
    assert_eq!(result.notebooks.len(), 1);
    assert!(result.roots.is_empty());
}

#[test]
fn conversion_blocks_unresolved_conflicts_and_pending_file_operations() {
    let (_lib, _folder, mut store, id) = setup();
    let note_id = store.library().unwrap().notes[0].id.clone();
    store
        .conn
        .execute(
            "INSERT INTO file_conflicts VALUES(?,'{}','conflict')",
            [&note_id],
        )
        .unwrap();
    assert!(store
        .prepare_conversion(&id)
        .unwrap_err()
        .contains("conflicts"));
    store
        .conn
        .execute("DELETE FROM file_conflicts", [])
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO file_operations VALUES('operation','{}','prepared')",
            [],
        )
        .unwrap();
    assert!(store
        .prepare_conversion(&id)
        .unwrap_err()
        .contains("pending file operations"));
}
#[test]
fn conversion_embeds_images_syncs_native_content_and_native_edits_leave_original_bytes() {
    let (_lib, folder, mut store, id) = setup();
    fs::write(folder.path().join("pic.png"), b"image data").unwrap();
    let prepared = store.prepare_conversion(&id).unwrap();
    let original = prepared
        .notes
        .iter()
        .find(|n| n.source.as_ref().unwrap().relative_path == "a.md")
        .unwrap();
    let image = store
        .conversion_image(&prepared.token, &original.id, "pic.png")
        .unwrap();
    let mut docs = documents(&prepared.notes);
    let doc = docs.iter_mut().find(|d| d.id == original.id).unwrap();
    doc.content = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":image}}]}]});
    store.commit_conversion(&prepared.token, docs).unwrap();
    let native = store.load_note(&original.id).unwrap();
    store
        .save_note(&SaveNote {
            id: native.id.clone(),
            title: "Native title".into(),
            notebook_ids: native.notebook_ids.clone(),
            quick_access: native.quick_access,
            tags: native.tags.clone(),
            content: native.content.clone(),
            text: native.text.clone(),
            pinned: native.pinned,
            trashed: native.trashed,
            markdown: None,
            expected_fingerprint: None,
            expected_revision: native.revision,
            operation_id: uuid::Uuid::new_v4().to_string(),
        })
        .unwrap();
    assert_eq!(
        fs::read_to_string(folder.path().join("a.md")).unwrap(),
        "# First\n\nText"
    );
    assert_eq!(
        fs::read(folder.path().join("pic.png")).unwrap(),
        b"image data"
    );
    assert!(!folder.path().join("Native title.md").exists());
    store.prepare_sync().unwrap();
    let mut q = store
        .conn
        .prepare("SELECT operation FROM sync_outbox")
        .unwrap();
    let rows = q
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    let operations: Vec<Value> = rows
        .iter()
        .map(|r| serde_json::from_str(r).unwrap())
        .collect();
    let synced = operations
        .iter()
        .find(|op| op["id"] == original.id && op["kind"] == "note")
        .unwrap();
    assert_eq!(synced["deleted"], false);
    assert!(synced["data"]["source"].is_null());
    assert!(synced.to_string().contains(&image));
    assert_eq!(
        operations
            .iter()
            .filter(|op| op["kind"] == "notebook" && op["deleted"] == false)
            .count(),
        3
    );
}
