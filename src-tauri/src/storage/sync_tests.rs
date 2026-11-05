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
    s.conn.execute_batch("DROP TABLE tasks; DROP TABLE projects; DROP TABLE sync_dirty; DROP TABLE sync_state; DROP TABLE sync_versions; DROP TABLE sync_outbox; DROP TABLE sync_inbox; DROP TABLE sync_local_notebooks; DROP TABLE pdf_companions; DROP TABLE pdf_reading; DROP TABLE pdf_documents; DROP TABLE tag_body_migrations;").unwrap();
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

#[test]
fn synced_tags_come_from_confirmed_content_not_plain_text_or_old_indexes() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    identity(&store);
    store.save_note_record(&note("tags", "#abcdef #old", 0)).unwrap();
    let mut entity = incoming(&store, "tags", 1);
    entity.data["tags"] = json!(["abcdef", "old"]);
    entity.data["content"] = json!({"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"#confirmed","marks":[{"type":"bodyTag","attrs":{"tag":"confirmed"}}]},
        {"type":"text","text":" #abcdef #old"}
    ]}]});
    clear(&store);
    store.prepare_sync().unwrap();
    store.stage_page(Page { library_id: "test".into(), changes: vec![entity], cursor: 1, target: 1 }).unwrap();
    store.finish_sync().unwrap();
    assert_eq!(store.note("tags", true).unwrap().tags, vec!["confirmed"]);
}

fn save_task(id: &str, title: &str, project: Option<&str>, revision: i64) -> projects::SaveTask {
    projects::SaveTask {
        id: id.into(),
        title: title.into(),
        description: String::new(),
        status: "todo".into(),
        project_id: project.map(Into::into),
        priority: 0,
        start_date: None,
        due_date: None,
        due_time: None,
        schedule: Some(projects::TaskSchedule::Point { start: 1, time_zone: "Asia/Hong_Kong".into() }),
        due_linked: true,
        repeat: None,
        reminders: None,
        tags: vec![],
        sort: 1.0,
        deleted: false,
        expected_revision: revision,
    }
}
fn save_project(id: &str, name: &str, notebook: Option<&str>, revision: i64) -> projects::SaveProject {
    projects::SaveProject {
        id: id.into(),
        name: name.into(),
        description: String::new(),
        status: "active".into(),
        start_date: None,
        end_date: None,
        notebook_id: notebook.map(Into::into),
        color: "#112233".into(),
        sort: 1.0,
        deleted: false,
        expected_revision: revision,
    }
}
fn outbox(s: &Store) -> Vec<Operation> {
    let mut q = s.conn.prepare("SELECT operation FROM sync_outbox ORDER BY sequence").unwrap();
    let rows = q.query_map([], |r| r.get::<_, String>(0)).unwrap();
    rows.map(|raw| serde_json::from_str(&raw.unwrap()).unwrap()).collect()
}
fn download(s: &mut Store, changes: Vec<Entity>) {
    let after: i64 = s.conn.query_row("SELECT cursor FROM sync_state", [], |r| r.get(0)).unwrap();
    let target = after + changes.len() as i64;
    s.prepare_sync().unwrap();
    s.conn.execute("DELETE FROM sync_outbox", []).unwrap();
    s.stage_page(Page { library_id: "test".into(), changes, cursor: target, target }).unwrap();
    s.finish_sync().unwrap();
}

#[test]
fn projects_and_tasks_upload_project_first_and_soft_deletes_are_updates() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.save_project_changes(&projects::ProjectChanges {
        projects: vec![save_project("p", "Project", None, 0)],
        tasks: vec![save_task("t", "Task", Some("p"), 0)],
    })
    .unwrap();
    assert_eq!(s.sync_status().unwrap().pending, 2);
    s.prepare_sync().unwrap();
    let ops = outbox(&s);
    assert_eq!(ops.iter().map(|op| op.kind.as_str()).collect::<Vec<_>>(), ["project", "task"]);
    assert_eq!(ops[1].data["projectId"], "p");
    assert_eq!(ops[1].data["schedule"]["timeZone"], "Asia/Hong_Kong");
    assert!(ops.iter().all(|op| !op.deleted));
    s.conn.execute("DELETE FROM sync_outbox", []).unwrap();
    s.conn.execute("UPDATE sync_state SET active=0", []).unwrap();
    let mut task = save_task("t", "Task", Some("p"), 1);
    task.deleted = true;
    s.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![task] }).unwrap();
    s.prepare_sync().unwrap();
    let ops = outbox(&s);
    assert_eq!(ops.len(), 1);
    assert!(!ops[0].deleted);
    assert!(ops[0].data["deletedAt"].is_i64());
}

