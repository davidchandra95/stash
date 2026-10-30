//! Projects and tasks are local-only for now; they have no sync triggers. See
//! documents/PROJECTS_AND_TASKS.md for the planned sync design.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub completed_at: Option<i64>,
    pub notebook_id: Option<String>,
    pub color: String,
    pub sort: f64,
    pub deleted_at: Option<i64>,
    pub created: i64,
    pub updated: i64,
    pub revision: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub project_id: Option<String>,
    pub priority: i64,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub completed_at: Option<i64>,
    pub sort: f64,
    pub deleted_at: Option<i64>,
    pub created: i64,
    pub updated: i64,
    pub revision: i64,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectData {
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
}
/// A full record to create (`expected_revision` 0) or replace. Timestamps, `completed_at`
/// and the revision are set by the store.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProject {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub notebook_id: Option<String>,
    pub color: String,
    pub sort: f64,
    pub deleted: bool,
    pub expected_revision: i64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub project_id: Option<String>,
    pub priority: i64,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub sort: f64,
    pub deleted: bool,
    pub expected_revision: i64,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChanges {
    #[serde(default)]
    pub projects: Vec<SaveProject>,
    #[serde(default)]
    pub tasks: Vec<SaveTask>,
}

const PROJECT_COLUMNS: &str = "id,name,description,status,start_date,end_date,completed_at,notebook_id,color,sort,deleted_at,created,updated,revision";
const TASK_COLUMNS: &str = "id,title,description,status,project_id,priority,start_date,due_date,completed_at,sort,deleted_at,created,updated,revision";

fn project_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        status: r.get(3)?,
        start_date: r.get(4)?,
        end_date: r.get(5)?,
        completed_at: r.get(6)?,
        notebook_id: r.get(7)?,
        color: r.get(8)?,
        sort: r.get(9)?,
        deleted_at: r.get(10)?,
        created: r.get(11)?,
        updated: r.get(12)?,
        revision: r.get(13)?,
    })
}
fn task_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        status: r.get(3)?,
        project_id: r.get(4)?,
        priority: r.get(5)?,
        start_date: r.get(6)?,
        due_date: r.get(7)?,
        completed_at: r.get(8)?,
        sort: r.get(9)?,
        deleted_at: r.get(10)?,
        created: r.get(11)?,
        updated: r.get(12)?,
        revision: r.get(13)?,
    })
}
pub(super) fn valid_record_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
/// A calendar date written as YYYY-MM-DD.
fn valid_date(date: &Option<String>) -> bool {
    let Some(date) = date else { return true };
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3
        || parts[0].len() != 4
        || parts[1].len() != 2
        || parts[2].len() != 2
        || !date.bytes().all(|b| b.is_ascii_digit() || b == b'-')
    {
        return false;
    }
    let (year, month, day): (i32, u32, u32) = (
        parts[0].parse().unwrap_or(0),
        parts[1].parse().unwrap_or(0),
        parts[2].parse().unwrap_or(0),
    );
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    year > 0 && (1..=days).contains(&day)
}
fn valid_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..].bytes().all(|b| b.is_ascii_hexdigit())
}
fn validate_project(p: &SaveProject) -> Result<()> {
    if !valid_record_id(&p.id) {
        return Err("Invalid project ID.".into());
    }
    if p.name.trim().is_empty() || p.name.chars().count() > 200 {
        return Err("A project needs a name of up to 200 characters.".into());
    }
    if p.description.chars().count() > 10_000 {
        return Err("The project description is too long.".into());
    }
    if !matches!(
        p.status.as_str(),
        "planned" | "active" | "on_hold" | "done" | "cancelled"
    ) {
        return Err("Invalid project status.".into());
    }
    if !valid_date(&p.start_date) || !valid_date(&p.end_date) {
        return Err("Project dates must be valid calendar dates.".into());
    }
    if let (Some(start), Some(end)) = (&p.start_date, &p.end_date) {
        if end < start {
            return Err("A project can't end before it starts.".into());
        }
    }
    if p.notebook_id.as_deref().is_some_and(|id| !valid_record_id(id)) {
        return Err("Invalid notebook ID.".into());
    }
    if !valid_color(&p.color) {
        return Err("Invalid project color.".into());
    }
    if !p.sort.is_finite() {
        return Err("Invalid project order.".into());
    }
    Ok(())
}
fn validate_task(t: &SaveTask) -> Result<()> {
    if !valid_record_id(&t.id) {
        return Err("Invalid task ID.".into());
    }
    if t.title.trim().is_empty() || t.title.chars().count() > 500 {
        return Err("A task needs a title of up to 500 characters.".into());
    }
    if t.description.chars().count() > 10_000 {
        return Err("The task description is too long.".into());
    }
    if !matches!(t.status.as_str(), "todo" | "doing" | "done" | "cancelled") {
        return Err("Invalid task status.".into());
    }
    if !(0..=3).contains(&t.priority) {
        return Err("Invalid task priority.".into());
    }
    if !valid_date(&t.start_date) || !valid_date(&t.due_date) {
        return Err("Task dates must be valid calendar dates.".into());
    }
    if t.project_id.as_deref().is_some_and(|id| !valid_record_id(id)) {
        return Err("Invalid project ID.".into());
    }
    if !t.sort.is_finite() {
        return Err("Invalid task order.".into());
    }
    Ok(())
}
/// The stored record must still be at the revision the caller edited.
fn check_revision(current: Option<i64>, expected: i64, kind: &str) -> Result<i64> {
    match current {
        None if expected == 0 => Ok(0),
        Some(revision) if revision == expected => Ok(revision),
        None => Err(format!("This {kind} no longer exists.")),
        Some(_) => Err(format!(
            "This {kind} changed since it was opened. Reload and try again."
        )),
    }
}
/// `completed_at` follows the status: set when it becomes done, cleared when it leaves done.
fn completion(
    status: &str,
    previous: Option<(&str, Option<i64>)>,
    at: i64,
) -> Option<i64> {
    if status != "done" {
        return None;
    }
    match previous {
        Some(("done", Some(completed))) => Some(completed),
        _ => Some(at),
    }
}

