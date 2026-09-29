use super::*;
use serde_json::json;
fn note(id: &str) -> SaveNote {
    SaveNote {
        id: id.into(),
        title: "Original".into(),
        notebook_ids: vec![],
        quick_access: false,
        tags: vec!["ideas".into()],
        content: Some(
            json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Keep me #ideas"}]}]}),
        ),
        text: "Keep me #ideas".into(),
        pinned: false,
        trashed: false,
        markdown: None,
        expected_fingerprint: None,
        expected_revision: 0,
        operation_id: format!("create-{id}"),
    }
}
fn preferences() -> SavePreferences {
    SavePreferences {
        workspace: None,
        appearance: json!({"dark":true,"theme":"qrafthive","width":80,"size":17,"uiFont":"system","noteFont":"georgia","codeFont":"menlo"}),
        notebooks: vec![Notebook {
            id: "work".into(),
            name: "Work".into(),
            color: "#123456".into(),
            icon: "notebook".into(),
            parent_id: None,
            root_id: None,
            relative_path: None,
        }],
        expected_revision: 0,
        operation_id: "settings-1".into(),
    }
}

fn heading_styles() -> Value {
    json!({
        "h1": {"font": null, "weight": 600, "italic": false, "color": null},
        "h2": {"font": "palatino", "weight": 700, "italic": true, "color": "#216F9C"},
        "h3": {"font": null, "weight": 500, "italic": false, "color": "#387342"},
        "h4": {"font": null, "weight": 400, "italic": false, "color": null},
        "h5": {"font": "font:Atkinson Hyperlegible", "weight": 600, "italic": false, "color": null},
        "h6": {"font": null, "weight": 600, "italic": true, "color": "#7655AE"}
    })
}
fn notebook(id: &str, name: &str, parent_id: Option<&str>) -> Notebook {
    Notebook {
        id: id.into(),
        name: name.into(),
        color: "#82936f".into(),
        icon: "notebook".into(),
        parent_id: parent_id.map(str::to_owned),
        root_id: None,
        relative_path: None,
    }
}
fn save_notebooks(store: &mut Store, notebooks: Vec<Notebook>, operation_id: &str) {
    let mut input = preferences();
    input.notebooks = notebooks;
    input.expected_revision = store.library().unwrap().preferences_revision;
    input.operation_id = operation_id.into();
    store.save_preferences(&input).unwrap();
}
fn restore_input(note: &Note, operation_id: &str) -> SaveNote {
    SaveNote {
        id: note.id.clone(),
        title: note.title.clone(),
        notebook_ids: note.notebook_ids.clone(),
        quick_access: note.quick_access,
        tags: note.tags.clone(),
        content: note.content.clone(),
        text: note.text.clone(),
        pinned: note.pinned,
        trashed: false,
        markdown: None,
        expected_fingerprint: note
            .source
            .as_ref()
            .map(|source| source.fingerprint.clone()),
        expected_revision: note.revision,
        operation_id: operation_id.into(),
    }
}
#[test]
fn restart_retains_notes_settings_tags_and_trash() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store.save_preferences(&preferences()).unwrap();
    let mut n = note("a");
    n.notebook_ids = vec!["work".into()];
    n.pinned = true;
    n.trashed = true;
    store.save_note(&n).unwrap();
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    let library = store.library().unwrap();
    assert_eq!(library.notes.len(), 1);
    assert!(library.notes[0].content.is_none());
    assert_eq!(library.appearance.unwrap()["width"], 80);
    let saved = store.note("a", true).unwrap();
    assert_eq!(saved.content, n.content);
    assert!(saved.pinned);
    assert!(saved.trashed_at.is_some());
    assert_eq!(saved.tags, n.tags);
}

