use super::file_io::{self, Change};
use super::*;
use base64::Engine;
use std::collections::{HashMap, HashSet};
use std::path::Component;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub id: String,
    pub path: String,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSource {
    pub root_id: String,
    pub relative_path: String,
    pub fingerprint: String,
    pub unavailable: Option<String>,
    pub trash_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileRecord {
    pub note_id: String,
    pub root_id: String,
    pub relative_path: String,
    pub markdown: String,
    pub fingerprint: String,
    pub trash_path: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Operation {
    pub id: String,
    #[serde(default)]
    pub notebook: Option<Notebook>,
    #[serde(default)]
    pub directory: Option<file_io::DirectoryChange>,
    pub changes: Vec<Change>,
    pub note: Option<SaveNote>,
    pub records: Vec<FileRecord>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub path: String,
    pub files: usize,
    pub folders: usize,
}
#[derive(Debug, Serialize)]
pub struct PendingConflict {
    pub draft: SaveNote,
    pub error: String,
}
struct Scanned {
    path: String,
    text: String,
    identity: String,
}
pub fn clean_relative(path: &Path) -> Result<PathBuf> {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(s) => result.push(s),
            Component::CurDir => (),
            Component::ParentDir => {
                if !result.pop() {
                    return Err("The path is outside the linked folder.".into());
                }
            }
            _ => return Err("An absolute path is not allowed here.".into()),
        }
    }
    Ok(result)
}
pub fn scoped(root: &Path, relative: &str) -> Result<PathBuf> {
    if fs::symlink_metadata(root)
        .map_err(db_err)?
        .file_type()
        .is_symlink()
    {
        return Err("Symbolic links are not followed in linked notebooks.".into());
    }
    let relative = clean_relative(Path::new(relative))?;
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err("Symbolic links are not followed in linked notebooks.".into())
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(db_err(e)),
        }
    }
    Ok(path)
}
fn utf8(path: &Path) -> Result<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or("This path is not valid Unicode.".into())
}
fn scan_files(root: &Path) -> Result<Vec<Scanned>> {
    fn visit(root: &Path, dir: &Path, depth: usize, out: &mut Vec<Scanned>) -> Result<()> {
        if depth > 128 {
            return Err("The folder tree is too deeply nested.".into());
        }
        let mut entries = fs::read_dir(dir)
            .map_err(db_err)?
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(db_err)?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let kind = entry.file_type().map_err(db_err)?;
            if kind.is_symlink()
                || entry.file_name() == ".git"
                || entry.file_name().to_string_lossy().starts_with(".stash-")
            {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                visit(root, &path, depth + 1, out)?;
            } else if kind.is_file()
                && path
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("md"))
            {
                out.push(Scanned {
                    path: utf8(path.strip_prefix(root).map_err(db_err)?)?,
                    text: String::from_utf8(file_io::read(&path)?)
                        .map_err(|_| format!("{} is not UTF-8 Markdown.", path.display()))?,
                    identity: file_io::identity(&path)?,
                });
            }
        }
        Ok(())
    }
    let mut result = vec![];
    visit(root, root, 0, &mut result)?;
    Ok(result)
}
pub fn scan(path: &str) -> Result<Scan> {
    let path = fs::canonicalize(path).map_err(db_err)?;
    let files = scan_files(&path)?;
    let mut dirs = HashSet::new();
    for file in &files {
        for p in Path::new(&file.path).ancestors().skip(1) {
            dirs.insert(p.to_path_buf());
        }
    }
    Ok(Scan {
        path: utf8(&path)?,
        files: files.len(),
        folders: dirs.len().saturating_sub(1),
    })
}
fn filename(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == ':' || c == '\\')
    {
        return Err("Use a name without slashes, colons, or control characters.".into());
    }
    if name.len() > 255 {
        return Err("This filename is too long.".into());
    }
    Ok(name.into())
}
fn markdown_name(name: &str) -> Result<String> {
    Ok(format!(
        "{}.md",
        filename(if name.trim().is_empty() {
            "Untitled"
        } else {
            name
        })?
    ))
}
fn unused(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let ext = path
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    for n in 2.. {
        let next = path.with_file_name(format!("{stem} {n}{ext}"));
        if !next.exists() {
            return next;
        }
    }
    unreachable!()
}

