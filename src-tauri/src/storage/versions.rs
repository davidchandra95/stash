//! Note version history, kept on this device only. When a saved body changes, the body it replaces
//! becomes a version, at most once per `VERSION_INTERVAL` per note, so the version from before an
//! editing session is always kept. A sync that replaces local content, and a restore, keep the
//! current body first regardless of the interval. Folder-linked notes keep their history on disk.
use super::*;

pub(super) const VERSION_INTERVAL_MS: i64 = 10 * 60 * 1000;
pub(super) const MAX_VERSIONS: i64 = 50;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersionSummary {
    pub id: i64,
    pub title: String,
    /// When this body was saved.
    pub saved: i64,
    pub size: i64,
    /// The start of the plain text, for the list.
    pub preview: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersion {
    pub id: i64,
    pub note_id: String,
    pub title: String,
    pub saved: i64,
    pub content: Value,
    pub text: String,
}

/// Keeps the note's current body as a version unless it's linked, unchanged since the last
/// version, or (without `force`) the last version is recent.
pub(super) fn keep_version(conn: &Connection, note_id: &str, force: bool) -> Result<()> {
    let linked: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM linked_notes WHERE note_id=?)", [note_id], |r| r.get(0))
        .map_err(db_err)?;
    if linked {
        return Ok(());
    }
    let current: Option<(String, String, String, i64)> = conn
        .query_row(
            "SELECT title,body,plain_text,updated FROM notes WHERE id=?",
            [note_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(db_err)?;
    let Some((title, body, text, saved)) = current else { return Ok(()) };
    let last: Option<(String, i64)> = conn
        .query_row(
            "SELECT body,captured FROM note_versions WHERE note_id=? ORDER BY id DESC LIMIT 1",
            [note_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db_err)?;
    let at = now();
    if let Some((last_body, captured)) = last {
        if last_body == body || (!force && at - captured < VERSION_INTERVAL_MS) {
            return Ok(());
        }
    }
    conn.execute(
        "INSERT INTO note_versions(note_id,title,body,plain_text,saved,captured) VALUES(?,?,?,?,?,?)",
        params![note_id, title, body, text, saved, at],
    )
    .map_err(db_err)?;
    conn.execute(
        "DELETE FROM note_versions WHERE note_id=?1 AND id NOT IN(SELECT id FROM note_versions WHERE note_id=?1 ORDER BY id DESC LIMIT ?2)",
        params![note_id, MAX_VERSIONS],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Called before a body is replaced: keeps the current one when the new body differs.
pub(super) fn before_body_change(conn: &Connection, note_id: &str, next_body: &str, force: bool) -> Result<()> {
    let changed: Option<bool> = conn
        .query_row("SELECT body<>? FROM notes WHERE id=?", params![next_body, note_id], |r| r.get(0))
        .optional()
        .map_err(db_err)?;
    if changed == Some(true) {
        keep_version(conn, note_id, force)?;
    }
    Ok(())
}

impl Store {
    /// Newest first.
    pub fn note_versions(&self, note_id: &str) -> Result<Vec<NoteVersionSummary>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id,title,saved,length(body),substr(plain_text,1,200) FROM note_versions WHERE note_id=? ORDER BY id DESC",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map([note_id], |r| {
                Ok(NoteVersionSummary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    saved: r.get(2)?,
                    size: r.get(3)?,
                    preview: r.get(4)?,
                })
            })
            .map_err(db_err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_err)?;
        Ok(rows)
    }
    pub fn note_version(&self, id: i64) -> Result<NoteVersion> {
        let (note_id, title, saved, body, text): (String, String, i64, String, String) = self
            .conn
            .query_row(
                "SELECT note_id,title,saved,body,plain_text FROM note_versions WHERE id=?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()
            .map_err(db_err)?
            .ok_or("This version is no longer available.")?;
        let content: Value = serde_json::from_str(&body).map_err(db_err)?;
        Ok(NoteVersion { id, note_id, title, saved, content, text })
    }
    /// Keeps the current body now, before a restore replaces it.
    pub fn keep_note_version(&mut self, note_id: &str) -> Result<()> {
        let tx = self.conn.transaction().map_err(db_err)?;
        keep_version(&tx, note_id, true)?;
        tx.commit().map_err(db_err)
    }
}