#[test]
fn version_seven_moves_ordinary_legacy_tags_into_the_document_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut legacy = note("a");
    legacy.tags = vec![];
    legacy.text = "Keep me".into();
    legacy.content = Some(json!({
        "type":"doc",
        "content":[{"type":"paragraph","content":[{"type":"text","text":"Keep me"}]}]
    }));
    store.save_note(&legacy).unwrap();
    store
        .conn
        .execute("INSERT INTO note_tags VALUES(?,'My Project')", ["a"])
        .unwrap();
    store
        .conn
        .execute_batch("DROP TABLE tag_body_migrations; PRAGMA user_version=6;")
        .unwrap();
    drop(store);

    let store = Store::open(dir.path()).unwrap();
    let migrated = store.note("a", true).unwrap();
    assert_eq!(migrated.text, "Keep me\nTags: #my-project");
    assert_eq!(migrated.tags, vec!["my-project"]);
    assert_eq!(
        migrated.content.unwrap()["content"][1]["content"][0]["text"],
        "Tags: #my-project"
    );
    assert_eq!(
        store
            .conn
            .query_row(
                "SELECT count(*) FROM tag_body_migrations WHERE note_id='a'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .conn
            .query_row(
                "SELECT count(*) FROM sync_dirty WHERE kind='note' AND id='a'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    let revision = migrated.revision;
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    let reopened = store.note("a", true).unwrap();
    assert_eq!(reopened.text, "Keep me\nTags: #my-project");
    assert_eq!(reopened.revision, revision);
}
#[test]
fn retry_is_idempotent_and_stale_save_does_not_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let n = note("a");
    assert_eq!(s.save_note(&n).unwrap().revision, 1);
    assert_eq!(s.save_note(&n).unwrap().revision, 1);
    let mut edit = n.clone();
    edit.operation_id = "edit".into();
    edit.title = "New".into();
    edit.expected_revision = 1;
    assert_eq!(s.save_note(&edit).unwrap().revision, 2);
    let mut stale = n;
    stale.operation_id = "stale".into();
    assert!(s.save_note(&stale).unwrap_err().contains("conflict"));
    assert_eq!(s.note("a", true).unwrap().title, "New");
}
#[test]
fn failed_transaction_preserves_existing_content() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let n = note("a");
    s.save_note(&n).unwrap();
    let mut bad = n.clone();
    bad.expected_revision = 1;
    bad.operation_id = "bad".into();
    bad.notebook_ids = vec!["missing".into()];
    bad.title = "Lost".into();
    assert!(s.save_note(&bad).is_err());
    assert_eq!(s.note("a", true).unwrap().title, "Original");
    bad.notebook_ids = vec![];
    bad.content = Some(json!({"type":"invalid"}));
    assert!(s.save_note(&bad).is_err());
    assert_eq!(s.note("a", true).unwrap().revision, 1);
}
#[test]
fn metadata_only_save_keeps_body_and_restore_clears_trash_date() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut n = note("a");
    n.trashed = true;
    s.save_note(&n).unwrap();
    n.expected_revision = 1;
    n.operation_id = "restore".into();
    n.trashed = false;
    n.content = None;
    s.save_note(&n).unwrap();
    let saved = s.note("a", true).unwrap();
    assert_eq!(saved.content, note("a").content);
    assert!(saved.trashed_at.is_none());
}
#[test]
fn second_process_lock_and_unknown_schema_fail_closed() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(dir.path()).unwrap();
    assert!(Store::open(dir.path()).is_err());
    drop(s);
    let db = Connection::open(dir.path().join("library.sqlite3")).unwrap();
    db.pragma_update(None, "user_version", 99).unwrap();
    drop(db);
    assert!(Store::open(dir.path()).err().unwrap().contains("newer"));
    let db = Connection::open(dir.path().join("library.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        99
    );
}
#[test]
fn corrupt_library_is_not_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite3");
    fs::write(&path, b"broken database").unwrap();
    assert!(Store::open(dir.path()).is_err());
    assert_eq!(fs::read(path).unwrap(), b"broken database");
}
#[test]
fn settings_are_transactional_and_revision_checked() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let p = preferences();
    s.save_preferences(&p).unwrap();
    assert_eq!(s.save_preferences(&p).unwrap().revision, 1);
    let mut stale = p;
    stale.operation_id = "stale".into();
    stale.appearance = json!({"width":10});
    assert!(s.save_preferences(&stale).is_err());
    assert_eq!(s.library().unwrap().appearance.unwrap()["width"], 80);
}

