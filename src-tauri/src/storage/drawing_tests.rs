use super::sync::{Entity, Operation, Page};
use super::*;
use serde_json::json;

#[test]
fn drawing_scenes_images_and_previews_survive_reopen_and_sync() {
    let source_dir = tempfile::tempdir().unwrap();
    let target_dir = tempfile::tempdir().unwrap();
    let content = json!({"type":"doc","content":[{"type":"drawing","attrs":{
        "id":"drawing-1","data":{"version":1,"revision":3,"previewRevision":3,
            "preview":"data:image/png;base64,aGVsbG8=",
            "scene":{"elements":[{"id":"shape-1","type":"image","fileId":"file-1","x":42}],
                "appState":{"viewBackgroundColor":"#ffffff","gridSize":20,"gridStep":5},
                "files":{"file-1":{"id":"file-1","mimeType":"image/png","dataURL":"data:image/png;base64,aGVsbG8=","created":1}}}
        }
    }},{"type":"drawing","attrs":{"id":"future","data":{"version":99,"unknown":"preserve"}}}]});
    let mut source = Store::open(source_dir.path()).unwrap();
    source
        .conn
        .execute("UPDATE sync_state SET library_id='test'", [])
        .unwrap();
    source
        .save_note_record(&SaveNote {
            id: "drawing-note".into(),
            title: "Drawing".into(),
            content: Some(content.clone()),
            text: "[Drawing]".into(),
            notebook_ids: vec![],
            tags: vec![],
            quick_access: false,
            pinned: false,
            trashed: false,
            markdown: None,
            expected_fingerprint: None,
            expected_revision: 0,
            operation_id: "drawing-save".into(),
        })
        .unwrap();
    source.prepare_sync().unwrap();
    let raw: String = source
        .conn
        .query_row("SELECT operation FROM sync_outbox", [], |row| row.get(0))
        .unwrap();
    let operation: Operation = serde_json::from_str(&raw).unwrap();
    assert_eq!(operation.data["content"], content);
    drop(source);
    let source = Store::open(source_dir.path()).unwrap();
    assert_eq!(
        source.note("drawing-note", true).unwrap().content,
        Some(content.clone())
    );
    let mut target = Store::open(target_dir.path()).unwrap();
    target
        .conn
        .execute("UPDATE sync_state SET library_id='test'", [])
        .unwrap();
    target.prepare_sync().unwrap();
    target
        .stage_page(Page {
            library_id: "test".into(),
            cursor: 1,
            target: 1,
            changes: vec![Entity {
                kind: "note".into(),
                id: "drawing-note".into(),
                revision: 1,
                deleted: false,
                data: operation.data,
            }],
        })
        .unwrap();
    target.finish_sync().unwrap();
    drop(target);
    let target = Store::open(target_dir.path()).unwrap();
    assert_eq!(
        target.note("drawing-note", true).unwrap().content,
        Some(content)
    );
}