impl Store {
    pub fn pending_conflicts(&self) -> Result<Vec<PendingConflict>> {
        let rows: Vec<(String, String)> = self
            .conn
            .prepare("SELECT draft,error FROM file_conflicts")
            .map_err(db_err)?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(db_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        rows.into_iter()
            .map(|(draft, error)| {
                Ok(PendingConflict {
                    draft: serde_json::from_str(&draft).map_err(db_err)?,
                    error,
                })
            })
            .collect()
    }
    pub fn roots(&self) -> Result<Vec<Root>> {
        self.conn
            .prepare("SELECT id,path,error FROM linked_roots ORDER BY rowid")
            .map_err(db_err)?
            .query_map([], |r| {
                Ok(Root {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    error: r.get(2)?,
                })
            })
            .map_err(db_err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_err)
    }
    pub fn root_path(&self, id: &str) -> Result<PathBuf> {
        let path: String = self
            .conn
            .query_row("SELECT path FROM linked_roots WHERE id=?", [id], |r| {
                r.get(0)
            })
            .map_err(db_err)?;
        let path = PathBuf::from(path);
        if !path.is_dir() {
            return Err("The linked folder is unavailable. Locate it again or retry.".into());
        }
        if fs::canonicalize(&path).map_err(db_err)? != path {
            return Err(
                "The linked folder has changed into a symbolic link. Locate it again.".into(),
            );
        }
        Ok(path)
    }
    pub fn file_source(&self, id: &str, body: bool) -> Result<Option<FileSource>> {
        self.conn.query_row("SELECT root_id,relative_path,fingerprint,unavailable,trash_path,markdown FROM linked_notes WHERE note_id=?", [id], |r| {
            Ok(FileSource { root_id:r.get(0)?,relative_path:r.get(1)?,fingerprint:r.get(2)?,unavailable:r.get(3)?,trash_path:r.get(4)?,markdown:if body {Some(r.get(5)?)}else{None} })
        }).optional().map_err(db_err)
    }
    pub fn validate_notebooks(&self, books: &[Notebook]) -> Result<()> {
        let mut parents: HashMap<String, Option<String>> = self
            .notebooks()?
            .into_iter()
            .map(|b| (b.id, b.parent_id))
            .collect();
        for book in books {
            if !valid_notebook_icon(&book.icon) {
                return Err("That notebook icon is not supported.".into());
            }
            if let Some(parent) = &book.parent_id {
                if !books.iter().any(|b| &b.id == parent) && !parents.contains_key(parent) {
                    return Err("The parent notebook no longer exists.".into());
                }
            }
            if !parents.contains_key(&book.id)
                && (book.root_id.is_some()
                    || book
                        .parent_id
                        .as_ref()
                        .is_some_and(|id| books.iter().any(|b| &b.id == id && b.root_id.is_some())))
            {
                return Err("Create linked sub-notebooks through the folder command.".into());
            }
            parents.insert(book.id.clone(), book.parent_id.clone());
        }
        for id in parents.keys() {
            let mut seen = HashSet::new();
            let mut next = Some(id);
            while let Some(current) = next {
                if !seen.insert(current) {
                    return Err("A notebook cannot contain itself.".into());
                }
                next = parents.get(current).and_then(Option::as_ref);
            }
        }
        Ok(())
    }
    pub fn link_folder(
        &mut self,
        path: &str,
        name: &str,
        parent: Option<String>,
    ) -> Result<Library> {
        if name.trim().is_empty() {
            return Err("A notebook name is required.".into());
        }
        let path = fs::canonicalize(path).map_err(db_err)?;
        for root in self.roots()? {
            let other = Path::new(&root.path);
            if path.starts_with(other) || other.starts_with(&path) {
                return Err("This folder overlaps an existing linked notebook.".into());
            }
        }
        if parent.as_ref().is_some_and(|id| {
            self.notebooks()
                .is_ok_and(|l| l.iter().any(|b| &b.id == id && b.root_id.is_some()))
        }) {
            return Err("Create a subfolder inside this linked notebook instead.".into());
        }
        let files = scan_files(&path)?;
        let id = uuid::Uuid::new_v4().to_string();
        self.conn
            .execute_batch("SAVEPOINT link_folder")
            .map_err(db_err)?;
        let result = (|| {
            self.conn
                .execute(
                    "INSERT INTO linked_roots(id,path) VALUES(?,?)",
                    params![id, utf8(&path)?],
                )
                .map_err(db_err)?;
            self.conn.execute("INSERT INTO notebooks(id,name,color,parent_id,root_id,relative_path) VALUES(?,?,'#82936f',?,?, '')", params![id,name.trim(),parent,id]).map_err(db_err)?;
            self.index_files(&id, files)
        })();
        match result {
            Ok(()) => self
                .conn
                .execute_batch("RELEASE link_folder")
                .map_err(db_err)?,
            Err(e) => {
                self.conn
                    .execute_batch("ROLLBACK TO link_folder; RELEASE link_folder")
                    .map_err(db_err)?;
                return Err(e);
            }
        }
        self.library()
    }
    fn index_files(&mut self, root: &str, files: Vec<Scanned>) -> Result<()> {
        let mut books: HashMap<String, String> = self
            .notebooks()?
            .into_iter()
            .filter(|b| b.root_id.as_deref() == Some(root))
            .map(|b| (b.relative_path.unwrap_or_default(), b.id))
            .collect();
        let existing: Vec<(String,String,String)> = self.conn.prepare("SELECT note_id,relative_path,identity FROM linked_notes WHERE root_id=? AND trash_path IS NULL").map_err(db_err)?
            .query_map([root],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(db_err)?.collect::<std::result::Result<_,_>>().map_err(db_err)?;
        let paths: HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
        let mut found = HashSet::new();
        for file in &files {
            let parent = Path::new(&file.path).parent().unwrap_or(Path::new(""));
            let mut ancestors: Vec<_> = parent.ancestors().collect();
            ancestors.reverse();
            for ancestor in ancestors {
                let rel = utf8(ancestor)?;
                if books.contains_key(&rel) {
                    continue;
                }
                let parent_id = books
                    .get(&utf8(ancestor.parent().unwrap_or(Path::new("")))?)
                    .ok_or("Missing parent notebook")?;
                let id = uuid::Uuid::new_v4().to_string();
                self.conn.execute("INSERT INTO notebooks(id,name,color,parent_id,root_id,relative_path,manual) VALUES(?,?,'#82936f',?,?,?,0)",params![id,ancestor.file_name().unwrap_or_default().to_string_lossy(),parent_id,root,rel]).map_err(db_err)?;
                books.insert(rel, id);
            }
            let exact = existing.iter().find(|(_, p, _)| p == &file.path);
            let moved: Vec<_> = existing
                .iter()
                .filter(|(id, p, identity)| {
                    identity == &file.identity && !paths.contains(p.as_str()) && !found.contains(id)
                })
                .collect();
            let id = exact
                .or_else(|| {
                    if moved.len() == 1
                        && files
                            .iter()
                            .filter(|candidate| candidate.identity == file.identity)
                            .count()
                            == 1
                    {
                        Some(moved[0])
                    } else {
                        None
                    }
                })
                .map(|(id, _, _)| id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            found.insert(id.clone());
            let title = Path::new(&file.path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let fingerprint = file_io::hash(file.text.as_bytes());
            let previous = self.file_source(&id, false)?;
            if previous.is_none() {
                self.conn.execute("INSERT INTO notes(id,title,body,plain_text,has_tasks,created,updated,revision,last_op) VALUES(?,?,?, ?,?, ?,?,1,'import')",params![id,title,r#"{"type":"doc","content":[{"type":"paragraph"}]}"#,file.text,file.text.contains("- ["),now(),now()]).map_err(db_err)?;
            } else if previous
                .as_ref()
                .is_some_and(|s| s.fingerprint != fingerprint || s.relative_path != file.path)
            {
                self.conn.execute("UPDATE notes SET title=?,plain_text=?,has_tasks=?,updated=?,revision=revision+1 WHERE id=?",params![title,file.text,file.text.contains("- ["),now(),id]).map_err(db_err)?;
            }
            self.conn.execute("DELETE FROM note_notebooks WHERE note_id=? AND notebook_id IN (SELECT id FROM notebooks WHERE root_id IS NOT NULL)",[&id]).map_err(db_err)?;
            self.conn
                .execute(
                    "INSERT INTO note_notebooks VALUES(?,?)",
                    params![id, books[&utf8(parent)?]],
                )
                .map_err(db_err)?;
            self.conn.execute("INSERT INTO linked_notes(note_id,root_id,relative_path,fingerprint,markdown,identity) VALUES(?,?,?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET relative_path=excluded.relative_path,fingerprint=excluded.fingerprint,markdown=excluded.markdown,identity=excluded.identity,unavailable=NULL",params![id,root,file.path,fingerprint,file.text,file.identity]).map_err(db_err)?;
            if previous.is_none() || self.tags_migrated(&id)? {
                self.replace_body_tags(&id, &body_tags(&file.text))?;
                self.mark_tags_migrated(&id)?;
            }
        }
        for (id, _, _) in existing {
            if !found.contains(&id) {
                self.conn.execute("UPDATE linked_notes SET unavailable='The Markdown file is missing. Retry after restoring it on disk.' WHERE note_id=?",[id]).map_err(db_err)?;
            }
        }
        self.conn
            .execute("UPDATE linked_roots SET error=NULL WHERE id=?", [root])
            .map_err(db_err)?;
        Ok(())
    }
    pub fn refresh_root(&mut self, id: &str) -> Result<()> {
        let result = self.root_path(id).and_then(|p| scan_files(&p));
        let files = match result {
            Ok(files) => files,
            Err(error) => {
                self.conn
                    .execute(
                        "UPDATE linked_roots SET error=? WHERE id=?",
                        params![error, id],
                    )
                    .map_err(db_err)?;
                self.conn.execute("UPDATE linked_notes SET unavailable=? WHERE root_id=? AND trash_path IS NULL",params![error,id]).map_err(db_err)?;
                return Ok(());
            }
        };
        self.conn
            .execute_batch("SAVEPOINT refresh_root")
            .map_err(db_err)?;
        match self.index_files(id, files) {
            Ok(()) => self
                .conn
                .execute_batch("RELEASE refresh_root")
                .map_err(db_err)?,
            Err(e) => {
                self.conn
                    .execute_batch("ROLLBACK TO refresh_root; RELEASE refresh_root")
                    .map_err(db_err)?;
                return Err(e);
            }
        }
        Ok(())
    }
    pub fn open_linked_library(&mut self) -> Result<Library> {
        self.recover_operations()?;
        for root in self.roots()? {
            self.refresh_root(&root.id)?;
        }
        self.migrate_linked_tags()?;
        self.library()
    }

    fn migrate_linked_tags(&mut self) -> Result<()> {
        let ids: Vec<String> = self
            .conn
            .prepare(
                "SELECT note_id FROM linked_notes WHERE note_id NOT IN(SELECT note_id FROM tag_body_migrations)",
            )
            .map_err(db_err)?
            .query_map([], |row| row.get(0))
            .map_err(db_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        for id in ids {
            let note = self.load_note(&id)?;
            let Some(source) = note.source.as_ref() else {
                continue;
            };
            if source.unavailable.is_some() || source.trash_path.is_some() {
                continue;
            }
            let Some(markdown) = source.markdown.as_deref() else {
                continue;
            };
            let tags = body_tags(markdown);
            let missing: Vec<String> = self
                .stored_tags(&id)?
                .iter()
                .filter_map(|tag| legacy_tag_name(tag))
                .filter(|tag| !tags.contains(tag))
                .collect();
            if missing.is_empty() {
                self.replace_body_tags(&id, &tags)?;
                self.mark_tags_migrated(&id)?;
                continue;
            }
            let next_markdown = append_markdown_tag_footer(markdown, &missing);
            let input = SaveNote {
                id: note.id.clone(),
                title: note.title.clone(),
                notebook_ids: note.notebook_ids.clone(),
                quick_access: note.quick_access,
                tags: vec![],
                content: None,
                text: next_markdown.clone(),
                pinned: note.pinned,
                trashed: note.trashed,
                markdown: Some(next_markdown),
                expected_fingerprint: Some(source.fingerprint.clone()),
                expected_revision: note.revision,
                operation_id: format!("tag-body-migration-{}", note.id),
            };
            match self.save_note(&input) {
                Ok(_) => self.mark_tags_migrated(&id)?,
                Err(error) => {
                    self.conn.execute("INSERT INTO file_conflicts VALUES(?,?,?) ON CONFLICT(note_id) DO UPDATE SET draft=excluded.draft,error=excluded.error",params![id,serde_json::to_string(&input).map_err(db_err)?,format!("FILE_CONFLICT: Tags still need to be added to this Markdown file. {error}")]).map_err(db_err)?;
                }
            }
        }
        Ok(())
    }
    pub fn load_note(&mut self, id: &str) -> Result<Note> {
        if let Some(source) = self.file_source(id, true)? {
            if source.trash_path.is_none() {
                let result = self
                    .root_path(&source.root_id)
                    .and_then(|root| scoped(&root, &source.relative_path))
                    .and_then(|p| file_io::read(&p));
                match result {
                    Ok(bytes) => {
                        let text = match String::from_utf8(bytes) {
                            Ok(text) => text,
                            Err(_) => {
                                self.conn.execute("UPDATE linked_notes SET unavailable='The file is no longer UTF-8 Markdown.' WHERE note_id=?",[id]).map_err(db_err)?;
                                return self.note(id, true);
                            }
                        };
                        let fingerprint = file_io::hash(text.as_bytes());
                        if fingerprint != source.fingerprint {
                            self.conn.execute("UPDATE linked_notes SET markdown=?,fingerprint=?,unavailable=NULL WHERE note_id=?",params![text,fingerprint,id]).map_err(db_err)?;
                            self.conn.execute("UPDATE notes SET plain_text=?,has_tasks=?,updated=?,revision=revision+1 WHERE id=?",params![text,text.contains("- ["),now(),id]).map_err(db_err)?;
                            if self.tags_migrated(id)? {
                                self.replace_body_tags(id, &body_tags(&text))?;
                            }
                        } else {
                            self.conn
                                .execute(
                                    "UPDATE linked_notes SET unavailable=NULL WHERE note_id=?",
                                    [id],
                                )
                                .map_err(db_err)?;
                        }
                    }
                    Err(error) => {
                        self.conn
                            .execute(
                                "UPDATE linked_notes SET unavailable=? WHERE note_id=?",
                                params![error, id],
                            )
                            .map_err(db_err)?;
                    }
                }
            }
        }
        self.note(id, true)
    }
    pub fn reselect_root(&mut self, id: &str, path: &str) -> Result<Library> {
        let path = fs::canonicalize(path).map_err(db_err)?;
        scan_files(&path)?;
        for root in self.roots()? {
            if root.id != id
                && (path.starts_with(&root.path) || Path::new(&root.path).starts_with(&path))
            {
                return Err("This folder overlaps another linked notebook.".into());
            }
        }
        self.conn
            .execute(
                "UPDATE linked_roots SET path=? WHERE id=?",
                params![utf8(&path)?, id],
            )
            .map_err(db_err)?;
        self.refresh_root(id)?;
        self.library()
    }
    pub fn create_child(&mut self, parent: &str, name: &str) -> Result<Library> {
        let book = self
            .notebooks()?
            .into_iter()
            .find(|b| b.id == parent)
            .ok_or("Parent notebook not found")?;
        let name = filename(name)?;
        let id = uuid::Uuid::new_v4().to_string();
        let rel = book
            .relative_path
            .as_ref()
            .map(|p| Path::new(p).join(&name));
        let directory = if let Some(root) = &book.root_id {
            let path = scoped(&self.root_path(root)?, &utf8(rel.as_ref().unwrap())?)?;
            Some(file_io::DirectoryChange::stage(path, &id)?)
        } else {
            None
        };
        let notebook = Notebook {
            id: id.clone(),
            name,
            color: "#82936f".into(),
            icon: default_notebook_icon(),
            parent_id: Some(parent.into()),
            root_id: book.root_id,
            relative_path: rel.as_ref().map(|p| utf8(p)).transpose()?,
        };
        self.execute_operation(&Operation {
            id,
            notebook: Some(notebook),
            directory,
            changes: vec![],
            note: None,
            records: vec![],
        })?;
        self.library()
    }
    pub fn save_note(&mut self, input: &SaveNote) -> Result<Saved> {
        let pending:Option<String>=self.conn.query_row("SELECT payload FROM file_operations WHERE id=? AND state IN ('prepared','applied')",[&input.operation_id],|r|r.get(0)).optional().map_err(db_err)?;
        if let Some(payload) = pending {
            let op: Operation = serde_json::from_str(&payload).map_err(db_err)?;
            self.resume_operation(&op)?;
            let note = self.note(&input.id, false)?;
            return Ok(Saved {
                revision: note.revision,
                updated: note.updated,
            });
        }

        if let Ok(note) = self.note(&input.id, false) {
            let op: String = self
                .conn
                .query_row("SELECT last_op FROM notes WHERE id=?", [&input.id], |r| {
                    r.get(0)
                })
                .map_err(db_err)?;
            if op == input.operation_id {
                return Ok(Saved {
                    revision: note.revision,
                    updated: note.updated,
                });
            }
            if note.revision != input.expected_revision {
                return Err(if note.source.is_some() {
                    "FILE_CONFLICT: This note changed since it was opened."
                } else {
                    "Save conflict: this note has a newer saved version."
                }
                .into());
            }
        }
        let source = self.file_source(&input.id, true)?;
        let books = self.notebooks()?;
        let folders: Vec<_> = books
            .iter()
            .filter(|b| b.root_id.is_some() && input.notebook_ids.contains(&b.id))
            .collect();
        if input
            .notebook_ids
            .iter()
            .any(|id| !books.iter().any(|b| &b.id == id))
        {
            return Err("The destination notebook no longer exists.".into());
        }
        if folders.len() > 1 {
            return Err("A Markdown note can have only one physical folder.".into());
        }
        if source.is_none() && folders.is_empty() {
            return self.save_note_record(input);
        }
        if folders.is_empty() {
            return Err("A linked note must remain in a folder notebook.".into());
        }
        if let Some(content) = &input.content {
            validate_document(content)?;
        }
        let folder = folders[0];
        let root_id = folder.root_id.as_ref().unwrap();
        if let Some(s) = &source {
            let same_folder = s.root_id == *root_id
                && Path::new(&s.relative_path)
                    .parent()
                    .unwrap_or(Path::new(""))
                    == Path::new(folder.relative_path.as_deref().unwrap_or(""));
            if input.markdown.is_none()
                && input.title == self.note(&input.id, false)?.title
                && input.trashed == s.trash_path.is_some()
                && same_folder
            {
                return self.save_note_record(input);
            }
        }
        let root = self.root_path(root_id)?;
        let mut target = scoped(
            &root,
            &utf8(
                &Path::new(folder.relative_path.as_deref().unwrap_or(""))
                    .join(markdown_name(&input.title)?),
            )?,
        )?;
        if let Some(source) = &source {
            let extension = Path::new(&source.relative_path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("md");
            target.set_extension(extension);
        }
        let before = source
            .as_ref()
            .map(|s| s.markdown.clone().unwrap_or_default());
        let mut markdown = input
            .markdown
            .clone()
            .or_else(|| before.clone())
            .ok_or("Markdown content is required for this notebook.")?;
        let mut changes = vec![];
        let mut records = vec![];
        let mut adjusted = input.clone();
        let mut trash_path = None;
        let mut actual_before = None;
        let old_path = if let Some(s) = &source {
            let old = if let Some(trash) = &s.trash_path {
                PathBuf::from(trash)
            } else {
                scoped(&self.root_path(&s.root_id)?, &s.relative_path)?
            };
            let bytes = file_io::read(&old).map_err(|e| format!("FILE_CONFLICT: {e}"))?;
            if input.expected_fingerprint.as_deref() != Some(&file_io::hash(&bytes)) {
                return Err("FILE_CONFLICT: The Markdown file changed outside Stash.".into());
            }
            actual_before = Some(bytes);
            Some(old)
        } else {
            target = unused(target);
            None
        };
        if input.trashed {
            let trash = self.path.parent().unwrap().join("file-trash");
            fs::create_dir_all(&trash).map_err(db_err)?;
            let path = trash.join(format!("{}-{}.md", input.id, uuid::Uuid::new_v4()));
            trash_path = Some(utf8(&path)?);
            target = path;
        }
        if let Some(old) = &old_path {
            if *old != target && target.exists() {
                return Err(
                    "NAME_COLLISION: A file already has this name. Choose another filename.".into(),
                );
            }
            if *old != target
                && !input.trashed
                && source.as_ref().is_some_and(|s| s.trash_path.is_none())
            {
                let patches = self.link_changes(old, &target, &markdown, &input.operation_id)?;
                markdown = patches.0;
                changes.extend(patches.1);
                records.extend(patches.2);
            }
        }
        if old_path.as_ref() == Some(&target) {
            if actual_before.as_deref() != Some(markdown.as_bytes()) {
                changes.push(Change::new(
                    target.clone(),
                    actual_before,
                    Some(markdown.as_bytes().to_vec()),
                    &input.operation_id,
                ));
            }
        } else {
            changes.push(Change::new(
                target.clone(),
                None,
                Some(markdown.as_bytes().to_vec()),
                &input.operation_id,
            ));
            if let Some(old) = old_path {
                changes.push(Change::new(old, actual_before, None, &input.operation_id));
            }
        }
        let relative = if input.trashed {
            source
                .as_ref()
                .ok_or("Save the note before moving it to Trash.")?
                .relative_path
                .clone()
        } else {
            utf8(target.strip_prefix(&root).map_err(db_err)?)?
        };
        if !input.trashed {
            adjusted.title = target
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into();
        }
        adjusted.text = markdown.clone();
        adjusted.markdown = Some(markdown.clone());
        records.push(FileRecord {
            note_id: input.id.clone(),
            root_id: root_id.clone(),
            relative_path: relative,
            markdown: markdown.clone(),
            fingerprint: file_io::hash(markdown.as_bytes()),
            trash_path,
        });
        let op = Operation {
            id: input.operation_id.clone(),
            changes,
            notebook: None,
            directory: None,
            note: Some(adjusted),
            records,
        };
        self.execute_operation(&op)?;
        let note = self.note(&input.id, false)?;
        Ok(Saved {
            revision: note.revision,
            updated: note.updated,
        })
    }
    fn validate_operation_paths(&self, op: &Operation) -> Result<()> {
        let roots = self.roots()?;
        let trash = self.path.parent().unwrap().join("file-trash");
        for path in op
            .changes
            .iter()
            .flat_map(|c| [&c.path, &c.staging])
            .chain(op.directory.iter().flat_map(|c| [&c.path, &c.staging]))
        {
            let root = roots
                .iter()
                .find(|r| path.starts_with(&r.path))
                .map(|r| self.root_path(&r.id))
                .transpose()?
                .or_else(|| path.starts_with(&trash).then(|| trash.clone()))
                .ok_or("The journal path is outside registered folders.")?;
            scoped(&root, &utf8(path.strip_prefix(&root).map_err(db_err)?)?)?;
        }
        Ok(())
    }
    pub fn execute_operation(&mut self, op: &Operation) -> Result<()> {
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT payload FROM file_operations WHERE id=?",
                [&op.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        if let Some(payload) = existing {
            let prior: Operation = serde_json::from_str(&payload).map_err(db_err)?;
            return self.resume_operation(&prior);
        }
        self.validate_operation_paths(op)?;
        for change in &op.changes {
            change.preflight()?;
        }
        self.conn
            .execute(
                "INSERT INTO file_operations VALUES(?,?,'prepared')",
                params![op.id, serde_json::to_string(op).map_err(db_err)?],
            )
            .map_err(db_err)?;
        self.resume_operation(op)
    }
    fn resume_operation(&mut self, op: &Operation) -> Result<()> {
        let state: String = self
            .conn
            .query_row(
                "SELECT state FROM file_operations WHERE id=?",
                [&op.id],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        if state == "committed" {
            return Ok(());
        }
        if state == "abandoned" {
            return Err(
                "FILE_CONFLICT: This operation was cancelled during conflict resolution.".into(),
            );
        }
        self.validate_operation_paths(op)?;
        if let Some(directory) = &op.directory {
            directory.apply()?;
        }
        if state != "applied" {
            for change in &op.changes {
                change.apply()?;
            }
            self.conn
                .execute(
                    "UPDATE file_operations SET state='applied' WHERE id=?",
                    [&op.id],
                )
                .map_err(db_err)?;
        }
        if let Some(note) = &op.note {
            self.save_note_record(note)?;
        }
        let tx = self.conn.transaction().map_err(db_err)?;
        if let Some(book) = &op.notebook {
            tx.execute("INSERT OR IGNORE INTO notebooks(id,name,color,parent_id,root_id,relative_path) VALUES(?,?,?,?,?,?)", params![book.id,book.name,book.color,book.parent_id,book.root_id,book.relative_path]).map_err(db_err)?;
        }
        for r in &op.records {
            let identity = if r.trash_path.is_some() {
                String::new()
            } else {
                let root: String = tx
                    .query_row(
                        "SELECT path FROM linked_roots WHERE id=?",
                        [&r.root_id],
                        |row| row.get(0),
                    )
                    .map_err(db_err)?;
                file_io::identity(&Path::new(&root).join(&r.relative_path)).unwrap_or_default()
            };
            tx.execute("INSERT INTO linked_notes(note_id,root_id,relative_path,markdown,fingerprint,identity,trash_path) VALUES(?,?,?,?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET root_id=excluded.root_id,relative_path=excluded.relative_path,markdown=excluded.markdown,fingerprint=excluded.fingerprint,identity=excluded.identity,trash_path=excluded.trash_path,unavailable=NULL",params![r.note_id,r.root_id,r.relative_path,r.markdown,r.fingerprint,identity,r.trash_path]).map_err(db_err)?;
            if op.note.as_ref().is_none_or(|n| n.id != r.note_id) {
                tx.execute(
                    "UPDATE notes SET plain_text=?,updated=?,revision=revision+1 WHERE id=?",
                    params![r.markdown, now(), r.note_id],
                )
                .map_err(db_err)?;
            }
        }
        tx.execute(
            "UPDATE file_operations SET state='committed' WHERE id=?",
            [&op.id],
        )
        .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        for change in &op.changes {
            change.cleanup();
        }
        // Keep the latest acknowledged operation per note for uncertain-response retries.
        if let Some(note) = &op.note {
            self.conn.execute("DELETE FROM file_operations WHERE state='committed' AND id<>? AND json_extract(payload,'$.note.id')=?",params![op.id,note.id]).map_err(db_err)?;
        }
        Ok(())
    }
    pub fn recover_operations(&mut self) -> Result<()> {
        let payloads:Vec<String>=self.conn.prepare("SELECT payload FROM file_operations WHERE state IN ('prepared','applied') ORDER BY rowid").map_err(db_err)?.query_map([],|r|r.get(0)).map_err(db_err)?.collect::<std::result::Result<_,_>>().map_err(db_err)?;
        for payload in payloads {
            let op: Operation = serde_json::from_str(&payload).map_err(db_err)?;
            if let Err(error) = self.resume_operation(&op) {
                if op.note.is_none() {
                    return Err(format!(
                        "Folder operation recovery needs attention: {error}"
                    ));
                }
                if let Some(note) = &op.note {
                    self.conn.execute("INSERT INTO file_conflicts VALUES(?,?,?) ON CONFLICT(note_id) DO UPDATE SET draft=excluded.draft,error=excluded.error",params![note.id,serde_json::to_string(note).map_err(db_err)?,format!("FILE_CONFLICT: Recovery needs attention: {error}")]).map_err(db_err)?;
                }
                for r in &op.records {
                    self.conn
                        .execute(
                            "UPDATE linked_notes SET unavailable=? WHERE note_id=?",
                            params![format!("Recovery needs attention: {error}"), r.note_id],
                        )
                        .map_err(db_err)?;
                }
            }
        }
        Ok(())
    }
    pub fn abandon_operations(&mut self, id: &str) -> Result<()> {
        let payloads:Vec<String>=self.conn.prepare("SELECT payload FROM file_operations WHERE state='prepared' AND json_extract(payload,'$.note.id')=?").map_err(db_err)?.query_map([id],|r|r.get(0)).map_err(db_err)?.collect::<std::result::Result<_,_>>().map_err(db_err)?;
        for payload in payloads {
            let op: Operation = serde_json::from_str(&payload).map_err(db_err)?;
            self.validate_operation_paths(&op)?;
            // Roll back only our exact bytes. A newer external edit always wins.
            for c in op.changes.iter().rev() {
                let current = if c.path.exists() {
                    Some(file_io::read(&c.path)?)
                } else {
                    None
                };
                if current == c.after {
                    Change::new(
                        c.path.clone(),
                        c.after.clone(),
                        c.before.clone(),
                        &uuid::Uuid::new_v4().to_string(),
                    )
                    .apply()?;
                }
            }
            self.conn
                .execute(
                    "UPDATE file_operations SET state='abandoned' WHERE id=?",
                    [op.id],
                )
                .map_err(db_err)?;
        }
        Ok(())
    }
    pub fn read_asset(&self, id: &str, href: &str) -> Result<String> {
        let source = self
            .file_source(id, false)?
            .ok_or("This is not a linked note")?;
        let root = self.root_path(&source.root_id)?;
        let decoded =
            percent_encoding::percent_decode_str(href.split(['#', '?']).next().unwrap_or(href))
                .decode_utf8()
                .map_err(db_err)?;
        let relative = Path::new(&source.relative_path)
            .parent()
            .unwrap_or(Path::new(""))
            .join(decoded.as_ref());
        let path = scoped(&root, &utf8(&relative)?)?;
        let bytes = file_io::read(&path)?;
        let mime = match path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "svg" => "image/svg+xml",
            _ => return Err("This file is not a supported image.".into()),
        };
        Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }
    pub fn write_asset(&mut self, id: &str, name: &str, data: &str) -> Result<String> {
        let source = self
            .file_source(id, false)?
            .ok_or("Save the linked note before inserting an image.")?;
        if source.trash_path.is_some() || source.unavailable.is_some() {
            return Err("This note is not writable.".into());
        }
        let root = self.root_path(&source.root_id)?;
        let folder = Path::new(&source.relative_path)
            .parent()
            .unwrap_or(Path::new(""))
            .join("assets");
        let folder = scoped(&root, &utf8(&folder)?)?;
        fs::create_dir_all(&folder).map_err(db_err)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(db_err)?;
        let ext = Path::new(name)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        if !["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].contains(&ext.as_str()) {
            return Err("Choose a PNG, JPEG, GIF, WebP, AVIF, or SVG image.".into());
        }
        let filename = format!("{}.{}", file_io::hash(&bytes), ext);
        let path = folder.join(&filename);
        if path.exists() {
            if file_io::read(&path)? != bytes {
                return Err("An image with this name already exists.".into());
            }
        } else {
            self.execute_operation(&Operation {
                id: uuid::Uuid::new_v4().to_string(),
                notebook: None,
                directory: None,
                changes: vec![Change::new(
                    path,
                    None,
                    Some(bytes),
                    &uuid::Uuid::new_v4().to_string(),
                )],
                note: None,
                records: vec![],
            })?;
        }
        Ok(format!("assets/{filename}"))
    }
}