#[test]
fn notebook_metadata_persists_across_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    save_notebooks(&mut store, vec![notebook("work", "Work", None)], "books-1");
    let mut changed = notebook("work", "Projects", None);
    changed.color = "#c56a5d".into();
    changed.icon = "palette".into();
    save_notebooks(&mut store, vec![changed], "books-2");
    drop(store);

    let store = Store::open(dir.path()).unwrap();
    let saved = &store.notebooks().unwrap()[0];
    assert_eq!(saved.name, "Projects");
    assert_eq!(saved.color, "#c56a5d");
    assert_eq!(saved.icon, "palette");
}

#[test]
fn notebook_icon_validation_accepts_new_icons_and_rejects_unknown_icons() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut accepted = notebook("work", "Work", None);
    accepted.icon = "shoppingBag".into();
    save_notebooks(&mut store, vec![accepted], "new-icon");
    assert_eq!(store.notebooks().unwrap()[0].icon, "shoppingBag");

    let mut rejected = notebook("work", "Work", None);
    rejected.icon = "not-an-icon".into();
    let mut input = preferences();
    input.notebooks = vec![rejected];
    input.expected_revision = store.library().unwrap().preferences_revision;
    input.operation_id = "invalid-icon".into();
    assert_eq!(
        store.save_preferences(&input).unwrap_err(),
        "That notebook icon is not supported."
    );
    assert_eq!(store.notebooks().unwrap()[0].icon, "shoppingBag");
}

#[test]
fn deleting_a_notebook_promotes_children_and_keeps_shared_memberships() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    save_notebooks(
        &mut store,
        vec![
            notebook("work", "Work", None),
            notebook("child", "Child", Some("work")),
            notebook("personal", "Personal", None),
        ],
        "books",
    );
    for (id, memberships) in [
        ("direct", vec!["work"]),
        ("nested", vec!["child"]),
        ("shared", vec!["work", "personal"]),
    ] {
        let mut input = note(id);
        input.notebook_ids = memberships.into_iter().map(str::to_owned).collect();
        input.operation_id = format!("create-{id}");
        store.save_note(&input).unwrap();
    }

    let request = DeleteNotebookRequest {
        id: "work".into(),
        include_children: false,
        delete_notes: false,
        operation_id: "delete-work".into(),
    };
    store.delete_notebook(&request).unwrap();

    assert!(!store
        .notebooks()
        .unwrap()
        .iter()
        .any(|book| book.id == "work"));
    assert_eq!(
        store
            .notebooks()
            .unwrap()
            .into_iter()
            .find(|book| book.id == "child")
            .unwrap()
            .parent_id,
        None
    );
    assert!(store.note("direct", true).unwrap().notebook_ids.is_empty());
    assert_eq!(
        store.note("nested", true).unwrap().notebook_ids,
        vec!["child"]
    );
    assert_eq!(
        store.note("shared", true).unwrap().notebook_ids,
        vec!["personal"]
    );

    // Retrying the same operation after the row is gone is a safe no-op, even
    // if a later save reuses the old notebook ID.
    save_notebooks(
        &mut store,
        vec![
            notebook("work", "Recreated", None),
            notebook("child", "Child", None),
            notebook("personal", "Personal", None),
        ],
        "recreate-work",
    );
    store.delete_notebook(&request).unwrap();
    assert!(store
        .notebooks()
        .unwrap()
        .iter()
        .any(|book| book.id == "work"));
}

