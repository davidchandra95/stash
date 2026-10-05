use fs2::FileExt;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, String>;
fn db_err(e: impl std::fmt::Display) -> String {
    format!("Storage error: {e}")
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn tag_word(value: char) -> bool {
    value.is_alphanumeric() || value == '_'
}
fn terminal_tag_punctuation(value: char) -> bool {
    matches!(
        value,
        '.' | ',' | '!' | '?' | ';' | ':' | ')' | ']' | '}' | '>' | '"' | '\'' | '”' | '’'
    )
}
pub(crate) fn body_tags(text: &str) -> Vec<String> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut result = Vec::new();
    for (index, (start, value)) in chars.iter().enumerate() {
        if *value != '#' {
            continue;
        }
        if let Some((_, previous)) = index.checked_sub(1).and_then(|n| chars.get(n)) {
            if tag_word(*previous) || *previous == '#' {
                continue;
            }
        }
        let content_start = *start + value.len_utf8();
        let mut end = text.len();
        for (next_start, next) in chars.iter().skip(index + 1) {
            if next.is_whitespace() {
                end = *next_start;
                break;
            }
        }
        let raw = text[content_start..end].trim_end_matches(terminal_tag_punctuation);
        if raw.is_empty() || raw.starts_with('#') {
            continue;
        }
        let tag = raw.to_lowercase();
        if !result.contains(&tag) {
            result.push(tag);
        }
    }
    result
}
pub(crate) fn legacy_tag_name(value: &str) -> Option<String> {
    let source = value.trim().trim_start_matches('#').trim().to_lowercase();
    if source.is_empty() {
        return None;
    }
    let mut result = String::new();
    let mut separator = false;
    for value in source.chars() {
        if value.is_alphanumeric() || matches!(value, '_' | '-') {
            result.push(value);
            separator = false;
        } else if !result.is_empty() && !separator {
            result.push('-');
            separator = true;
        }
    }
    let result = result.trim_matches('-').to_string();
    if !result.is_empty() {
        return Some(result);
    }
    Some(format!(
        "tag-{}",
        source
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}
pub(crate) fn tag_footer(tags: &[String]) -> String {
    format!(
        "Tags: {}",
        tags.iter()
            .map(|tag| format!("#{tag}"))
            .collect::<Vec<_>>()
            .join(" ")
    )
}
pub(crate) fn append_markdown_tag_footer(markdown: &str, tags: &[String]) -> String {
    let newline = if markdown.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut result = markdown.to_string();
    let separator = format!("{newline}{newline}");
    if !result.is_empty() && !result.ends_with(&separator) {
        if !result.ends_with(newline) {
            result.push_str(newline);
        }
        result.push_str(newline);
    }
    result.push_str(&tag_footer(tags));
    result.push_str(newline);
    result
}
fn default_notebook_icon() -> String {
    "notebook".into()
}
fn valid_notebook_icon(icon: &str) -> bool {
    matches!(
        icon,
        "notebook"
            | "book"
            | "folder"
            | "briefcase"
            | "graduationCap"
            | "home"
            | "heart"
            | "star"
            | "lightbulb"
            | "target"
            | "plane"
            | "archive"
            | "calendar"
            | "camera"
            | "coffee"
            | "dumbbell"
            | "flag"
            | "gamepad"
            | "globe"
            | "mapPin"
            | "music"
            | "palette"
            | "penLine"
            | "shoppingBag"
    )
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default = "default_notebook_icon")]
    pub icon: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub root_id: Option<String>,
    #[serde(default)]
    pub relative_path: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub notebook_ids: Vec<String>,
    pub quick_access: bool,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
    pub text: String,
    pub pinned: bool,
    pub trashed: bool,
    pub updated: i64,
    pub created: i64,
    pub revision: i64,
    pub document_version: i64,
    pub trashed_at: Option<i64>,
    pub has_tasks: bool,
    pub source: Option<linked::FileSource>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNote {
    pub id: String,
    pub title: String,
    pub notebook_ids: Vec<String>,
    pub quick_access: bool,
    pub tags: Vec<String>,
    pub content: Option<Value>,
    pub text: String,
    pub pinned: bool,
    pub trashed: bool,
    #[serde(default)]
    pub markdown: Option<String>,
    #[serde(default)]
    pub expected_fingerprint: Option<String>,
    pub expected_revision: i64,
    pub operation_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTab {
    pub id: String,
    #[serde(default = "note_tab_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<bool>,
}
fn note_tab_kind() -> String { "note".into() }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaneWidths {
    pub sidebar: u16,
    pub note_list: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfNotesPreferences {
    pub open: bool,
    pub ratio: f64,
    pub scroll: f64,
    pub pane: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreferences {
    #[serde(default)]
    pub pdf_notes: std::collections::BTreeMap<String, PdfNotesPreferences>,
    #[serde(default)]
    pub recent_note_ids: Vec<String>,
    #[serde(default)]
    pub pane_widths: Option<PaneWidths>,
    #[serde(default)]
    pub note_lists: std::collections::BTreeMap<String, NoteListPreferences>,
    pub tabs: Vec<WorkspaceTab>,
    pub active_tab_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteSortMode { LastEdited, Title, Custom }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteListPreferences {
    pub mode: NoteSortMode,
    pub order: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePreferences {
    #[serde(default)]
    pub workspace: Option<WorkspacePreferences>,
    pub appearance: Value,
    pub notebooks: Vec<Notebook>,
    pub expected_revision: i64,
    pub operation_id: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteNotebookRequest {
    pub id: String,
    pub include_children: bool,
    pub delete_notes: bool,
    pub operation_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub workspace: Option<WorkspacePreferences>,
    pub notes: Vec<Note>,
    pub notebooks: Vec<Notebook>,
    pub appearance: Option<Value>,
    pub preferences_revision: i64,
    pub path: String,
    pub roots: Vec<linked::Root>,
    pub conflicts: Vec<linked::PendingConflict>,
}
#[derive(Debug, Serialize)]
pub struct Saved {
    pub revision: i64,
    pub updated: i64,
}
pub struct Store {
    pub credentials: std::sync::Arc<dyn crate::credentials::CredentialStore>,
    conn: Connection,
    _lock: File,
    conversion: Option<conversion::Snapshot>,
    path: PathBuf,
}
impl Store {
    pub fn open(dir: &Path) -> Result<Self> {
        fs::create_dir_all(dir).map_err(db_err)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(dir.join("library.lock"))
            .map_err(db_err)?;
        lock.try_lock_exclusive().map_err(|_| "This library is already open in another Stash process. Close that process and retry.".to_string())?;
        let path = dir.join("library.sqlite3");
        let mut conn = Connection::open(&path).map_err(db_err)?;
        conn.busy_timeout(std::time::Duration::from_secs(3))
            .map_err(db_err)?;
        let check: String = conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(db_err)?;
        if check != "ok" {
            return Err(
                "The library failed its integrity check. Your files have not been replaced.".into(),
            );
        }
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(db_err)?;
        if version > 9 {
            return Err(
                "This library needs a newer version of Stash. Your files have not been changed."
                    .into(),
            );
        }
        if version > 0 && version < 9 {
            let backups = dir.join("backups");
            fs::create_dir_all(&backups).map_err(db_err)?;
            let backup = backups.join(format!(
                "library-v{}-{}-{}.sqlite3",
                version,
                now(),
                std::process::id()
            ));
            conn.execute("VACUUM INTO ?", [backup.to_string_lossy().as_ref()])
                .map_err(db_err)?;
            File::open(&backup)
                .and_then(|file| file.sync_all())
                .map_err(db_err)?;
        }
        if version < 4 {
            if version == 0 {
                let tables: i64 = conn
                    .query_row(
                        "SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
                        [],
                        |r| r.get(0),
                    )
                    .map_err(db_err)?;
                if tables != 0 {
                    return Err(
                        "Unrecognized library format. Your files have not been replaced.".into(),
                    );
                }
            }
            let tx = conn.transaction().map_err(db_err)?;
            if version == 0 {
                tx.execute_batch(include_str!("schema.sql"))
                    .map_err(db_err)?;
            }
            if version < 2 {
                tx.execute_batch("ALTER TABLE preferences ADD COLUMN workspace TEXT;")
                    .map_err(db_err)?;
            }
            if version < 3 {
                tx.execute_batch("CREATE TABLE note_notebooks (note_id TEXT NOT NULL REFERENCES notes(id), notebook_id TEXT NOT NULL REFERENCES notebooks(id), PRIMARY KEY(note_id,notebook_id));
                INSERT INTO note_notebooks SELECT id,notebook FROM notes WHERE notebook IS NOT NULL;
                CREATE INDEX note_notebooks_book ON note_notebooks(notebook_id);
                ALTER TABLE notes ADD COLUMN quick_access INTEGER NOT NULL DEFAULT 0;
                DROP INDEX notes_notebook;
                ALTER TABLE notes DROP COLUMN notebook;
                PRAGMA user_version=3;").map_err(db_err)?;
            }
            tx.execute_batch(include_str!("linked_schema.sql"))
                .map_err(db_err)?;
            tx.commit().map_err(db_err)?;
        }
        if version < 5 {
            let tx = conn.transaction().map_err(db_err)?;
            tx.execute_batch(
                "ALTER TABLE notebooks ADD COLUMN icon TEXT NOT NULL DEFAULT 'notebook';
                CREATE TABLE notebook_operations (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL);
                PRAGMA user_version=5;",
            )
            .map_err(db_err)?;
            tx.commit().map_err(db_err)?;
        }
        if version < 6 {
            let tx = conn.transaction().map_err(db_err)?;
            tx.execute_batch(include_str!("sync_schema.sql"))
                .map_err(db_err)?;
            tx.commit().map_err(db_err)?;
        }
        if version < 7 {
            let tx = conn.transaction().map_err(db_err)?;
            tx.execute_batch(include_str!("tag_schema.sql"))
                .map_err(db_err)?;
            tx.commit().map_err(db_err)?;
        }
        if version < 8 {
            let tx = conn.transaction().map_err(db_err)?;
            tx.execute_batch(include_str!("pdf_schema.sql")).map_err(db_err)?;
            tx.commit().map_err(db_err)?;
        }
        if version < 9 {
            let tx = conn.transaction().map_err(db_err)?;
            tx.execute_batch(include_str!("pdf_notes_schema.sql")).map_err(db_err)?;
            tx.commit().map_err(db_err)?;
        }
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        )
        .map_err(db_err)?;
        let mut store = Self {
            credentials: std::sync::Arc::new(crate::credentials::SystemCredentials),
            conn,
            _lock: lock,
            conversion: None,
            path,
        };
        if version < 7 {
            store.migrate_ordinary_tags()?;
        }
        store.recover_pdf_imports()?;
        Ok(store)
    }
    fn stored_tags(&self, id: &str) -> Result<Vec<String>> {
        self.conn
            .prepare("SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag")
            .map_err(db_err)?
            .query_map([id], |row| row.get(0))
            .map_err(db_err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_err)
    }
    pub(crate) fn tags_migrated(&self, id: &str) -> Result<bool> {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tag_body_migrations WHERE note_id=?)",
                [id],
                |row| row.get(0),
            )
            .map_err(db_err)
    }
    pub(crate) fn mark_tags_migrated(&self, id: &str) -> Result<()> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO tag_body_migrations(note_id) VALUES(?)",
                [id],
            )
            .map_err(db_err)?;
        Ok(())
    }
    pub(crate) fn replace_body_tags(&self, id: &str, tags: &[String]) -> Result<()> {
        self.conn
            .execute("DELETE FROM note_tags WHERE note_id=?", [id])
            .map_err(db_err)?;
        for tag in tags {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO note_tags(note_id,tag) VALUES(?,?)",
                    params![id, tag],
                )
                .map_err(db_err)?;
        }
        Ok(())
    }
    fn migrate_ordinary_tags(&mut self) -> Result<()> {
        let rows: Vec<(String, String, String)> = self
            .conn
            .prepare(
                "SELECT id,body,plain_text FROM notes WHERE id NOT IN(SELECT note_id FROM linked_notes)",
            )
            .map_err(db_err)?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(db_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        let tx = self.conn.transaction().map_err(db_err)?;
        for (id, body, text) in rows {
            let legacy: Vec<String> = tx
                .prepare("SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag")
                .map_err(db_err)?
                .query_map([&id], |row| row.get(0))
                .map_err(db_err)?
                .collect::<std::result::Result<_, _>>()
                .map_err(db_err)?;
            let mut tags = body_tags(&text);
            let missing: Vec<String> = legacy
                .iter()
                .filter_map(|tag| legacy_tag_name(tag))
                .filter(|tag| !tags.contains(tag))
                .collect();
            if !missing.is_empty() {
                tags.extend(missing.iter().cloned());
                let footer = tag_footer(&missing);
                let mut document: Value = serde_json::from_str(&body).map_err(db_err)?;
                let content = document
                    .get_mut("content")
                    .and_then(Value::as_array_mut)
                    .ok_or("The note body is missing document content.")?;
                content.push(serde_json::json!({
                    "type": "paragraph",
                    "content": [{"type": "text", "text": footer}],
                }));
                validate_document(&document)?;
                let next_text = if text.is_empty() {
                    footer
                } else {
                    format!("{text}\n{footer}")
                };
                tx.execute(
                    "UPDATE notes SET body=?,plain_text=?,has_tasks=?,updated=?,revision=revision+1,last_op='tag-body-migration' WHERE id=?",
                    params![document.to_string(), next_text, has_tasks(&document), now(), id],
                )
                .map_err(db_err)?;
            }
            tx.execute("DELETE FROM note_tags WHERE note_id=?", [&id])
                .map_err(db_err)?;
            for tag in tags {
                tx.execute(
                    "INSERT OR IGNORE INTO note_tags(note_id,tag) VALUES(?,?)",
                    params![id, tag],
                )
                .map_err(db_err)?;
            }
            tx.execute(
                "INSERT OR IGNORE INTO tag_body_migrations(note_id) VALUES(?)",
                [&id],
            )
            .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)
    }
    pub fn notebooks(&self) -> Result<Vec<Notebook>> {
        let mut stmt=self.conn.prepare("SELECT id,name,color,icon,parent_id,root_id,relative_path FROM notebooks ORDER BY rowid").map_err(db_err)?;
        let result = stmt
            .query_map([], |r| {
                Ok(Notebook {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    icon: r.get(3)?,
                    parent_id: r.get(4)?,
                    root_id: r.get(5)?,
                    relative_path: r.get(6)?,
                })
            })
            .map_err(db_err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_err);
        result
    }
    pub fn library(&self) -> Result<Library> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM notes ORDER BY updated DESC")
            .map_err(db_err)?;
        let ids = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(db_err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_err)?;
        let notes = ids
            .iter()
            .map(|id| self.note(id, false))
            .collect::<Result<Vec<_>>>()?;
        let notebooks = self.notebooks()?;
        let prefs: Option<(String, i64, Option<String>)> = self
            .conn
            .query_row(
                "SELECT appearance,revision,workspace FROM preferences WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(db_err)?;
        let (appearance, preferences_revision, workspace) = match prefs {
            Some((json, rev, workspace)) => {
                let value: Value = serde_json::from_str(&json).map_err(db_err)?;
                validate_appearance(&value)?;
                (
                    Some(value),
                    rev,
                    workspace
                        .map(|json| serde_json::from_str(&json))
                        .transpose()
                        .map_err(db_err)?,
                )
            }
            None => (None, 0, None),
        };
        Ok(Library {
            workspace,
            notes,
            notebooks,
            appearance,
            preferences_revision,
            path: self.path.display().to_string(),
            roots: self.roots()?,
            conflicts: self.pending_conflicts()?,
        })
    }
    pub fn note(&self, id: &str, body: bool) -> Result<Note> {
        let mut note = self.conn.query_row("SELECT id,title,quick_access,plain_text,pinned,trashed_at,created,updated,revision,document_version,has_tasks FROM notes WHERE id=?", [id], |r| {
   let trashed_at:Option<i64>=r.get(5)?;
   Ok(Note{id:r.get(0)?,title:r.get(1)?,notebook_ids:vec![],quick_access:r.get(2)?,text:r.get(3)?,pinned:r.get(4)?,trashed:trashed_at.is_some(),trashed_at,created:r.get(6)?,updated:r.get(7)?,revision:r.get(8)?,document_version:r.get(9)?,has_tasks:r.get(10)?,content:None,tags:vec![],source:None})
  }).map_err(db_err)?;
        if note.document_version != 1 {
            return Err(
                "This note needs a newer document format. Its content has not been changed.".into(),
            );
        }
        if body {
            let json: String = self
                .conn
                .query_row("SELECT body FROM notes WHERE id=?", [id], |r| r.get(0))
                .map_err(db_err)?;
            let content: Value = serde_json::from_str(&json).map_err(db_err)?;
            validate_document(&content)?;
            note.content = Some(content);
        }
        let mut stmt = self
            .conn
            .prepare("SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag")
            .map_err(db_err)?;
        note.tags = stmt
            .query_map([id], |r| r.get(0))
            .map_err(db_err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_err)?;
        let mut stmt = self
            .conn
            .prepare("SELECT notebook_id FROM note_notebooks WHERE note_id=? ORDER BY rowid")
            .map_err(db_err)?;
        note.notebook_ids = stmt
            .query_map([id], |r| r.get(0))
            .map_err(db_err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_err)?;
        note.source = self.file_source(id, body)?;
        Ok(note)
    }
    pub fn save_note_record(&mut self, input: &SaveNote) -> Result<Saved> {
        let tx = self.conn.transaction().map_err(db_err)?;
        let saved = Self::write_note_record(&tx, input)?;
        tx.commit().map_err(db_err)?;
        Ok(saved)
    }
    fn write_note_record(tx: &Connection, input: &SaveNote) -> Result<Saved> {
        if input.id.is_empty() || input.operation_id.is_empty() {
            return Err("A note ID and operation ID are required.".into());
        }
        if let Some(content) = &input.content {
            validate_document(content)?;
        }
        let current: Option<(i64, String, i64, Option<i64>)> = tx
            .query_row(
                "SELECT revision,last_op,updated,trashed_at FROM notes WHERE id=?",
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(db_err)?;
        if let Some((revision, op, updated, _)) = &current {
            if op == &input.operation_id {
                return Ok(Saved {
                    revision: *revision,
                    updated: *updated,
                });
            }
        }
        let revision = current.as_ref().map(|x| x.0).unwrap_or(0);
        if input.expected_revision != revision {
            return Err("Save conflict: this note has a newer saved version. Your pending edits are still in memory; do not reload.".into());
        }
        if current.is_none() && input.content.is_none() {
            return Err("A new note requires content.".into());
        }
        let timestamp = now();
        let trashed_at = if input.trashed {
            Some(current.as_ref().and_then(|x| x.3).unwrap_or(timestamp))
        } else {
            None
        };
        let body = input.content.as_ref().map(Value::to_string);
        let tasks = input.content.as_ref().map(has_tasks);
        if current.is_some() {
            tx.execute("UPDATE notes SET title=?1,quick_access=?2,body=coalesce(?3,body),plain_text=?4,has_tasks=coalesce(?5,has_tasks),pinned=?6,trashed_at=?7,updated=?8,revision=?9,last_op=?10 WHERE id=?11",params![input.title,input.quick_access,body,input.text,tasks,input.pinned,trashed_at,timestamp,revision+1,input.operation_id,input.id]).map_err(db_err)?;
        } else {
            tx.execute("INSERT INTO notes(id,title,quick_access,body,plain_text,has_tasks,pinned,trashed_at,created,updated,revision,last_op) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,1,?10)",params![input.id,input.title,input.quick_access,body,input.text,tasks,input.pinned,trashed_at,timestamp,input.operation_id]).map_err(db_err)?;
        }
        tx.execute("DELETE FROM note_notebooks WHERE note_id=?", [&input.id])
            .map_err(db_err)?;
        for book in &input.notebook_ids {
            tx.execute(
                "INSERT OR IGNORE INTO note_notebooks(note_id,notebook_id) VALUES(?,?)",
                params![input.id, book],
            )
            .map_err(db_err)?;
        }
        tx.execute("DELETE FROM note_tags WHERE note_id=?", [&input.id])
            .map_err(db_err)?;
        for tag in body_tags(&input.text) {
            tx.execute(
                "INSERT OR IGNORE INTO note_tags(note_id,tag) VALUES(?,?)",
                params![input.id, tag],
            )
            .map_err(db_err)?;
        }
        Ok(Saved { revision: revision + 1, updated: timestamp })
    }
    pub fn save_preferences(&mut self, input: &SavePreferences) -> Result<Saved> {
        validate_appearance(&input.appearance)?;
        if input.operation_id.is_empty() {
            return Err("A settings operation ID is required.".into());
        }
        self.validate_notebooks(&input.notebooks)?;
        let tx = self.conn.transaction().map_err(db_err)?;
        let current: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,last_op FROM preferences WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_err)?;
        if let Some((revision, op)) = &current {
            if op == &input.operation_id {
                return Ok(Saved {
                    revision: *revision,
                    updated: now(),
                });
            }
        }
        let revision = current.map(|x| x.0).unwrap_or(0);
        if revision != input.expected_revision {
            return Err(
                "Save conflict in settings or notebooks. Your pending changes are still in memory."
                    .into(),
            );
        }
        for book in &input.notebooks {
            if book.id.is_empty() || book.name.trim().is_empty() {
                return Err("A notebook must have an ID and name.".into());
            }
            if !valid_notebook_icon(&book.icon) {
                return Err("That notebook icon is not supported.".into());
            }
            tx.execute("INSERT INTO notebooks(id,name,color,icon,parent_id) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,icon=excluded.icon",params![book.id,book.name,book.color,book.icon,book.parent_id]).map_err(db_err)?;
        }
        tx.execute("INSERT INTO preferences(id,appearance,revision,last_op) VALUES(1,?1,?2,?3) ON CONFLICT(id) DO UPDATE SET appearance=excluded.appearance,revision=excluded.revision,last_op=excluded.last_op",params![input.appearance.to_string(),revision+1,input.operation_id]).map_err(db_err)?;
        if let Some(workspace) = &input.workspace {
            if workspace.pdf_notes.iter().any(|(id, p)| id.is_empty() || id.len() > 128 ||
                !p.ratio.is_finite() || !(0.1..=0.9).contains(&p.ratio) ||
                !p.scroll.is_finite() || !(0.0..=1e8).contains(&p.scroll) ||
                !matches!(p.pane.as_str(), "pdf" | "note")) {
                return Err("Invalid PDF notes layout.".into());
            }
            let mut recent_ids = std::collections::HashSet::new();
            if workspace.recent_note_ids.len() > 50
                || workspace
                    .recent_note_ids
                    .iter()
                    .any(|id| id.is_empty() || !recent_ids.insert(id))
            {
                return Err("Invalid recent note history.".into());
            }
            if workspace.pane_widths.as_ref().is_some_and(|widths| {
                widths.sidebar < 144
                    || widths.sidebar > 1200
                    || widths.note_list < 200
                    || widths.note_list > 1200
            }) {
                return Err("Invalid workspace pane widths.".into());
            }
            let mut ids = std::collections::HashSet::new();
            if workspace
                .tabs
                .iter()
                .any(|tab| tab.id.is_empty() || !ids.insert(&tab.id) || match tab.kind.as_str() {
                    "note" => tab.note_id.is_empty() || tab.document_id.is_some(),
                    "pdf" => !tab.note_id.is_empty() || tab.document_id.as_ref().is_none_or(|id| id.is_empty()) || tab.preview == Some(true),
                    _ => true,
                })
                || workspace
                    .tabs
                    .iter()
                    .filter(|tab| tab.preview == Some(true))
                    .count()
                    > 1
                || workspace
                    .active_tab_id
                    .as_ref()
                    .is_some_and(|id| !ids.contains(id))
            {
                return Err("Invalid workspace tabs.".into());
            }
            tx.execute(
                "UPDATE preferences SET workspace=?1 WHERE id=1",
                [serde_json::to_string(workspace).map_err(db_err)?],
            )
            .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        Ok(Saved {
            revision: revision + 1,
            updated: now(),
        })
    }
    pub fn delete_notebook(&mut self, input: &DeleteNotebookRequest) -> Result<Library> {
        if input.id.is_empty() || input.operation_id.is_empty() {
            return Err("A notebook ID and operation ID are required.".into());
        }
        let completed: Option<String> = self
            .conn
            .query_row(
                "SELECT notebook_id FROM notebook_operations WHERE id=?",
                [&input.operation_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_err)?;
        if let Some(notebook_id) = completed {
            if notebook_id != input.id {
                return Err("This notebook operation ID was already used.".into());
            }
            return self.library();
        }
        let books = self.notebooks()?;
        let Some(target) = books.iter().find(|book| book.id == input.id) else {
            // A completed delete is a safe no-op when a command response is retried.
            return self.library();
        };
        if target.root_id.is_some() {
            return Err("Folder-linked notebooks cannot be deleted from Stash.".into());
        }

        let mut removed = vec![target.id.clone()];
        if input.include_children {
            let mut index = 0;
            while index < removed.len() {
                let parent = removed[index].clone();
                let children: Vec<String> = books
                    .iter()
                    .filter(|book| {
                        book.parent_id.as_deref() == Some(parent.as_str())
                            && !removed.contains(&book.id)
                    })
                    .map(|book| book.id.clone())
                    .collect();
                removed.extend(children);
                index += 1;
            }
            if removed.iter().any(|id| {
                books
                    .iter()
                    .find(|book| &book.id == id)
                    .is_some_and(|book| book.root_id.is_some())
            }) {
                return Err(
                    "A subtree containing a folder-linked notebook cannot be deleted.".into(),
                );
            }
        }
        let removed_set: std::collections::HashSet<&str> =
            removed.iter().map(String::as_str).collect();
        let mut affected = Vec::new();
        for book_id in &removed {
            let mut stmt = self
                .conn
                .prepare("SELECT note_id FROM note_notebooks WHERE notebook_id=?")
                .map_err(db_err)?;
            let ids = stmt
                .query_map([book_id], |row| row.get::<_, String>(0))
                .map_err(db_err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(db_err)?;
            affected.extend(ids);
        }
        affected.sort();
        affected.dedup();

        if input.delete_notes {
            for note_id in &affected {
                let current = self.note(note_id, true)?;
                let notebook_ids = current
                    .notebook_ids
                    .iter()
                    .filter(|id| !removed_set.contains(id.as_str()))
                    .cloned()
                    .collect();
                let source = current.source.as_ref();
                self.save_note(&SaveNote {
                    id: current.id.clone(),
                    title: current.title.clone(),
                    notebook_ids,
                    quick_access: current.quick_access,
                    tags: current.tags.clone(),
                    content: current.content.clone(),
                    text: current.text.clone(),
                    pinned: current.pinned,
                    trashed: true,
                    markdown: None,
                    expected_fingerprint: source.map(|value| value.fingerprint.clone()),
                    expected_revision: current.revision,
                    operation_id: format!("{}:{}", input.operation_id, current.id),
                })?;
            }
        }

        let parent = target.parent_id.clone();
        let tx = self.conn.transaction().map_err(db_err)?;
        tx.execute(
            "INSERT INTO notebook_operations(id,notebook_id) VALUES(?,?)",
            params![input.operation_id, input.id],
        )
        .map_err(db_err)?;
        if !input.include_children {
            tx.execute(
                "UPDATE notebooks SET parent_id=?1 WHERE parent_id=?2",
                params![parent, target.id],
            )
            .map_err(db_err)?;
        }
        for book_id in &removed {
            tx.execute("DELETE FROM note_notebooks WHERE notebook_id=?", [book_id])
                .map_err(db_err)?;
        }
        if !input.delete_notes {
            for note_id in &affected {
                tx.execute(
                    "UPDATE notes SET updated=?,revision=revision+1,last_op=? WHERE id=?",
                    params![now(), format!("{}:note", input.operation_id), note_id],
                )
                .map_err(db_err)?;
            }
        }
        for book_id in removed.iter().rev() {
            tx.execute("DELETE FROM notebooks WHERE id=?", [book_id])
                .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        self.library()
    }
}
fn has_tasks(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("inlineCheckbox")
        || value.pointer("/attrs/kind").and_then(Value::as_str) == Some("task")
        || value
            .get("content")
            .and_then(Value::as_array)
            .is_some_and(|children| children.iter().any(has_tasks))
}
fn validate_document(value: &Value) -> Result<()> {
    if value.get("type").and_then(Value::as_str) != Some("doc")
        || !value.get("content").is_some_and(Value::is_array)
    {
        return Err("Invalid note document. The saved note was not changed.".into());
    }
    fn check(node: &Value, depth: usize) -> Result<()> {
        if depth > 128 || !node.is_object() || node.get("type").and_then(Value::as_str).is_none() {
            return Err("Invalid or excessively nested note content.".into());
        }
        if node.get("type").and_then(Value::as_str) == Some("noteReference") {
            let attrs = node
                .get("attrs")
                .ok_or("Missing note reference attributes.")?;
            let id = attrs
                .get("noteId")
                .and_then(Value::as_str)
                .ok_or("Invalid note reference ID.")?;
            if id.is_empty()
                || id.len() > 128
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                || !attrs.get("fallbackTitle").is_some_and(Value::is_string)
            {
                return Err("Invalid note reference attributes.".into());
            }
        }
        if let Some(children) = node.get("content") {
            for child in children.as_array().ok_or("Invalid document children.")? {
                check(child, depth + 1)?;
            }
        }
        Ok(())
    }
    check(value, 0)
}
pub mod bridge;
pub mod pdf;
pub mod conversion;
mod file_io;
mod file_links;
pub mod linked;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod drawing_tests;

fn valid_heading_styles(value: &Value) -> bool {
    const LEVELS: [&str; 6] = ["h1", "h2", "h3", "h4", "h5", "h6"];
    let Some(styles) = value.as_object() else {
        return false;
    };
    styles.len() == LEVELS.len()
        && LEVELS.iter().all(|level| {
            let Some(style) = styles.get(*level).and_then(Value::as_object) else {
                return false;
            };
            style.len() == 4
                && style.get("font").is_some_and(|value| {
                    value.is_null() || value.as_str().is_some_and(|font| !font.trim().is_empty())
                })
                && style
                    .get("weight")
                    .and_then(Value::as_i64)
                    .is_some_and(|weight| matches!(weight, 400 | 500 | 600 | 700))
                && style.get("italic").is_some_and(Value::is_boolean)
                && style.get("color").is_some_and(|value| {
                    value.is_null()
                        || value.as_str().is_some_and(|color| {
                            color.len() == 7
                                && color.starts_with('#')
                                && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
                        })
                })
        })
}

fn validate_appearance(value: &Value) -> Result<()> {
    let valid = value.get("dark").is_some_and(Value::is_boolean)
        && ["theme", "uiFont", "noteFont", "codeFont"]
            .iter()
            .all(|key| {
                value
                    .get(key)
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty())
            })
        && value
            .get("titleFont")
            .is_none_or(|v| v.as_str().is_some_and(|s| !s.is_empty()))
        && value
            .get("size")
            .and_then(Value::as_i64)
            .is_some_and(|n| (14..=23).contains(&n))
        && value
            .get("width")
            .and_then(Value::as_i64)
            .is_some_and(|n| (40..=100).contains(&n));
    let valid = valid
        && value.get("animationsEnabled").is_none_or(Value::is_boolean)
        && value.get("lineSpacing").is_none_or(|v| {
            v.as_f64().is_some_and(|n| {
                (0.5..=2.5).contains(&n) && (n * 10.0 - (n * 10.0).round()).abs() < 1e-9
            })
        })
        && value
            .get("paragraphSpacing")
            .is_none_or(|v| v.as_i64().is_some_and(|n| (0..=32).contains(&n)))
        && value
            .get("listItemSpacing")
            .is_none_or(|v| v.as_i64().is_some_and(|n| (-8..=32).contains(&n)))
        && value.get("editorBottomSpace").is_none_or(|v| {
            v.as_i64()
                .is_some_and(|n| (0..=400).contains(&n) && n % 8 == 0)
        })
        && value.get("cursorStyle").is_none_or(|v| {
            v.as_str().is_some_and(|s| {
                matches!(
                    s,
                    "line"
                        | "block"
                        | "underline"
                        | "line-thin"
                        | "block-outline"
                        | "underline-thin"
                )
            })
        })
        && value.get("cursorBlinking").is_none_or(|v| {
            v.as_str()
                .is_some_and(|s| matches!(s, "blinking" | "smooth" | "phase" | "expand" | "solid"))
        })
        && value
            .get("cursorSmoothCaretAnimation")
            .is_none_or(|v| v.as_str().is_some_and(|s| matches!(s, "off" | "on")))
        && value.get("headingStyles").is_none_or(valid_heading_styles);
    if valid {
        Ok(())
    } else {
        Err("Invalid appearance settings. The saved settings have not been replaced.".into())
    }
}

#[cfg(test)]
mod linked_tests;

pub mod sync;
#[cfg(test)]
mod sync_tests;

#[cfg(test)]
mod conversion_tests;
