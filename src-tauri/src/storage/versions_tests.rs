use super::versions::{MAX_VERSIONS, VERSION_INTERVAL_MS};
use super::*;
use serde_json::json;

fn save(store: &mut Store, id: &str, text: &str, revision: i64) {
    store
        .save_note_record(&SaveNote {
            id: id.into(),
            title: format!("Title {text}"),
            notebook_ids: vec![],
            quick_access: false,
            tags: vec![],
            content: Some(json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]})),
            text: text.into(),
            pinned: false,
            trashed: false,
            markdown: None,
            expected_fingerprint: None,
            expected_revision: revision,
            operation_id: uuid::Uuid::new_v4().to_string(),
        })
        .unwrap();
}
/// Pretends every version was kept long ago, so the next change keeps one again.
fn age(store: &Store) {
    store
        .conn
        .execute("UPDATE note_versions SET captured=captured-?", [VERSION_INTERVAL_MS + 1])
        .unwrap();
}

#[test]
fn a_changed_body_keeps_the_previous_one_at_most_every_interval() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    save(&mut store, "n", "first", 0);
    // Creating a note keeps nothing; the note itself is the latest version.
    assert!(store.note_versions("n").unwrap().is_empty());

    save(&mut store, "n", "second", 1);
    save(&mut store, "n", "third", 2);
    let versions = store.note_versions("n").unwrap();
    assert_eq!(versions.len(), 1, "edits within the interval keep only the body from before them");
    assert_eq!(versions[0].preview, "first");
    assert_eq!(versions[0].title, "Title first");

    age(&store);
    save(&mut store, "n", "fourth", 3);
    let versions = store.note_versions("n").unwrap();
    assert_eq!(versions.iter().map(|v| v.preview.as_str()).collect::<Vec<_>>(), ["third", "first"]);

    let full = store.note_version(versions[0].id).unwrap();
    assert_eq!(full.note_id, "n");
    assert_eq!(full.text, "third");
    assert_eq!(full.content["content"][0]["content"][0]["text"], json!("third"));
    assert!(store.note_version(9_999).unwrap_err().contains("no longer available"));
}

#[test]
fn metadata_changes_keep_nothing_and_restores_keep_the_current_body() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    save(&mut store, "n", "body", 0);
    save(&mut store, "n", "body", 1);
    assert!(store.note_versions("n").unwrap().is_empty());
    // A forced keep ignores the interval but never repeats an identical body.
    store.keep_note_version("n").unwrap();
    store.keep_note_version("n").unwrap();
    assert_eq!(store.note_versions("n").unwrap().len(), 1);
    save(&mut store, "n", "changed", 2);
    store.keep_note_version("n").unwrap();
    assert_eq!(store.note_versions("n").unwrap().len(), 2);
}

#[test]
fn history_keeps_the_newest_fifty_and_goes_with_its_note() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    save(&mut store, "n", "v0", 0);
    for i in 1..=(MAX_VERSIONS + 5) {
        age(&store);
        save(&mut store, "n", &format!("v{i}"), i);
    }
    let versions = store.note_versions("n").unwrap();
    assert_eq!(versions.len() as i64, MAX_VERSIONS);
    assert_eq!(versions[0].preview, format!("v{}", MAX_VERSIONS + 4));
    store.conn.execute_batch("DELETE FROM note_tags WHERE note_id='n'; DELETE FROM note_notebooks WHERE note_id='n'; DELETE FROM notes WHERE id='n';").unwrap();
    let left: i64 = store.conn.query_row("SELECT COUNT(*) FROM note_versions", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
}

#[test]
fn version_nineteen_upgrade_adds_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    save(&mut store, "n", "kept", 0);
    store.conn.execute_batch("DROP TABLE note_versions; PRAGMA user_version=19;").unwrap();
    drop(store);
    let mut store = Store::open(dir.path()).unwrap();
    assert_eq!(store.conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), 20);
    save(&mut store, "n", "next", 1);
    assert_eq!(store.note_versions("n").unwrap()[0].preview, "kept");
}