#[test]
fn deleting_a_subtree_trashes_notes_and_restore_leaves_uncategorized_notes() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    save_notebooks(
        &mut store,
        vec![
            notebook("work", "Work", None),
            notebook("child", "Child", Some("work")),
            notebook("personal", "Personal", None),
        ],
        "books",
    );
    for (id, memberships) in [
        ("direct", vec!["work"]),
        ("nested", vec!["child"]),
        ("shared", vec!["child", "personal"]),
    ] {
        let mut input = note(id);
        input.notebook_ids = memberships.into_iter().map(str::to_owned).collect();
        input.operation_id = format!("create-{id}");
        store.save_note(&input).unwrap();
    }

    store
        .delete_notebook(&DeleteNotebookRequest {
            id: "work".into(),
            include_children: true,
            delete_notes: true,
            operation_id: "delete-subtree".into(),
        })
        .unwrap();

    assert!(store
        .notebooks()
        .unwrap()
        .iter()
        .all(|book| book.id == "personal"));
    for id in ["direct", "nested", "shared"] {
        assert!(store.note(id, true).unwrap().trashed);
    }
    assert!(store.note("direct", true).unwrap().notebook_ids.is_empty());
    assert!(store.note("nested", true).unwrap().notebook_ids.is_empty());
    assert_eq!(
        store.note("shared", true).unwrap().notebook_ids,
        vec!["personal"]
    );

    let trashed = store.note("direct", true).unwrap();
    store
        .save_note(&restore_input(&trashed, "restore-direct"))
        .unwrap();
    let restored = store.note("direct", true).unwrap();
    assert!(!restored.trashed);
    assert!(restored.notebook_ids.is_empty());
}

#[test]
fn failed_notebook_delete_can_be_retried_without_partial_database_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    save_notebooks(&mut store, vec![notebook("work", "Work", None)], "books");
    let mut input = note("direct");
    input.notebook_ids = vec!["work".into()];
    store.save_note(&input).unwrap();
    let request = DeleteNotebookRequest {
        id: "work".into(),
        include_children: false,
        delete_notes: true,
        operation_id: "delete-retry".into(),
    };

    store.conn.pragma_update(None, "query_only", true).unwrap();
    assert!(store.delete_notebook(&request).is_err());
    assert!(store
        .notebooks()
        .unwrap()
        .iter()
        .any(|book| book.id == "work"));
    assert!(!store.note("direct", true).unwrap().trashed);
    store.conn.pragma_update(None, "query_only", false).unwrap();

    store.delete_notebook(&request).unwrap();
    assert!(store.notebooks().unwrap().is_empty());
    assert!(store.note("direct", true).unwrap().trashed);
}

#[test]
fn read_only_failure_can_be_retried_without_losing_the_old_version() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut n = note("read-only");
    s.save_note(&n).unwrap();
    n.expected_revision = 1;
    n.operation_id = "edit".into();
    n.title = "After retry".into();
    s.conn.pragma_update(None, "query_only", true).unwrap();
    assert!(s.save_note(&n).is_err());
    assert_eq!(s.note(&n.id, true).unwrap().title, "Original");
    s.conn.pragma_update(None, "query_only", false).unwrap();
    s.save_note(&n).unwrap();
    assert_eq!(s.note(&n.id, true).unwrap().title, "After retry");
}

#[test]
#[ignore]
fn crash_writer_helper() {
    let dir = std::env::var("UPNOTE2_CRASH_TEST_DIR").unwrap();
    let mut s = Store::open(Path::new(&dir)).unwrap();
    s.save_note(&note("committed")).unwrap();
    // Leave a transaction uncommitted when the parent terminates this process.
    s.conn
        .execute_batch("BEGIN; UPDATE notes SET title='Uncommitted' WHERE id='committed';")
        .unwrap();
    fs::write(Path::new(&dir).join("ready"), b"ready").unwrap();
    loop {
        std::thread::park();
    }
}
#[test]
fn abrupt_process_termination_recovers_only_committed_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "storage::tests::crash_writer_helper",
            "--ignored",
        ])
        .env("UPNOTE2_CRASH_TEST_DIR", dir.path())
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    for _ in 0..100 {
        if dir.path().join("ready").exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let ready = dir.path().join("ready").exists();
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(ready);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(s.note("committed", true).unwrap().title, "Original");
}

