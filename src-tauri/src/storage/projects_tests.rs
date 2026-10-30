use super::projects::*;
use super::*;

fn project(id: &str) -> SaveProject {
    SaveProject {
        id: id.into(),
        name: "Website relaunch".into(),
        description: String::new(),
        status: "active".into(),
        start_date: Some("2026-10-06".into()),
        end_date: Some("2026-11-28".into()),
        notebook_id: None,
        color: "#428E8E".into(),
        sort: 1.0,
        deleted: false,
        expected_revision: 0,
    }
}
fn task(id: &str, project_id: Option<&str>) -> SaveTask {
    SaveTask {
        id: id.into(),
        title: "Write homepage copy".into(),
        description: String::new(),
        status: "todo".into(),
        project_id: project_id.map(Into::into),
        priority: 2,
        start_date: None,
        due_date: Some("2026-11-04".into()),
        sort: 1.0,
        deleted: false,
        expected_revision: 0,
    }
}
fn changes(projects: Vec<SaveProject>, tasks: Vec<SaveTask>) -> ProjectChanges {
    ProjectChanges { projects, tasks }
}

#[test]
fn creates_and_reloads_projects_and_tasks() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let saved = store
        .save_project_changes(&changes(vec![project("p")], vec![task("t", Some("p"))]))
        .unwrap();
    assert_eq!(saved.projects[0].revision, 1);
    assert_eq!(saved.projects[0].color, "#428e8e");
    assert_eq!(saved.tasks[0].project_id.as_deref(), Some("p"));
    drop(store);

    let store = Store::open(dir.path()).unwrap();
    let data = store.project_data().unwrap();
    assert_eq!(data.projects, saved.projects);
    assert_eq!(data.tasks, saved.tasks);
}

#[test]
fn stale_or_missing_revisions_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store
        .save_project_changes(&changes(vec![], vec![task("t", None)]))
        .unwrap();
    let again = store.save_project_changes(&changes(vec![], vec![task("t", None)]));
    assert!(again.unwrap_err().contains("changed since"));

    let mut missing = task("gone", None);
    missing.expected_revision = 3;
    let error = store
        .save_project_changes(&changes(vec![], vec![missing]))
        .unwrap_err();
    assert!(error.contains("no longer exists"));

    let mut edit = task("t", None);
    edit.title = "Edited".into();
    edit.expected_revision = 1;
    let saved = store
        .save_project_changes(&changes(vec![], vec![edit]))
        .unwrap();
    assert_eq!(saved.tasks[0].revision, 2);
    assert_eq!(saved.tasks[0].title, "Edited");
}

#[test]
fn a_rejected_change_rolls_back_the_whole_batch() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let error = store
        .save_project_changes(&changes(vec![project("p")], vec![task("t", Some("other"))]))
        .unwrap_err();
    assert!(error.contains("project no longer exists"));
    let data = store.project_data().unwrap();
    assert!(data.projects.is_empty() && data.tasks.is_empty());
}

#[test]
fn completion_follows_status() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut t = task("t", None);
    t.status = "done".into();
    let done = store.save_project_changes(&changes(vec![], vec![t.clone()])).unwrap().tasks[0].clone();
    assert!(done.completed_at.is_some());

    t.expected_revision = 1;
    t.title = "Renamed".into();
    let still = store.save_project_changes(&changes(vec![], vec![t.clone()])).unwrap().tasks[0].clone();
    assert_eq!(still.completed_at, done.completed_at);

    t.expected_revision = 2;
    t.status = "doing".into();
    let reopened = store.save_project_changes(&changes(vec![], vec![t])).unwrap().tasks[0].clone();
    assert_eq!(reopened.completed_at, None);
}

#[test]
fn deletion_is_recoverable() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store
        .save_project_changes(&changes(vec![project("p")], vec![task("t", Some("p"))]))
        .unwrap();
    let mut p = project("p");
    p.deleted = true;
    p.expected_revision = 1;
    let mut t = task("t", None);
    t.expected_revision = 1;
    let saved = store.save_project_changes(&changes(vec![p.clone()], vec![t])).unwrap();
    assert!(saved.projects[0].deleted_at.is_some());
    assert_eq!(saved.tasks[0].project_id, None);

    p.deleted = false;
    p.expected_revision = 2;
    let restored = store.save_project_changes(&changes(vec![p], vec![])).unwrap();
    assert_eq!(restored.projects[0].deleted_at, None);
}

