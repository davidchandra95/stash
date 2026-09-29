use super::sync::*;
use super::*;
use serde_json::json;
fn note(id: &str, text: &str, revision: i64) -> SaveNote {
    SaveNote {
        id: id.into(),
        title: text.into(),
        notebook_ids: vec![],
        quick_access: true,
        tags: vec!["tag".into()],
        content: Some(
            json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]}),
        ),
        text: text.into(),
        pinned: true,
        trashed: false,
        markdown: None,
        expected_fingerprint: None,
        expected_revision: revision,
        operation_id: uuid::Uuid::new_v4().to_string(),
    }
}
fn identity(s: &Store) {
    s.conn
        .execute("UPDATE sync_state SET library_id='test'", [])
        .unwrap();
}
fn clear(s: &Store) {
    s.conn
        .execute_batch("DELETE FROM sync_dirty; DELETE FROM sync_outbox;")
        .unwrap();
}
fn incoming(s: &Store, id: &str, revision: i64) -> Entity {
    Entity {
        kind: "note".into(),
        id: id.into(),
        revision,
        deleted: false,
        data: serde_json::to_value(s.note(id, true).unwrap()).unwrap(),
    }
}
#[test]
fn durable_queue_and_receipt_staging_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.save_note_record(&note("a", "first", 0)).unwrap();
    s.prepare_sync().unwrap();
    let before: String = s
        .conn
        .query_row("SELECT operation FROM sync_outbox", [], |r| r.get(0))
        .unwrap();
    drop(s);
    let mut s = Store::open(dir.path()).unwrap();
    s.prepare_sync().unwrap();
    let after: String = s
        .conn
        .query_row("SELECT operation FROM sync_outbox", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, after);
    // New edits after a failed cycle must not be overwritten by its eventual download.
    s.save_note_record(&note("a", "new local edit", 1)).unwrap();
    let mut e = incoming(&s, "a", 1);
    e.data["title"] = json!("remote");
    s.conn.execute("DELETE FROM sync_outbox", []).unwrap();
    s.stage_page(Page {
        library_id: "test".into(),
        changes: vec![e],
        cursor: 1,
        target: 1,
    })
    .unwrap();
    s.finish_sync().unwrap();
    assert_eq!(s.note("a", true).unwrap().title, "new local edit");
    assert!(s.sync_status().unwrap().pending > 0);
    s.prepare_sync().unwrap();
    let raw: String = s
        .conn
        .query_row("SELECT operation FROM sync_outbox", [], |r| r.get(0))
        .unwrap();
    let op: Operation = serde_json::from_str(&raw).unwrap();
    assert_eq!(op.base_revision, 0);
    assert_eq!(op.data["title"], "new local edit");
}
#[test]
fn pages_apply_atomically_and_bad_documents_do_not_advance_cursor() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.save_note_record(&note("a", "original", 0)).unwrap();
    let mut e = incoming(&s, "a", 1);
    clear(&s);
    s.prepare_sync().unwrap();
    e.data["documentVersion"] = json!(2);
    s.stage_page(Page {
        library_id: "test".into(),
        changes: vec![e.clone()],
        cursor: 1,
        target: 1,
    })
    .unwrap();
    assert!(s.finish_sync().is_err());
    assert_eq!(s.note("a", true).unwrap().title, "original");
    let cursor: i64 = s
        .conn
        .query_row("SELECT cursor FROM sync_state", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cursor, 0);
    e.data["documentVersion"] = json!(1);
    e.data["title"] = json!("downloaded");
    s.conn
        .execute(
            "UPDATE sync_inbox SET record=?",
            [serde_json::to_string(&e).unwrap()],
        )
        .unwrap();
    s.finish_sync().unwrap();
    assert_eq!(s.note("a", true).unwrap().title, "downloaded");
    assert_eq!(s.sync_status().unwrap().pending, 0);
}
#[test]
fn moving_to_folder_queues_deletion_and_download_never_replaces_linked_content() {
    let dir = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    std::fs::write(files.path().join("a.md"), "local file").unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.link_folder(files.path().to_str().unwrap(), "Files", None)
        .unwrap();
    let linked = s
        .library()
        .unwrap()
        .notes
        .into_iter()
        .find(|n| n.source.is_some())
        .unwrap();
    s.conn
        .execute("INSERT INTO sync_versions VALUES('note',?,4)", [&linked.id])
        .unwrap();
    s.prepare_sync().unwrap();
    let raw: String = s
        .conn
        .query_row(
            "SELECT operation FROM sync_outbox WHERE json_extract(operation,'$.id')=?",
            [&linked.id],
            |r| r.get(0),
        )
        .unwrap();
    let op: Operation = serde_json::from_str(&raw).unwrap();
    assert!(op.deleted);
    assert_eq!(op.base_revision, 4);
    s.conn.execute("DELETE FROM sync_outbox", []).unwrap();
    s.stage_page(Page {
        library_id: "test".into(),
        changes: vec![Entity {
            kind: "note".into(),
            id: linked.id.clone(),
            revision: 1,
            deleted: true,
            data: json!({}),
        }],
        cursor: 1,
        target: 1,
    })
    .unwrap();
    s.finish_sync().unwrap();
    assert!(s.note(&linked.id, true).unwrap().source.is_some());
    assert_eq!(
        std::fs::read_to_string(files.path().join("a.md")).unwrap(),
        "local file"
    );
}
#[test]
fn unchanged_preferences_do_not_queue_notebooks() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    s.conn
        .execute(
            "INSERT INTO notebooks(id,name,color) VALUES('b','Book','blue')",
            [],
        )
        .unwrap();
    clear(&s);
    s.conn
        .execute(
            "UPDATE notebooks SET name='Book',color='blue' WHERE id='b'",
            [],
        )
        .unwrap();
    assert_eq!(s.sync_status().unwrap().pending, 0);
    s.conn
        .execute("UPDATE notebooks SET name='Changed' WHERE id='b'", [])
        .unwrap();
    assert_eq!(s.sync_status().unwrap().pending, 1);
    s.prepare_sync().unwrap();
}
#[test]
fn version_five_upgrade_has_readable_backup() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(dir.path()).unwrap();
    s.conn.pragma_update(None, "user_version", 5).unwrap();
    // Model the schema-5 database by removing the new tables and triggers.
    let triggers: Vec<String> = {
        let mut q = s
            .conn
            .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%'")
            .unwrap();
        q.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap()
    };
    for name in triggers {
        s.conn
            .execute_batch(&format!("DROP TRIGGER {name}"))
            .unwrap();
    }
    s.conn.execute_batch("DROP TABLE sync_dirty; DROP TABLE sync_state; DROP TABLE sync_versions; DROP TABLE sync_outbox; DROP TABLE sync_inbox; DROP TABLE sync_local_notebooks; DROP TABLE tag_body_migrations;").unwrap();
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(s.sync_status().unwrap().pending, 0);
    let backup = std::fs::read_dir(dir.path().join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let db = Connection::open(backup).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        5
    );
}
#[test]
fn cursor_gaps_and_server_identity_changes_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.prepare_sync().unwrap();
    assert!(s
        .stage_page(Page {
            library_id: "other".into(),
            changes: vec![],
            cursor: 0,
            target: 0
        })
        .is_err());
    assert!(s
        .stage_page(Page {
            library_id: "test".into(),
            changes: vec![],
            cursor: 0,
            target: 2
        })
        .is_err());
}