#[test]
fn references_roundtrip_and_reject_invalid_attributes() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store.save_note(&note("target")).unwrap();
    let mut source = note("source");
    source.content = Some(
        json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"noteReference","attrs":{"noteId":"target","fallbackTitle":"Original"},"marks":[{"type":"bold"}]}]}]}),
    );
    store.save_note(&source).unwrap();
    drop(store);
    let mut store = Store::open(dir.path()).unwrap();
    assert_eq!(store.note("source", true).unwrap().content, source.content);
    source.content.as_mut().unwrap()["content"][0]["content"][0]["attrs"]["noteId"] =
        json!("javascript:bad");
    source.expected_revision = 1;
    source.operation_id = "invalid-reference".into();
    assert!(store.save_note(&source).is_err());
    assert_eq!(store.note("source", true).unwrap().revision, 1);
}

#[test]
fn version_one_migration_preserves_documents_and_restores_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let db = Connection::open(dir.path().join("library.sqlite3")).unwrap();
    db.execute_batch(include_str!("schema.sql")).unwrap();
    db.execute(
        "INSERT INTO preferences(id,appearance,revision,last_op) VALUES(1,?1,1,'old')",
        [preferences().appearance.to_string()],
    )
    .unwrap();
    drop(db);
    let mut store = Store::open(dir.path()).unwrap();
    assert!(store.library().unwrap().workspace.is_none());
    store.save_note(&note("a")).unwrap();
    let before = store.note("a", true).unwrap().content;
    let mut prefs = preferences();
    prefs.expected_revision = 1;
    prefs.operation_id = "tabs".into();
    prefs.workspace = Some(WorkspacePreferences {
        pane_widths: None,
        note_lists: Default::default(),
        tabs: vec![WorkspaceTab {
            id: "tab-a".into(),
            note_id: "a".into(),
            preview: Some(true),
        }],
        active_tab_id: Some("tab-a".into()),
    });
    store.save_preferences(&prefs).unwrap();
    assert_eq!(store.save_preferences(&prefs).unwrap().revision, 2);
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    let workspace = store.library().unwrap().workspace.unwrap();
    assert_eq!(workspace.tabs[0].note_id, "a");
    assert_eq!(workspace.tabs[0].preview, Some(true));
    assert_eq!(workspace.active_tab_id.as_deref(), Some("tab-a"));
    assert_eq!(store.note("a", true).unwrap().content, before);
    assert_eq!(
        store
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        7
    );
}

#[test]
fn workspace_failure_is_atomic_and_empty_tabs_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut prefs = preferences();
    prefs.workspace = Some(WorkspacePreferences {
        pane_widths: None,
        note_lists: Default::default(),
        tabs: vec![],
        active_tab_id: None,
    });
    store.save_preferences(&prefs).unwrap();
    prefs.expected_revision = 1;
    prefs.operation_id = "bad-tabs".into();
    prefs.appearance["width"] = json!(90);
    prefs.workspace.as_mut().unwrap().active_tab_id = Some("missing".into());
    assert!(store.save_preferences(&prefs).is_err());
    assert_eq!(store.library().unwrap().appearance.unwrap()["width"], 80);
    assert_eq!(store.library().unwrap().preferences_revision, 1);
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    let workspace = store.library().unwrap().workspace.unwrap();
    assert!(workspace.tabs.is_empty());
    assert!(workspace.active_tab_id.is_none());
}

#[test]
fn workspace_rejects_multiple_preview_tabs() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut prefs = preferences();
    prefs.workspace = Some(WorkspacePreferences {
        pane_widths: None,
        note_lists: Default::default(),
        tabs: ["a", "b"]
            .into_iter()
            .map(|id| WorkspaceTab {
                id: id.into(),
                note_id: id.into(),
                preview: Some(true),
            })
            .collect(),
        active_tab_id: Some("a".into()),
    });
    assert_eq!(
        store.save_preferences(&prefs).unwrap_err(),
        "Invalid workspace tabs."
    );
}

#[test]
fn spacing_settings_survive_restart_at_all_boundaries() {
    for (line, paragraph, list_item, bottom) in [
        (0.5, 0, -8, 0),
        (1.5, 0, 0, 0),
        (1.8, 0, 16, 112),
        (2.5, 32, 32, 400),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        let mut prefs = preferences();
        prefs.appearance["lineSpacing"] = json!(line);
        prefs.appearance["paragraphSpacing"] = json!(paragraph);
        prefs.appearance["listItemSpacing"] = json!(list_item);
        prefs.appearance["editorBottomSpace"] = json!(bottom);
        store.save_preferences(&prefs).unwrap();
        drop(store);
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(
            store.library().unwrap().appearance.unwrap(),
            prefs.appearance
        );
    }
}