impl Store {
    pub fn project_data(&self) -> Result<ProjectData> {
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {PROJECT_COLUMNS} FROM projects ORDER BY sort,rowid"
            ))
            .map_err(db_err)?;
        let projects = stmt
            .query_map([], project_row)
            .map_err(db_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {TASK_COLUMNS} FROM tasks ORDER BY sort,rowid"))
            .map_err(db_err)?;
        let tasks = stmt
            .query_map([], task_row)
            .map_err(db_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        Ok(ProjectData { projects, tasks })
    }

    /// Applies every change in one transaction and returns the saved records. Any invalid or
    /// stale change rejects the whole batch.
    pub fn save_project_changes(&mut self, changes: &ProjectChanges) -> Result<ProjectData> {
        for project in &changes.projects {
            validate_project(project)?;
        }
        for task in &changes.tasks {
            validate_task(task)?;
        }
        let at = now();
        let tx = self.conn.transaction().map_err(db_err)?;
        let mut saved = ProjectData::default();
        for p in &changes.projects {
            let current: Option<(i64, i64, String, Option<i64>, Option<i64>)> = tx
                .query_row(
                    "SELECT revision,created,status,completed_at,deleted_at FROM projects WHERE id=?",
                    [&p.id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .optional()
                .map_err(db_err)?;
            let revision = check_revision(
                current.as_ref().map(|c| c.0),
                p.expected_revision,
                "project",
            )?;
            let created = current.as_ref().map_or(at, |c| c.1);
            let completed_at = completion(
                &p.status,
                current.as_ref().map(|c| (c.2.as_str(), c.3)),
                at,
            );
            let deleted_at = p
                .deleted
                .then(|| current.as_ref().and_then(|c| c.4).unwrap_or(at));
            tx.execute(
                "INSERT INTO projects(id,name,description,status,start_date,end_date,completed_at,notebook_id,color,sort,deleted_at,created,updated,revision)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,status=excluded.status,
                 start_date=excluded.start_date,end_date=excluded.end_date,completed_at=excluded.completed_at,
                 notebook_id=excluded.notebook_id,color=excluded.color,sort=excluded.sort,deleted_at=excluded.deleted_at,
                 updated=excluded.updated,revision=excluded.revision",
                params![
                    p.id,
                    p.name.trim(),
                    p.description,
                    p.status,
                    p.start_date,
                    p.end_date,
                    completed_at,
                    p.notebook_id,
                    p.color.to_lowercase(),
                    p.sort,
                    deleted_at,
                    created,
                    at,
                    revision + 1
                ],
            )
            .map_err(db_err)?;
        }
        for t in &changes.tasks {
            if let Some(project) = &t.project_id {
                let exists: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?)",
                        [project],
                        |r| r.get(0),
                    )
                    .map_err(db_err)?;
                if !exists {
                    return Err("This task's project no longer exists.".into());
                }
            }
            let current: Option<(i64, i64, String, Option<i64>, Option<i64>)> = tx
                .query_row(
                    "SELECT revision,created,status,completed_at,deleted_at FROM tasks WHERE id=?",
                    [&t.id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .optional()
                .map_err(db_err)?;
            let revision = check_revision(
                current.as_ref().map(|c| c.0),
                t.expected_revision,
                "task",
            )?;
            let created = current.as_ref().map_or(at, |c| c.1);
            let completed_at = completion(
                &t.status,
                current.as_ref().map(|c| (c.2.as_str(), c.3)),
                at,
            );
            let deleted_at = t
                .deleted
                .then(|| current.as_ref().and_then(|c| c.4).unwrap_or(at));
            tx.execute(
                "INSERT INTO tasks(id,title,description,status,project_id,priority,start_date,due_date,completed_at,sort,deleted_at,created,updated,revision)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,status=excluded.status,
                 project_id=excluded.project_id,priority=excluded.priority,start_date=excluded.start_date,due_date=excluded.due_date,
                 completed_at=excluded.completed_at,sort=excluded.sort,deleted_at=excluded.deleted_at,
                 updated=excluded.updated,revision=excluded.revision",
                params![
                    t.id,
                    t.title.trim(),
                    t.description,
                    t.status,
                    t.project_id,
                    t.priority,
                    t.start_date,
                    t.due_date,
                    completed_at,
                    t.sort,
                    deleted_at,
                    created,
                    at,
                    revision + 1
                ],
            )
            .map_err(db_err)?;
        }
        for p in &changes.projects {
            saved.projects.push(
                tx.query_row(
                    &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id=?"),
                    [&p.id],
                    project_row,
                )
                .map_err(db_err)?,
            );
        }
        for t in &changes.tasks {
            saved.tasks.push(
                tx.query_row(
                    &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id=?"),
                    [&t.id],
                    task_row,
                )
                .map_err(db_err)?,
            );
        }
        tx.commit().map_err(db_err)?;
        Ok(saved)
    }
}

/// Whether a note body mentions the task: a `taskReference` node in a native document, or a
/// `stash://task/<id>` link in linked Markdown.
fn document_mentions(node: &Value, task_id: &str) -> bool {
    (node["type"] == "taskReference" && node["attrs"]["taskId"] == task_id)
        || node["content"]
            .as_array()
            .is_some_and(|children| children.iter().any(|child| document_mentions(child, task_id)))
}
pub(super) fn markdown_mentions(markdown: &str, task_id: &str) -> bool {
    let link = format!("stash://task/{task_id}");
    markdown.match_indices(&link).any(|(at, _)| {
        !markdown[at + link.len()..]
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
impl Store {
    /// Notes outside Trash that mention a task, newest first. Mentions are found from note
    /// bodies on request, so they stay correct however a note changed (edit, folder refresh,
    /// sync) without a separate index.
    pub fn task_mentions(&self, task_id: &str) -> Result<Vec<String>> {
        if !valid_record_id(task_id) {
            return Err("Invalid task ID.".into());
        }
        // IDs contain only [A-Za-z0-9_-], so they need no LIKE escaping beyond `_`.
        let pattern = format!("%{}%", task_id.replace('_', "\\_"));
        let mut stmt = self
            .conn
            .prepare(
                "SELECT n.id,n.body,l.markdown FROM notes n LEFT JOIN linked_notes l ON l.note_id=n.id
                 WHERE n.trashed_at IS NULL AND (n.body LIKE ?1 ESCAPE '\\' OR l.markdown LIKE ?1 ESCAPE '\\')
                 ORDER BY n.updated DESC",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map([&pattern], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?))
            })
            .map_err(db_err)?;
        let mut ids = Vec::new();
        for row in rows {
            let (id, body, markdown) = row.map_err(db_err)?;
            let found = match markdown {
                Some(markdown) => markdown_mentions(&markdown, task_id),
                None => serde_json::from_str::<Value>(&body)
                    .map(|doc| document_mentions(&doc, task_id))
                    .unwrap_or(false),
            };
            if found {
                ids.push(id);
            }
        }
        Ok(ids)
    }
}