#[test]
fn invalid_fields_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let cases: Vec<(SaveProject, &str)> = vec![
        (SaveProject { name: "  ".into(), ..project("p") }, "name"),
        (SaveProject { status: "paused".into(), ..project("p") }, "status"),
        (SaveProject { end_date: Some("2026-02-30".into()), ..project("p") }, "dates"),
        (SaveProject { end_date: Some("2026-10-01".into()), ..project("p") }, "end before"),
        (SaveProject { color: "teal".into(), ..project("p") }, "color"),
        (SaveProject { id: "../p".into(), ..project("p") }, "ID"),
    ];
    for (input, message) in cases {
        let error = store.save_project_changes(&changes(vec![input], vec![])).unwrap_err();
        assert!(error.contains(message), "{error}");
    }
    let error = store
        .save_project_changes(&changes(vec![], vec![SaveTask { priority: 4, ..task("t", None) }]))
        .unwrap_err();
    assert!(error.contains("priority"));
    let leap = SaveTask { due_date: Some("2028-02-29".into()), ..task("t", None) };
    store.save_project_changes(&changes(vec![], vec![leap])).unwrap();
}

#[test]
fn version_ten_libraries_gain_project_tables_after_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store.save_note(&SaveNote {
        id: "a".into(),
        title: "Kept".into(),
        notebook_ids: vec![],
        quick_access: false,
        tags: vec![],
        content: Some(serde_json::json!({"type":"doc","content":[{"type":"paragraph"}]})),
        text: String::new(),
        pinned: false,
        trashed: false,
        markdown: None,
        expected_fingerprint: None,
        expected_revision: 0,
        operation_id: "create-a".into(),
    }).unwrap();
    store
        .conn
        .execute_batch("DROP TABLE tasks; DROP TABLE projects; PRAGMA user_version=10;")
        .unwrap();
    drop(store);

    let mut store = Store::open(dir.path()).unwrap();
    let version: i64 = store.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 11);
    assert_eq!(store.note("a", false).unwrap().title, "Kept");
    store
        .save_project_changes(&changes(vec![project("p")], vec![]))
        .unwrap();
    let backups = fs::read_dir(dir.path().join("backups")).unwrap().count();
    assert_eq!(backups, 1);
}

#[test]
fn workspace_preferences_keep_the_open_project_page() {
    let workspace: WorkspacePreferences = serde_json::from_value(
        serde_json::json!({"tabs":[],"activeTabId":null,"projectView":"inbox"}),
    )
    .unwrap();
    assert_eq!(workspace.project_view.as_deref(), Some("inbox"));
    let saved = serde_json::to_value(&workspace).unwrap();
    assert_eq!(saved["projectView"], "inbox");
    let closed: WorkspacePreferences = serde_json::from_value(
        serde_json::json!({"tabs":[],"activeTabId":null,"projectView":null}),
    )
    .unwrap();
    assert!(serde_json::to_value(&closed).unwrap().get("projectView").is_none());
}

fn note_mentioning(id: &str, task_id: &str) -> SaveNote {
    SaveNote {
        id: id.into(),
        title: id.into(),
        notebook_ids: vec![],
        quick_access: false,
        tags: vec![],
        content: Some(serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[
            {"type":"text","text":"See "},
            {"type":"taskReference","attrs":{"taskId":task_id,"fallbackTitle":"Write copy"}}
        ]}]})),
        text: "See Write copy".into(),
        pinned: false,
        trashed: false,
        markdown: None,
        expected_fingerprint: None,
        expected_revision: 0,
        operation_id: format!("create-{id}"),
    }
}

#[test]
fn finds_notes_that_mention_a_task() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store.save_note(&note_mentioning("a", "task_1")).unwrap();
    store.save_note(&note_mentioning("b", "task_1")).unwrap();
    // Contains the ID only as a prefix of another task ID.
    store.save_note(&note_mentioning("c", "task_10")).unwrap();
    let mut trashed = note_mentioning("d", "task_1");
    trashed.trashed = true;
    store.save_note(&trashed).unwrap();

    let mut found = store.task_mentions("task_1").unwrap();
    found.sort();
    assert_eq!(found, vec!["a", "b"]);
    assert_eq!(store.task_mentions("task_10").unwrap(), vec!["c"]);
    assert!(store.task_mentions("missing").unwrap().is_empty());
    assert!(store.task_mentions("../x").is_err());
}

#[test]
fn markdown_mentions_match_whole_task_links() {
    let text = "- [Write copy](stash://task/abc) and [Other](stash://task/abcd)";
    assert!(markdown_mentions(text, "abc"));
    assert!(markdown_mentions(text, "abcd"));
    assert!(!markdown_mentions(text, "ab"));
    assert!(!markdown_mentions("stash://task/abc-2", "abc"));
}

#[test]
fn invalid_task_mentions_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut note = note_mentioning("a", "ok");
    note.content = Some(serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"taskReference","attrs":{"taskId":"../bad","fallbackTitle":"x"}}
    ]}]}));
    assert!(store.save_note(&note).unwrap_err().contains("task mention"));
}