#[test]
fn cursor_settings_survive_restart() {
    for (style, blinking, smooth) in [
        ("line", "blinking", "off"),
        ("block-outline", "phase", "on"),
        ("underline-thin", "solid", "off"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        let mut prefs = preferences();
        prefs.appearance["cursorStyle"] = json!(style);
        prefs.appearance["cursorBlinking"] = json!(blinking);
        prefs.appearance["cursorSmoothCaretAnimation"] = json!(smooth);
        store.save_preferences(&prefs).unwrap();
        drop(store);
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(
            store.library().unwrap().appearance.unwrap(),
            prefs.appearance
        );
    }
}

#[test]
fn title_font_setting_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut prefs = preferences();
    prefs.appearance["titleFont"] = json!("font:SF Pro Rounded");
    store.save_preferences(&prefs).unwrap();
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    assert_eq!(
        store.library().unwrap().appearance.unwrap()["titleFont"],
        "font:SF Pro Rounded"
    );
}

#[test]
fn invalid_appearance_settings_do_not_replace_saved_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let original = preferences();
    store.save_preferences(&original).unwrap();
    for (key, invalid) in [
        (
            "titleFont",
            vec![json!(""), json!(true), json!(1), Value::Null],
        ),
        (
            "animationsEnabled",
            vec![json!("true"), json!(1), Value::Null],
        ),
        (
            "lineSpacing",
            vec![
                json!(0.4),
                json!(2.6),
                json!(1.85),
                json!("1.8"),
                Value::Null,
            ],
        ),
        (
            "paragraphSpacing",
            vec![json!(-1), json!(33), json!(1.5), json!("8"), Value::Null],
        ),
        (
            "listItemSpacing",
            vec![json!(-9), json!(33), json!(1.5), json!("8"), Value::Null],
        ),
        (
            "editorBottomSpace",
            vec![
                json!(-8),
                json!(408),
                json!(7),
                json!(8.5),
                json!("112"),
                Value::Null,
            ],
        ),
        (
            "cursorStyle",
            vec![
                json!("bar"),
                json!("block-outline-thin"),
                json!(1),
                Value::Null,
            ],
        ),
        (
            "cursorBlinking",
            vec![json!("blink"), json!("hidden"), json!(true), Value::Null],
        ),
        (
            "cursorSmoothCaretAnimation",
            vec![
                json!("explicit"),
                json!("enabled"),
                json!(false),
                Value::Null,
            ],
        ),
        (
            "headingStyles",
            vec![
                Value::Null,
                json!({}),
                json!({"h1": {"font": null, "weight": 600, "italic": false, "color": null}}),
                json!({
                    "h1": {"font": null, "weight": 600, "italic": false, "color": null},
                    "h2": {"font": null, "weight": 600, "italic": false, "color": null},
                    "h3": {"font": null, "weight": 600, "italic": false, "color": null},
                    "h4": {"font": null, "weight": 600, "italic": false, "color": null},
                    "h5": {"font": null, "weight": 600, "italic": false, "color": null},
                    "h6": {"font": "", "weight": 650, "italic": "false", "color": "blue"}
                }),
            ],
        ),
    ] {
        for value in invalid {
            let mut prefs = preferences();
            prefs.expected_revision = 1;
            prefs.operation_id = "invalid-spacing".into();
            prefs.appearance[key] = value;
            assert!(store
                .save_preferences(&prefs)
                .unwrap_err()
                .contains("Invalid appearance"));
            assert_eq!(
                store.library().unwrap().appearance.unwrap(),
                original.appearance
            );
        }
    }
}

