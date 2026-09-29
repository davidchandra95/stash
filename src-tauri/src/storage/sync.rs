//! Manual synchronization. SQLite owns the queue, cycle checkpoint and pull staging.
use super::*;
use serde_json::json;
use std::io::Read;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub kind: String,
    pub id: String,
    pub revision: i64,
    pub deleted: bool,
    pub data: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub operation_id: String,
    pub kind: String,
    pub id: String,
    pub base_revision: i64,
    pub deleted: bool,
    pub data: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    operation_id: String,
    conflict: bool,
    message: Option<String>,
    current: Option<Entity>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub library_id: String,
    pub changes: Vec<Entity>,
    pub cursor: i64,
    pub target: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub url: String,
    pub configured: bool,
    pub last_success: Option<i64>,
    pub pending: i64,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
pub struct Outcome {
    pub library: Library,
    pub status: Status,
}

fn client() -> Result<reqwest::blocking::Client> {
    #[cfg(all(feature = "sync-test-ca", not(debug_assertions)))]
    compile_error!("sync-test-ca is restricted to isolated debug builds");
    let builder = reqwest::blocking::Client::builder();
    // Android's verifier uses AndroidCAStore, not app network-security-config.
    // This opt-in test build validates TLS against just the isolated fixture CA.
    #[cfg(feature = "sync-test-ca")]
    let builder = builder.tls_certs_only([reqwest::Certificate::from_pem(include_bytes!(env!("STASH_SYNC_TEST_CA_FILE")))
        .map_err(|_| "Invalid integration-test CA".to_string())?]);
    builder
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize the sync connection.".into())
}
fn response<T: serde::de::DeserializeOwned>(
    request: reqwest::blocking::RequestBuilder,
) -> Result<T> {
    let res = request.send().map_err(|_| {
        "Could not reach the sync server. Your local notes are safe; press Sync to retry."
            .to_string()
    })?;
    let status = res.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => {
                "Device token is invalid or revoked. Open sync connection settings to replace it."
                    .into()
            }
            400 | 409 | 422 => {
                let mut message = String::new();
                res.take(1024)
                    .read_to_string(&mut message)
                    .map_err(db_err)?;
                format!("Server rejected sync: {message}")
            }
            _ => format!("Sync server returned {status}. Your local notes are safe; retry later."),
        });
    }
    let mut bytes = Vec::new();
    res.take(70 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(db_err)?;
    if bytes.len() > 70 * 1024 * 1024 {
        return Err("Sync response exceeds the supported size.".into());
    };
    serde_json::from_slice(&bytes)
        .map_err(|_| "The server returned an unsupported sync response.".into())
}
impl Store {
    pub fn sync_status(&self) -> Result<Status> {
        let (url, last_success, warnings): (String, Option<i64>, String) = self
            .conn
            .query_row(
                "SELECT url,last_success,warnings FROM sync_state WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(db_err)?;
        let pending = self
            .conn
            .query_row(
                "SELECT (SELECT count(*) FROM sync_dirty d WHERE (d.kind='note' AND (d.id NOT IN(SELECT note_id FROM linked_notes) OR EXISTS(SELECT 1 FROM sync_versions v WHERE v.kind=d.kind AND v.id=d.id))) OR (d.kind='notebook' AND d.id NOT IN(SELECT id FROM sync_local_notebooks) AND (d.id NOT IN(SELECT id FROM notebooks WHERE root_id IS NOT NULL) OR EXISTS(SELECT 1 FROM sync_versions v WHERE v.kind=d.kind AND v.id=d.id))))+(SELECT count(*) FROM sync_outbox)",
                [],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        Ok(Status {
            configured: !url.is_empty(),
            url,
            last_success,
            pending,
            warnings: serde_json::from_str(&warnings).map_err(db_err)?,
        })
    }
    fn device(&self) -> Result<String> {
        self.conn
            .query_row("SELECT device FROM sync_state WHERE id=1", [], |r| r.get(0))
            .map_err(db_err)
    }
    pub fn configure_sync(&mut self, url: String, token: String) -> Result<Status> {
        let parsed = reqwest::Url::parse(url.trim())
            .map_err(|_| "Enter a valid HTTPS server URL.".to_string())?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Use an HTTPS origin, for example https://stash.slowtyper.cloud.".into());
        }
        let url = parsed.as_str().trim_end_matches('/');
        if token.trim().len() != 64 {
            return Err("Enter the complete device token.".into());
        }
        let info: Value = response(
            client()?
                .get(format!("{url}/v1/info"))
                .bearer_auth(token.trim()),
        )?;
        let identity = info["libraryId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("Invalid server identity.")?;
        if info["protocolVersion"] != 1 {
            return Err("This server requires a newer Stash version.".into());
        }
        let old: String = self
            .conn
            .query_row("SELECT library_id FROM sync_state", [], |r| r.get(0))
            .map_err(db_err)?;
        if !old.is_empty() && old != identity {
            return Err("This device is paired with a different library. Switching libraries requires a separate local profile.".into());
        }
        self.credentials.save(&self.device()?, token.trim())?;
        self.conn
            .execute(
                "UPDATE sync_state SET url=?,library_id=? WHERE id=1",
                params![url, identity],
            )
            .map_err(db_err)?;
        self.sync_status()
    }
    pub fn run_sync(&mut self, progress: impl Fn(&str)) -> Result<Outcome> {
        let status = self.sync_status()?;
        if !status.configured {
            return Err("Configure the sync connection first.".into());
        }
        let token = self.credentials.load(&self.device()?)?;
        self.sync_with(&status.url, &token, progress)
    }
    pub fn sync_with(
        &mut self,
        url: &str,
        token: &str,
        progress: impl Fn(&str),
    ) -> Result<Outcome> {
        let http = client()?;
        // Verify identity before sending any local content to a configured server.
        let info: Value = response(http.get(format!("{url}/v1/info")).bearer_auth(token))?;
        let identity: String = self
            .conn
            .query_row("SELECT library_id FROM sync_state", [], |r| r.get(0))
            .map_err(db_err)?;
        if info["libraryId"].as_str() != Some(identity.as_str()) || info["protocolVersion"] != 1 {
            return Err(
                "Sync server identity or protocol changed. Local notes were not uploaded.".into(),
            );
        }
        self.prepare_sync()?;
        loop {
            let next: Option<(i64, String)> = self
                .conn
                .query_row(
                    "SELECT sequence,operation FROM sync_outbox ORDER BY sequence LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(db_err)?;
            let Some((seq, raw)) = next else { break };
            let op: Operation = serde_json::from_str(&raw).map_err(db_err)?;
            progress("Uploading changes…");
            let receipt: Receipt = response(
                http.post(format!("{url}/v1/push"))
                    .bearer_auth(token)
                    .json(&op),
            )?;
            if receipt.operation_id != op.operation_id {
                return Err("Server acknowledged a different operation.".into());
            }
            let tx = self.conn.transaction().map_err(db_err)?;
            if receipt.conflict {
                let raw: String = tx
                    .query_row("SELECT warnings FROM sync_state", [], |r| r.get(0))
                    .map_err(db_err)?;
                let mut warnings: Vec<String> = serde_json::from_str(&raw).map_err(db_err)?;
                warnings.push(format!(
                    "{}: {}",
                    op.data[if op.kind == "note" { "title" } else { "name" }]
                        .as_str()
                        .unwrap_or(&op.id),
                    receipt
                        .message
                        .unwrap_or_else(|| "A conflicting change was preserved.".into())
                ));
                tx.execute(
                    "UPDATE sync_state SET warnings=?",
                    [serde_json::to_string(&warnings).map_err(db_err)?],
                )
                .map_err(db_err)?;
            }
            if let Some(e) = receipt.current {
                tx.execute("INSERT INTO sync_inbox VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET record=excluded.record",params![e.kind,e.id,serde_json::to_string(&e).map_err(db_err)?]).map_err(db_err)?;
            }
            tx.execute("DELETE FROM sync_outbox WHERE sequence=?", [seq])
                .map_err(db_err)?;
            tx.commit().map_err(db_err)?;
        }
        loop {
            let (after, target): (i64, Option<i64>) = self
                .conn
                .query_row("SELECT page_cursor,target FROM sync_state", [], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .map_err(db_err)?;
            if target == Some(after) {
                break;
            }
            progress("Downloading changes…");
            let mut request = http
                .get(format!("{url}/v1/pull"))
                .bearer_auth(token)
                .query(&[("after", after.to_string())]);
            if let Some(target) = target {
                request = request.query(&[("target", target.to_string())])
            }
            let page: Page = response(request)?;
            self.stage_page(page)?;
        }
        progress("Saving synced notes…");
        self.finish_sync()?;
        Ok(Outcome {
            library: self.library()?,
            status: self.sync_status()?,
        })
    }
    pub fn prepare_sync(&mut self) -> Result<()> {
        let active: bool = self
            .conn
            .query_row("SELECT active FROM sync_state", [], |r| r.get(0))
            .map_err(db_err)?;
        if active {
            return Ok(());
        }
        let mut dirty = {
            let mut stmt=self.conn.prepare("SELECT kind,id FROM sync_dirty WHERE kind!='notebook' OR id NOT IN(SELECT id FROM sync_local_notebooks) ORDER BY kind,id").map_err(db_err)?;
            let items = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(db_err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(db_err)?;
            items
        };
        let mut books = self.notebooks()?;
        let local_only = {
            let mut q = self
                .conn
                .prepare("SELECT id FROM sync_local_notebooks")
                .map_err(db_err)?;
            let ids = q
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(db_err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(db_err)?;
            ids
        };
        books.retain(|b| !local_only.contains(&b.id));
        // Parents before children; notebooks before note memberships.
        dirty.sort_by_key(|(kind, id)| {
            let mut depth = 0;
            let mut parent = books
                .iter()
                .find(|b| &b.id == id)
                .and_then(|b| b.parent_id.clone());
            let mut seen = std::collections::HashSet::new();
            while let Some(p) = parent {
                if !seen.insert(p.clone()) {
                    break;
                };
                depth += 1;
                parent = books
                    .iter()
                    .find(|b| b.id == p)
                    .and_then(|b| b.parent_id.clone())
            }
            (if kind == "notebook" { 0 } else { 1 }, depth)
        });
        let mut ops = Vec::new();
        for (kind, id) in dirty {
            let base_revision = self
                .conn
                .query_row(
                    "SELECT revision FROM sync_versions WHERE kind=? AND id=?",
                    params![kind, id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db_err)?
                .unwrap_or(0);
            let data = if kind == "note" {
                let exists:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM notes WHERE id=? AND id NOT IN(SELECT note_id FROM linked_notes))",[&id],|r|r.get(0)).map_err(db_err)?;
                if exists {
                    let mut note = self.note(&id, true)?;
                    note.notebook_ids
                        .retain(|id| books.iter().any(|b| &b.id == id && b.root_id.is_none()));
                    Some(serde_json::to_value(note).map_err(db_err)?)
                } else {
                    None
                }
            } else {
                books
                    .iter()
                    .find(|b| b.id == id && b.root_id.is_none())
                    .map(|b| {
                        let mut b = b.clone();
                        if b.parent_id.as_ref().is_some_and(|p| {
                            books.iter().any(|b| &b.id == p && b.root_id.is_some())
                        }) {
                            b.parent_id = None
                        };
                        serde_json::to_value(b).map_err(db_err)
                    })
                    .transpose()?
            };
            if data.is_none() && base_revision == 0 {
                continue;
            }
            ops.push(Operation {
                operation_id: uuid::Uuid::new_v4().to_string(),
                kind,
                id,
                base_revision,
                deleted: data.is_none(),
                data: data.unwrap_or(json!({})),
            });
        }
        // Membership updates precede notebook tombstones. Otherwise a deletion's
        // server-side cleanup would create conflicts with this same device's edits.
        ops.sort_by_key(|op| {
            if op.kind == "notebook" && op.deleted {
                2
            } else if op.kind == "note" {
                1
            } else {
                0
            }
        });
        let tx = self.conn.transaction().map_err(db_err)?;
        for op in ops {
            tx.execute(
                "INSERT INTO sync_outbox(operation) VALUES(?)",
                [serde_json::to_string(&op).map_err(db_err)?],
            )
            .map_err(db_err)?;
        }
        tx.execute_batch("DELETE FROM sync_dirty; UPDATE sync_state SET active=1,target=NULL,page_cursor=cursor,warnings='[]';").map_err(db_err)?;
        tx.commit().map_err(db_err)
    }
    pub fn stage_page(&mut self, page: Page) -> Result<()> {
        let (identity, after, target): (String, i64, Option<i64>) = self
            .conn
            .query_row(
                "SELECT library_id,page_cursor,target FROM sync_state",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(db_err)?;
        if page.library_id != identity
            || page.target < after
            || page.cursor < after
            || page.cursor > page.target
            || target.is_some_and(|t| t != page.target)
        {
            return Err("Invalid sync cursor or server identity.".into());
        }
        let mut last = after;
        for e in &page.changes {
            if e.revision != last + 1
                || e.revision > page.target
                || !matches!(e.kind.as_str(), "note" | "notebook")
            {
                return Err("Incomplete or unsupported sync changes.".into());
            }
            last = e.revision;
        }
        if last != page.cursor || (page.cursor == after && page.target != after) {
            return Err("Sync download made no progress.".into());
        }
        let tx = self.conn.transaction().map_err(db_err)?;
        for e in page.changes {
            tx.execute("INSERT INTO sync_inbox VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET record=excluded.record",params![e.kind,e.id,serde_json::to_string(&e).map_err(db_err)?]).map_err(db_err)?;
        }
        tx.execute(
            "UPDATE sync_state SET page_cursor=?,target=?",
            params![page.cursor, page.target],
        )
        .map_err(db_err)?;
        tx.commit().map_err(db_err)
    }
    pub fn finish_sync(&mut self) -> Result<()> {
        let records = {
            let mut stmt = self
                .conn
                .prepare("SELECT record FROM sync_inbox ORDER BY kind,id")
                .map_err(db_err)?;
            let raw = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(db_err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(db_err)?;
            raw.into_iter()
                .map(|s| serde_json::from_str::<Entity>(&s).map_err(db_err))
                .collect::<Result<Vec<_>>>()?
        };
        let tx = self.conn.transaction().map_err(db_err)?;
        let ready:bool=tx.query_row("SELECT active=1 AND target=page_cursor AND NOT EXISTS(SELECT 1 FROM sync_outbox) FROM sync_state",[],|r|r.get(0)).map_err(db_err)?;
        if !ready {
            return Err("Sync download is not complete.".into());
        }
        tx.execute_batch("UPDATE sync_state SET applying=1; PRAGMA defer_foreign_keys=ON;")
            .map_err(db_err)?;
        // Notebook rows precede notes. Deferred foreign keys support parent ordering across pages.
        let mut records = records;
        records.sort_by_key(|e| if e.kind == "notebook" { 0 } else { 1 });
        for e in records {
            let dirty: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sync_dirty WHERE kind=? AND id=?)",
                    params![e.kind, e.id],
                    |r| r.get(0),
                )
                .map_err(db_err)?;
            // Edits made after a failed cycle stay local with their old base revision. The next
            // click sends them with conflict detection, rather than replacing them during pull.
            if dirty {
                continue;
            }
            let linked: bool = if e.kind == "note" {
                tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM linked_notes WHERE note_id=?)",
                    [&e.id],
                    |r| r.get(0),
                )
                .map_err(db_err)?
            } else {
                tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id=? AND root_id IS NOT NULL)",
                    [&e.id],
                    |r| r.get(0),
                )
                .map_err(db_err)?
            };
            if !linked {
                if e.kind == "notebook" {
                    if e.deleted {
                        tx.execute("DELETE FROM note_notebooks WHERE notebook_id=? AND note_id NOT IN(SELECT note_id FROM linked_notes)",[&e.id]).map_err(db_err)?;
                        let needed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM note_notebooks WHERE notebook_id=?) OR EXISTS(SELECT 1 FROM notebooks WHERE parent_id=? AND root_id IS NOT NULL)",[&e.id,&e.id],|r|r.get(0)).map_err(db_err)?;
                        // Keep a local-only shell if a linked note/root still uses this notebook.
                        if needed {
                            tx.execute(
                                "INSERT OR IGNORE INTO sync_local_notebooks VALUES(?)",
                                [&e.id],
                            )
                            .map_err(db_err)?;
                        }
                        if !needed {
                            tx.execute(
                                "UPDATE notebooks SET parent_id=NULL WHERE parent_id=?",
                                [&e.id],
                            )
                            .map_err(db_err)?;
                            tx.execute("DELETE FROM notebooks WHERE id=?", [&e.id])
                                .map_err(db_err)?;
                        }
                    } else {
                        let b: Notebook = serde_json::from_value(e.data).map_err(db_err)?;
                        if b.id != e.id || b.root_id.is_some() || !valid_notebook_icon(&b.icon) {
                            return Err("Invalid synced notebook.".into());
                        }
                        tx.execute("INSERT INTO notebooks(id,name,color,icon,parent_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,icon=excluded.icon,parent_id=excluded.parent_id",params![b.id,b.name,b.color,b.icon,b.parent_id]).map_err(db_err)?;
                    }
                } else if e.deleted {
                    tx.execute("DELETE FROM note_tags WHERE note_id=?", [&e.id])
                        .map_err(db_err)?;
                    tx.execute("DELETE FROM note_notebooks WHERE note_id=?", [&e.id])
                        .map_err(db_err)?;
                    tx.execute("DELETE FROM notes WHERE id=?", [&e.id])
                        .map_err(db_err)?;
                } else {
                    let n: Note = serde_json::from_value(e.data).map_err(db_err)?;
                    if n.id != e.id || n.document_version != 1 || n.source.is_some() {
                        return Err("Unsupported synced note format.".into());
                    }
                    let body = n.content.ok_or("Missing synced document.")?;
                    validate_document(&body)?;
                    tx.execute("INSERT INTO notes(id,title,body,document_version,plain_text,has_tasks,pinned,trashed_at,created,updated,revision,last_op,quick_access) VALUES(?,?,?,1,?,?,?,?,?,?,1,'sync',?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,plain_text=excluded.plain_text,has_tasks=excluded.has_tasks,pinned=excluded.pinned,trashed_at=excluded.trashed_at,created=excluded.created,updated=excluded.updated,revision=notes.revision+1,last_op='sync',quick_access=excluded.quick_access",params![n.id,n.title,body.to_string(),n.text,has_tasks(&body),n.pinned,if n.trashed{Some(n.trashed_at.unwrap_or(n.updated))}else{None},n.created,n.updated,n.quick_access]).map_err(db_err)?;
                    tx.execute("DELETE FROM note_tags WHERE note_id=?", [&n.id])
                        .map_err(db_err)?;
                    for tag in body_tags(&n.text) {
                        tx.execute(
                            "INSERT OR IGNORE INTO note_tags VALUES(?,?)",
                            params![n.id, tag],
                        )
                        .map_err(db_err)?;
                    }
                    tx.execute("DELETE FROM note_notebooks WHERE note_id=?", [&n.id])
                        .map_err(db_err)?;
                    for id in n.notebook_ids {
                        tx.execute("INSERT OR IGNORE INTO note_notebooks SELECT ?,id FROM notebooks WHERE id=?",params![n.id,id]).map_err(db_err)?;
                    }
                }
            }
            tx.execute("INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision",params![e.kind,e.id,e.revision]).map_err(db_err)?;
        }
        tx.execute("UPDATE sync_state SET cursor=page_cursor,last_success=?,applying=0,active=0,target=NULL",[now()]).map_err(db_err)?;
        tx.execute("DELETE FROM sync_inbox", []).map_err(db_err)?;
        tx.commit().map_err(db_err)
    }
}