#[test]
fn existing_projects_queue_on_upgrade() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    s.save_project_changes(&projects::ProjectChanges {
        projects: vec![save_project("p", "Project", None, 0)],
        tasks: vec![save_task("t", "Task", Some("p"), 0)],
    })
    .unwrap();
    s.conn
        .execute_batch("DROP TRIGGER sync_projects_insert; DROP TRIGGER sync_projects_update; DROP TRIGGER sync_tasks_insert; DROP TRIGGER sync_tasks_update; DELETE FROM sync_dirty; ALTER TABLE tasks DROP COLUMN tags; ALTER TABLE tasks DROP COLUMN reminders; ALTER TABLE tasks DROP COLUMN repeat; PRAGMA user_version=13;")
        .unwrap();
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(s.sync_status().unwrap().pending, 2);
    s.conn.execute("UPDATE tasks SET title='Changed'", []).unwrap();
    assert_eq!(s.sync_status().unwrap().pending, 2);
}

#[test]
fn tags_upload_and_apply_from_other_devices() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    let mut local = save_task("local", "Local", None, 0);
    local.tags = vec!["work".into()];
    s.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![local] }).unwrap();
    s.prepare_sync().unwrap();
    assert_eq!(outbox(&s)[0].data["tags"], json!(["work"]));

    let remote = json!({"id":"remote","title":"Remote","description":"","status":"todo","projectId":null,"priority":0,"startDate":null,"dueDate":null,"dueTime":null,"tags":["home"],"completedAt":null,"sort":1.0,"deletedAt":null,"created":1,"updated":2,"revision":9});
    download(&mut s, vec![Entity { kind: "task".into(), id: "remote".into(), revision: 1, deleted: false, data: remote }]);
    let tasks = s.project_data().unwrap().tasks;
    assert_eq!(tasks.iter().find(|t| t.id == "remote").unwrap().tags, vec!["home"]);
}

#[test]
fn reminders_upload_and_apply_from_other_devices() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    let mut local = save_task("local", "Local", None, 0);
    local.reminders = Some(vec![0, 60]);
    s.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![local] }).unwrap();
    s.prepare_sync().unwrap();
    assert_eq!(outbox(&s)[0].data["reminders"], json!([0, 60]));

    let remote = |id: &str, reminders: Value| json!({"id":id,"title":"Remote","description":"","status":"todo","projectId":null,"priority":0,"startDate":null,"dueDate":"2026-11-04","dueTime":null,"schedule":null,"dueLinked":false,"reminders":reminders,"completedAt":null,"sort":1.0,"deletedAt":null,"created":1,"updated":2,"revision":9});
    download(&mut s, vec![Entity { kind: "task".into(), id: "off".into(), revision: 1, deleted: false, data: remote("off", json!([])) }]);
    let tasks = s.project_data().unwrap().tasks;
    assert_eq!(tasks.iter().find(|t| t.id == "off").unwrap().reminders, Some(vec![]));
}

#[test]
fn repeat_rules_upload_and_apply_from_other_devices() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    let rule = json!({"unit":"week","interval":2,"weekdays":[1,5],"from":"schedule"});
    let mut local = save_task("local", "Local", None, 0);
    local.repeat = Some(serde_json::from_value(rule.clone()).unwrap());
    s.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![local] }).unwrap();
    s.prepare_sync().unwrap();
    assert_eq!(outbox(&s)[0].data["repeat"], rule);

    let task = json!({"id":"remote","title":"Remote","description":"","status":"todo","projectId":null,"priority":0,"startDate":null,"dueDate":"2026-11-04","dueTime":null,"schedule":null,"dueLinked":false,"repeat":rule,"completedAt":null,"sort":1.0,"deletedAt":null,"created":1,"updated":2,"revision":9});
    download(&mut s, vec![Entity { kind: "task".into(), id: "remote".into(), revision: 1, deleted: false, data: task }]);
    let data = s.project_data().unwrap();
    let saved = data.tasks.iter().find(|t| t.id == "remote").unwrap();
    assert_eq!(serde_json::to_value(&saved.repeat).unwrap(), rule);

    // A record from a client without repeats stays one-off.
    let older = json!({"id":"older","title":"Older","description":"","status":"todo","projectId":null,"priority":0,"startDate":null,"dueDate":null,"dueTime":null,"schedule":null,"dueLinked":false,"completedAt":null,"sort":1.0,"deletedAt":null,"created":1,"updated":2,"revision":9});
    download(&mut s, vec![Entity { kind: "task".into(), id: "older".into(), revision: 2, deleted: false, data: older }]);
    assert!(s.project_data().unwrap().tasks.iter().find(|t| t.id == "older").unwrap().repeat.is_none());
}