#[test]
fn complete_heading_styles_are_saved_with_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut prefs = preferences();
    prefs.appearance["headingStyles"] = heading_styles();
    store.save_preferences(&prefs).unwrap();
    assert_eq!(
        store.library().unwrap().appearance.unwrap()["headingStyles"],
        heading_styles()
    );
}

fn legacy_library(dir: &Path, version: i64) {
    let db = Connection::open(dir.join("library.sqlite3")).unwrap();
    db.execute_batch(include_str!("schema.sql")).unwrap();
    if version == 2 {
        db.execute_batch(
            "ALTER TABLE preferences ADD COLUMN workspace TEXT; PRAGMA user_version=2;",
        )
        .unwrap();
    }
    db.execute(
        "INSERT INTO notebooks(id,name,color) VALUES('work','Work','#abc')",
        [],
    )
    .unwrap();
    db.execute("INSERT INTO notes(id,title,notebook,body,plain_text,pinned,created,updated,revision,last_op) VALUES('a','Original','work',?,'Keep me',1,1,1,1,'old')", [note("a").content.unwrap().to_string()]).unwrap();
}

#[test]
fn upgrades_old_memberships_with_readable_backup_and_persists_multiple_books() {
    for version in [1, 2] {
        let dir = tempfile::tempdir().unwrap();
        legacy_library(dir.path(), version);
        let mut store = Store::open(dir.path()).unwrap();
        let original = store.note("a", true).unwrap();
        assert_eq!(original.notebook_ids, vec!["work"]);
        assert_eq!(store.notebooks().unwrap()[0].icon, "notebook");
        assert!(original.pinned);
        assert!(!original.quick_access);
        assert_eq!(original.content, note("a").content);
        let backup = fs::read_dir(dir.path().join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let db = Connection::open(backup).unwrap();
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            version
        );
        assert_eq!(
            db.query_row("SELECT notebook FROM notes WHERE id='a'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "work"
        );
        let mut prefs = preferences();
        prefs.notebooks.push(Notebook {
            id: "personal".into(),
            name: "Personal".into(),
            color: "#def".into(),
            icon: "folder".into(),
            parent_id: None,
            root_id: None,
            relative_path: None,
        });
        store.save_preferences(&prefs).unwrap();
        let mut input = note("a");
        input.expected_revision = 1;
        input.operation_id = "memberships".into();
        input.notebook_ids = vec!["work".into(), "personal".into(), "work".into()];
        input.quick_access = true;
        input.content = None;
        store.save_note(&input).unwrap();
        assert_eq!(store.save_note(&input).unwrap().revision, 2);
        drop(store);
        let mut store = Store::open(dir.path()).unwrap();
        let saved = store.note("a", true).unwrap();
        assert_eq!(saved.notebook_ids, vec!["work", "personal"]);
        assert!(saved.quick_access);
        assert!(!saved.pinned);
        assert_eq!(saved.content, original.content);
        input.expected_revision = 2;
        input.operation_id = "bad-membership".into();
        input.notebook_ids = vec!["missing".into()];
        assert!(store.save_note(&input).is_err());
        assert_eq!(
            store.note("a", true).unwrap().notebook_ids,
            saved.notebook_ids
        );
        assert_eq!(store.note("a", true).unwrap().revision, 2);
        input.operation_id = "move".into();
        input.notebook_ids = vec!["personal".into()];
        store.save_note(&input).unwrap();
        input.expected_revision = 3;
        input.operation_id = "uncategorized".into();
        input.notebook_ids.clear();
        store.save_note(&input).unwrap();
        assert!(store.note("a", true).unwrap().notebook_ids.is_empty());
    }
}

#[test]
fn backup_failure_and_migration_failure_leave_legacy_schema_unchanged() {
    for backup_failure in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        legacy_library(dir.path(), 1);
        if backup_failure {
            fs::write(dir.path().join("backups"), b"blocked").unwrap();
        } else {
            let db = Connection::open(dir.path().join("library.sqlite3")).unwrap();
            db.execute_batch("CREATE TABLE note_notebooks(collision TEXT)")
                .unwrap();
        }
        assert!(Store::open(dir.path()).is_err());
        let db = Connection::open(dir.path().join("library.sqlite3")).unwrap();
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT notebook FROM notes WHERE id='a'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "work"
        );
        assert!(db.prepare("SELECT workspace FROM preferences").is_err());
        assert!(db.prepare("SELECT quick_access FROM notes").is_err());
    }
}