#[test]
#[ignore = "requires isolated HTTP service and STASH_SYNC_TEST_DEVICE_FILE"]
fn two_sqlite_clients_through_real_http_service() {
    let file = std::env::var("STASH_SYNC_TEST_DEVICE_FILE").expect("test device file");
    let credentials = std::fs::read_to_string(file).unwrap();
    let token = credentials.lines().nth(1).unwrap();
    let url = std::env::var("STASH_SYNC_TEST_URL").unwrap_or("http://127.0.0.1:18089".into());
    let info: Value = reqwest::blocking::Client::new()
        .get(format!("{url}/v1/info"))
        .bearer_auth(token)
        .send()
        .unwrap()
        .json()
        .unwrap();
    let identity = info["libraryId"].as_str().unwrap();
    let a_dir = tempfile::tempdir().unwrap();
    let b_dir = tempfile::tempdir().unwrap();
    let mut a = Store::open(a_dir.path()).unwrap();
    let mut b = Store::open(b_dir.path()).unwrap();
    for s in [&a, &b] {
        s.conn
            .execute("UPDATE sync_state SET library_id=?", [identity])
            .unwrap();
    }
    let id = uuid::Uuid::new_v4().to_string();
    a.save_note_record(&note(&id, "from A", 0)).unwrap();
    a.sync_with(&url, token, |_| {}).unwrap();
    b.sync_with(&url, token, |_| {}).unwrap();
    assert_eq!(b.note(&id, true).unwrap().title, "from A");
    let a_rev = a.note(&id, false).unwrap().revision;
    let b_rev = b.note(&id, false).unwrap().revision;
    a.save_note_record(&note(&id, "A offline", a_rev)).unwrap();
    b.save_note_record(&note(&id, &format!("B offline {id}"), b_rev))
        .unwrap();
    a.sync_with(&url, token, |_| {}).unwrap();
    let result = b.sync_with(&url, token, |_| {}).unwrap();
    assert!(!result.status.warnings.is_empty());
    a.sync_with(&url, token, |_| {}).unwrap();
    assert_eq!(a.note(&id, true).unwrap().title, "A offline");
    assert_eq!(b.note(&id, true).unwrap().title, "A offline");
    let copies = a
        .library()
        .unwrap()
        .notes
        .into_iter()
        .filter(|n| n.title == format!("B offline {id} (conflict copy)"))
        .count();
    assert_eq!(copies, 1);
    drop(b);
    let mut b = Store::open(b_dir.path()).unwrap();
    b.sync_with(&url, token, |_| {}).unwrap();
    assert_eq!(
        b.library()
            .unwrap()
            .notes
            .into_iter()
            .filter(|n| n.title == format!("B offline {id} (conflict copy)"))
            .count(),
        1
    );
    // Simulate a committed push whose response never reached SQLite.
    let n = note(&id, "response lost", a.note(&id, false).unwrap().revision);
    a.save_note_record(&n).unwrap();
    a.prepare_sync().unwrap();
    let raw: String = a
        .conn
        .query_row("SELECT operation FROM sync_outbox LIMIT 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    let op: Value = serde_json::from_str(&raw).unwrap();
    let response = reqwest::blocking::Client::new()
        .post(format!("{url}/v1/push"))
        .bearer_auth(token)
        .json(&op)
        .send()
        .unwrap();
    assert!(response.status().is_success());
    drop(a);
    let mut a = Store::open(a_dir.path()).unwrap();
    a.sync_with(&url, token, |_| {}).unwrap();
    b.sync_with(&url, token, |_| {}).unwrap();
    assert_eq!(b.note(&id, true).unwrap().title, "response lost");
    assert_eq!(a.sync_status().unwrap().pending, 0);
}

#[test]
fn notebook_deletions_follow_note_changes_in_outbox() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    s.conn
        .execute(
            "INSERT INTO notebooks(id,name,color) VALUES('book','Book','blue')",
            [],
        )
        .unwrap();
    let mut n = note("n", "Keep", 0);
    n.notebook_ids = vec!["book".into()];
    s.save_note_record(&n).unwrap();
    s.conn
        .execute("INSERT INTO sync_versions VALUES('notebook','book',1)", [])
        .unwrap();
    s.delete_notebook(&DeleteNotebookRequest {
        id: "book".into(),
        include_children: false,
        delete_notes: true,
        operation_id: "delete".into(),
    })
    .unwrap();
    s.prepare_sync().unwrap();
    let raw: String = s
        .conn
        .query_row(
            "SELECT operation FROM sync_outbox ORDER BY sequence DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let op: Operation = serde_json::from_str(&raw).unwrap();
    assert_eq!(op.kind, "notebook");
    assert!(op.deleted);
}