#[test]
fn downloaded_tasks_apply_without_requeueing_and_bump_local_revisions() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    let project = json!({"id":"p","name":"Remote project","description":"","status":"active","startDate":null,"endDate":null,"completedAt":null,"notebookId":null,"color":"#112233","sort":1.0,"deletedAt":null,"created":1,"updated":2,"revision":9});
    let task = json!({"id":"t","title":"Remote task","description":"","status":"done","projectId":"p","priority":1,"startDate":null,"dueDate":null,"dueTime":null,"schedule":null,"dueLinked":false,"completedAt":5,"sort":1.0,"deletedAt":null,"created":1,"updated":2,"revision":9});
    // Tasks arrive first in the inbox order; the project must still be applied first.
    download(&mut s, vec![
        Entity { kind: "project".into(), id: "p".into(), revision: 1, deleted: false, data: project.clone() },
        Entity { kind: "task".into(), id: "t".into(), revision: 2, deleted: false, data: task.clone() },
    ]);
    let data = s.project_data().unwrap();
    assert_eq!(data.tasks[0].title, "Remote task");
    assert_eq!(data.tasks[0].completed_at, Some(5));
    assert_eq!(data.tasks[0].revision, 1);
    assert_eq!(s.sync_status().unwrap().pending, 0);
    let mut renamed = task.clone();
    renamed["title"] = json!("Renamed");
    download(&mut s, vec![Entity { kind: "task".into(), id: "t".into(), revision: 3, deleted: false, data: renamed }]);
    let saved = s.project_data().unwrap().tasks.remove(0);
    assert_eq!((saved.title.as_str(), saved.revision), ("Renamed", 2));
    // The next upload is based on the downloaded server revision.
    s.save_project_changes(&projects::ProjectChanges {
        projects: vec![],
        tasks: vec![save_task("t", "Local", Some("p"), 2)],
    })
    .unwrap();
    s.prepare_sync().unwrap();
    assert_eq!(outbox(&s)[0].base_revision, 3);
}

#[test]
fn offline_task_edits_survive_a_download_and_upload_with_the_old_base() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![save_task("t", "Local", None, 0)] }).unwrap();
    let mut remote = serde_json::to_value(&s.project_data().unwrap().tasks[0]).unwrap();
    remote["title"] = json!("Remote");
    s.prepare_sync().unwrap();
    s.conn.execute("DELETE FROM sync_outbox", []).unwrap();
    s.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![save_task("t", "Edited offline", None, 1)] }).unwrap();
    s.stage_page(Page {
        library_id: "test".into(),
        changes: vec![Entity { kind: "task".into(), id: "t".into(), revision: 1, deleted: false, data: remote }],
        cursor: 1,
        target: 1,
    })
    .unwrap();
    s.finish_sync().unwrap();
    assert_eq!(s.project_data().unwrap().tasks[0].title, "Edited offline");
    assert_eq!(s.sync_status().unwrap().pending, 1);
    s.prepare_sync().unwrap();
    let ops = outbox(&s);
    assert_eq!((ops[0].base_revision, ops[0].data["title"].as_str()), (0, Some("Edited offline")));
}

#[test]
fn invalid_downloaded_tasks_do_not_advance_the_cursor() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.prepare_sync().unwrap();
    let bad = json!({"id":"t","title":"Bad","description":"","status":"later","projectId":null,"priority":0,"completedAt":null,"sort":1.0,"deletedAt":null,"created":1,"updated":2,"revision":1});
    s.stage_page(Page {
        library_id: "test".into(),
        changes: vec![Entity { kind: "task".into(), id: "t".into(), revision: 1, deleted: false, data: bad }],
        cursor: 1,
        target: 1,
    })
    .unwrap();
    assert!(s.finish_sync().is_err());
    assert!(s.project_data().unwrap().tasks.is_empty());
    let cursor: i64 = s.conn.query_row("SELECT cursor FROM sync_state", [], |r| r.get(0)).unwrap();
    assert_eq!(cursor, 0);
}

#[test]
fn device_only_notebook_links_stay_local() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.conn.execute("INSERT INTO notebooks(id,name,color) VALUES('local','Local','blue')", []).unwrap();
    s.conn.execute("INSERT INTO sync_local_notebooks VALUES('local')", []).unwrap();
    s.save_project_changes(&projects::ProjectChanges { projects: vec![save_project("p", "Project", Some("local"), 0)], tasks: vec![] }).unwrap();
    s.prepare_sync().unwrap();
    let op = outbox(&s).remove(0);
    assert!(op.data["notebookId"].is_null());
    s.conn.execute("DELETE FROM sync_outbox", []).unwrap();
    s.stage_page(Page {
        library_id: "test".into(),
        changes: vec![Entity { kind: "project".into(), id: "p".into(), revision: 1, deleted: false, data: op.data }],
        cursor: 1,
        target: 1,
    })
    .unwrap();
    s.finish_sync().unwrap();
    assert_eq!(s.project_data().unwrap().projects[0].notebook_id.as_deref(), Some("local"));
}