#[test]
fn animation_preferences_survive_reopening() {
    let dir = tempfile::tempdir().unwrap();
    for enabled in [true, false] {
        let mut store = Store::open(dir.path()).unwrap();
        let mut prefs = preferences();
        prefs.expected_revision = store.library().unwrap().preferences_revision;
        prefs.operation_id = format!("animations-{enabled}");
        prefs.appearance["animationsEnabled"] = json!(enabled);
        store.save_preferences(&prefs).unwrap();
        drop(store);
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(
            store.library().unwrap().appearance.unwrap()["animationsEnabled"],
            enabled
        );
    }
}

#[test]
fn version_three_upgrade_is_backed_up_and_rolls_back_on_failure() {
    for failure in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        legacy_library(dir.path(), 2);
        let db = Connection::open(dir.path().join("library.sqlite3")).unwrap();
        db.execute_batch("CREATE TABLE note_notebooks(note_id TEXT NOT NULL REFERENCES notes(id), notebook_id TEXT NOT NULL REFERENCES notebooks(id), PRIMARY KEY(note_id,notebook_id)); INSERT INTO note_notebooks SELECT id,notebook FROM notes WHERE notebook IS NOT NULL; ALTER TABLE notes ADD COLUMN quick_access INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=3;").unwrap();
        if failure {
            db.execute_batch("CREATE TABLE linked_notes(collision TEXT)")
                .unwrap();
        }
        drop(db);
        if failure {
            assert!(Store::open(dir.path()).is_err());
            let db = Connection::open(dir.path().join("library.sqlite3")).unwrap();
            assert_eq!(
                db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                3
            );
            assert!(db.prepare("SELECT parent_id FROM notebooks").is_err());
        } else {
            let store = Store::open(dir.path()).unwrap();
            assert_eq!(store.note("a", true).unwrap().notebook_ids, vec!["work"]);
            assert!(store.note("a", true).unwrap().source.is_none());
            assert_eq!(
                store
                    .conn
                    .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                7
            );
        }
        let backup = fs::read_dir(dir.path().join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let db = Connection::open(backup).unwrap();
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            3
        );
    }
}

#[test]
fn note_list_order_survives_restart_and_old_workspace_defaults() {
    let legacy: WorkspacePreferences =
        serde_json::from_value(json!({"tabs": [], "activeTabId": null})).unwrap();
    assert!(legacy.note_lists.is_empty());
    assert!(legacy.pane_widths.is_none());
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut prefs = preferences();
    prefs.workspace = Some(
        serde_json::from_value(json!({
            "tabs": [], "activeTabId": null,
            "paneWidths": {"sidebar": 248, "noteList": 336},
            "noteLists": {"all": {"mode": "custom", "order": ["b", "a"]},
            "book:one": {"mode": "title", "order": []}}
        }))
        .unwrap(),
    );
    store.save_preferences(&prefs).unwrap();
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    let workspace = store.library().unwrap().workspace.unwrap();
    assert_eq!(
        workspace.pane_widths,
        Some(PaneWidths {
            sidebar: 248,
            note_list: 336,
        })
    );
    assert_eq!(workspace.note_lists["all"].order, vec!["b", "a"]);
    assert!(matches!(
        workspace.note_lists["all"].mode,
        NoteSortMode::Custom
    ));
    assert!(matches!(
        workspace.note_lists["book:one"].mode,
        NoteSortMode::Title
    ));
}

#[test]
fn invalid_workspace_pane_widths_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut prefs = preferences();
    prefs.workspace = Some(
        serde_json::from_value(json!({
            "tabs": [],
            "activeTabId": null,
            "paneWidths": {"sidebar": 143, "noteList": 336}
        }))
        .unwrap(),
    );

    assert_eq!(
        store.save_preferences(&prefs).unwrap_err(),
        "Invalid workspace pane widths."
    );
}