#[test]
#[ignore = "requires isolated HTTP service and STASH_SYNC_TEST_DEVICE_FILE"]
fn two_clients_sync_tasks_through_real_http_service() {
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
    let (a_dir, b_dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut a = Store::open(a_dir.path()).unwrap();
    let mut b = Store::open(b_dir.path()).unwrap();
    for s in [&a, &b] {
        s.conn
            .execute("UPDATE sync_state SET library_id=?", [info["libraryId"].as_str().unwrap()])
            .unwrap();
    }
    let (project, task) = (uuid::Uuid::new_v4().to_string(), uuid::Uuid::new_v4().to_string());
    let find = |s: &Store, title: &str| {
        s.project_data().unwrap().tasks.into_iter().find(|t| t.title == title)
    };
    a.save_project_changes(&projects::ProjectChanges {
        projects: vec![save_project(&project, "Shared", None, 0)],
        tasks: vec![save_task(&task, "From A", Some(&project), 0)],
    })
    .unwrap();
    a.sync_with(&url, token, |_| {}).unwrap();
    b.sync_with(&url, token, |_| {}).unwrap();
    let on_b = find(&b, "From A").expect("task reached B");
    assert_eq!(on_b.project_id.as_deref(), Some(project.as_str()));
    assert!(on_b.schedule.is_some());
    assert_eq!(b.sync_status().unwrap().pending, 0);

    // Both devices edit offline. Each edit must survive and the second device is told.
    let revision = |s: &Store| s.project_data().unwrap().tasks.iter().find(|t| t.id == task).unwrap().revision;
    let (a_rev, b_rev) = (revision(&a), revision(&b));
    a.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![save_task(&task, "A offline", Some(&project), a_rev)] }).unwrap();
    b.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![save_task(&task, "B offline", Some(&project), b_rev)] }).unwrap();
    a.sync_with(&url, token, |_| {}).unwrap();
    let result = b.sync_with(&url, token, |_| {}).unwrap();
    assert_eq!(result.status.warnings.len(), 1);
    assert!(result.status.warnings[0].contains("B offline"));
    a.sync_with(&url, token, |_| {}).unwrap();
    for s in [&a, &b] {
        assert!(find(s, "A offline").is_some());
        assert!(find(s, "B offline (conflict copy)").is_some());
        assert_eq!(s.sync_status().unwrap().pending, 0);
    }
    // Another cycle has nothing left to do and raises no new warning.
    let result = b.sync_with(&url, token, |_| {}).unwrap();
    assert!(result.status.warnings.is_empty());

    // A soft delete and its undo both reach the other device.
    let mut deleted = save_task(&task, "A offline", Some(&project), revision(&a));
    deleted.deleted = true;
    a.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![deleted] }).unwrap();
    a.sync_with(&url, token, |_| {}).unwrap();
    b.sync_with(&url, token, |_| {}).unwrap();
    assert!(find(&b, "A offline").unwrap().deleted_at.is_some());
    a.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![save_task(&task, "A offline", Some(&project), revision(&a))] }).unwrap();
    a.sync_with(&url, token, |_| {}).unwrap();
    b.sync_with(&url, token, |_| {}).unwrap();
    assert!(find(&b, "A offline").unwrap().deleted_at.is_none());
}

#[test]
fn a_server_without_project_sync_gets_notes_and_projects_stay_queued() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    identity(&s);
    s.save_note_record(&note("n", "Note", 0)).unwrap();
    s.save_project_changes(&projects::ProjectChanges { projects: vec![], tasks: vec![save_task("t", "Task", None, 0)] }).unwrap();
    s.prepare_cycle(false).unwrap();
    let ops = outbox(&s);
    assert_eq!(ops.iter().map(|op| op.kind.as_str()).collect::<Vec<_>>(), ["note"]);
    s.conn.execute("DELETE FROM sync_outbox", []).unwrap();
    s.stage_page(Page { library_id: "test".into(), changes: vec![], cursor: 0, target: 0 }).unwrap();
    s.finish_sync().unwrap();
    assert_eq!(s.sync_status().unwrap().pending, 1);
    s.prepare_cycle(true).unwrap();
    assert_eq!(outbox(&s).remove(0).kind, "task");
}
