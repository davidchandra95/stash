//! Folder conversion never writes to the source tree. The prepared snapshot is
//! owned by the storage worker, rather than trusting revisions supplied by the UI.
use super::*;
use linked::scoped;
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preparation {
    pub token: String,
    pub library: Library,
    pub notes: Vec<Note>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub content: Value,
    pub text: String,
}
pub struct Snapshot {
    token: String,
    root_id: String,
    library: String,
    inventory: BTreeMap<String, String>,
    files: BTreeMap<PathBuf, String>,
    notes: HashSet<String>,
}

fn read(path: &Path) -> Result<Vec<u8>> {
    file_io::read(path).map_err(|e| format!("{}: {e}", path.display()))
}
fn inventory(root: &Path) -> Result<BTreeMap<String, String>> {
    fn visit(
        root: &Path,
        dir: &Path,
        depth: usize,
        out: &mut BTreeMap<String, String>,
    ) -> Result<()> {
        if depth > 128 {
            return Err("The folder tree is too deeply nested.".into());
        }
        for entry in fs::read_dir(dir).map_err(db_err)? {
            let entry = entry.map_err(db_err)?;
            let name = entry.file_name();
            if name == ".git" || name.to_string_lossy().starts_with(".stash-") {
                continue;
            }
            let path = entry.path();
            let rel = path
                .strip_prefix(root)
                .map_err(db_err)?
                .to_str()
                .ok_or("Non-Unicode folder path")?
                .to_owned();
            let meta = fs::symlink_metadata(&path).map_err(db_err)?;
            if meta.is_dir() {
                out.insert(rel, "directory".into());
                visit(root, &path, depth + 1, out)?;
            } else {
                out.insert(
                    rel,
                    format!(
                        "{:?}:{}:{:?}",
                        meta.file_type(),
                        meta.len(),
                        meta.modified().map_err(db_err)?
                    ),
                );
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    visit(root, root, 0, &mut out)?;
    Ok(out)
}

impl Store {
    pub fn prepare_conversion(&mut self, id: &str) -> Result<Preparation> {
        self.conn
            .execute_batch("SAVEPOINT prepare_conversion")
            .map_err(db_err)?;
        match self.prepare_conversion_inner(id) {
            Ok(result) => {
                self.conn
                    .execute_batch("RELEASE prepare_conversion")
                    .map_err(db_err)?;
                Ok(result)
            }
            Err(error) => {
                self.conversion = None;
                self.conn
                    .execute_batch("ROLLBACK TO prepare_conversion; RELEASE prepare_conversion")
                    .map_err(db_err)?;
                Err(error)
            }
        }
    }
    fn prepare_conversion_inner(&mut self, id: &str) -> Result<Preparation> {
        self.conversion = None;
        let book = self
            .notebooks()?
            .into_iter()
            .find(|b| b.id == id)
            .ok_or("Notebook no longer exists.")?;
        let root_id = book.root_id.ok_or("This notebook is already native.")?;
        if book.relative_path.as_deref() != Some("") {
            return Err("Convert the whole imported notebook from its root notebook.".into());
        }
        let conflicts: bool = self
            .conn
            .query_row("SELECT EXISTS(SELECT 1 FROM file_conflicts)", [], |r| {
                r.get(0)
            })
            .map_err(db_err)?;
        if conflicts {
            return Err("Resolve pending file conflicts before converting.".into());
        }
        let pending: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM file_operations WHERE state IN ('prepared','applied'))", [], |r| r.get(0)).map_err(db_err)?;
        if pending {
            return Err(
                "Finish pending file operations before converting. Reopen Stash to recover them."
                    .into(),
            );
        }
        let root = self.root_path(&root_id)?;
        let before = inventory(&root)?;
        self.refresh_root(&root_id)?;
        if let Some(error) = self
            .roots()?
            .into_iter()
            .find(|r| r.id == root_id)
            .and_then(|r| r.error)
        {
            return Err(error);
        }
        let library = self.library()?;
        let mut notes = vec![];
        let mut files = BTreeMap::new();
        for summary in &library.notes {
            if !summary
                .source
                .as_ref()
                .is_some_and(|s| s.root_id == root_id)
            {
                continue;
            }
            let mut note = self.note(&summary.id, true)?;
            let source = note.source.as_mut().unwrap();
            let path = if let Some(trash) = &source.trash_path {
                let trash_root = self.path.parent().unwrap().join("file-trash");
                let rel = Path::new(trash).strip_prefix(&trash_root).map_err(db_err)?;
                scoped(&trash_root, rel.to_str().ok_or("Invalid trash path")?)?
            } else {
                scoped(&root, &source.relative_path)?
            };
            let bytes = read(&path)?;
            let fingerprint = file_io::hash(&bytes);
            let markdown = String::from_utf8(bytes)
                .map_err(|_| format!("{} is not UTF-8 Markdown.", path.display()))?;
            if fingerprint != source.fingerprint {
                return Err(format!(
                    "{} changed. Refresh the folder and retry.",
                    path.display()
                ));
            }
            files.insert(path, fingerprint);
            source.markdown = Some(markdown);
            source.unavailable = None;
            notes.push(note);
        }
        if before != inventory(&root)? {
            return Err("The folder changed while preparing conversion. Retry.".into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        self.conversion = Some(Snapshot {
            token: token.clone(),
            root_id,
            library: serde_json::to_string(&library).map_err(db_err)?,
            inventory: before,
            files,
            notes: notes.iter().map(|n| n.id.clone()).collect(),
        });
        Ok(Preparation {
            token,
            library,
            notes,
        })
    }

    pub fn conversion_image(&mut self, token: &str, id: &str, href: &str) -> Result<String> {
        let snapshot = self
            .conversion
            .as_ref()
            .filter(|s| s.token == token && s.notes.contains(id))
            .ok_or("Conversion expired. Retry.")?;
        let root = self.root_path(&snapshot.root_id)?;
        let source = self
            .file_source(id, false)?
            .ok_or("Note is no longer linked.")?;
        let base = reqwest::Url::from_file_path(root.join(&source.relative_path))
            .map_err(|_| "Invalid file path")?;
        let url = base.join(href).map_err(db_err)?;
        let absolute = url.to_file_path().map_err(|_| "Invalid local image path")?;
        let relative = absolute
            .strip_prefix(&root)
            .map_err(|_| format!("{href}: image is outside the linked folder."))?;
        let path = scoped(&root, relative.to_str().ok_or("Invalid image path")?)?;
        let bytes = read(&path)?;
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
            "bmp" => "image/bmp",
            "svg" => "image/svg+xml",
            _ => return Err(format!("{href}: unsupported local image.")),
        };
        use base64::Engine;
        let result = format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let hash = file_io::hash(&bytes);
        let files = &mut self.conversion.as_mut().unwrap().files;
        if files.get(&path).is_some_and(|previous| previous != &hash) {
            return Err(format!("{href}: image changed during conversion. Retry."));
        }
        files.insert(path, hash);
        Ok(result)
    }

    pub fn commit_conversion(&mut self, token: &str, documents: Vec<Document>) -> Result<Library> {
        let snapshot = self
            .conversion
            .as_ref()
            .filter(|s| s.token == token)
            .ok_or("Conversion expired. Reload the library and retry.")?;
        if serde_json::to_string(&self.library()?).map_err(db_err)? != snapshot.library {
            return Err("The library changed during conversion. Retry.".into());
        }
        let root = self.root_path(&snapshot.root_id)?;
        let current_inventory = inventory(&root)?;
        if current_inventory != snapshot.inventory {
            let changed = current_inventory
                .keys()
                .chain(snapshot.inventory.keys())
                .find(|key| current_inventory.get(*key) != snapshot.inventory.get(*key))
                .map(String::as_str)
                .unwrap_or("folder");
            return Err(format!(
                "{changed}: the folder changed during conversion. Retry."
            ));
        }
        for (path, hash) in &snapshot.files {
            if file_io::hash(&read(path)?) != *hash {
                return Err(format!(
                    "{} changed during conversion. Retry.",
                    path.display()
                ));
            }
        }
        let ids: HashSet<_> = documents.iter().map(|d| d.id.clone()).collect();
        if ids != snapshot.notes || ids.len() != documents.len() {
            return Err("Conversion must include every note exactly once.".into());
        }
        for doc in &documents {
            validate_document(&doc.content)?;
            validate_native(&doc.content)?;
        }
        let root_id = snapshot.root_id.clone();
        let tx = self.conn.transaction().map_err(db_err)?;
        for doc in documents {
            tx.execute("UPDATE notes SET body=?,plain_text=?,has_tasks=?,revision=revision+1,last_op=? WHERE id=?", params![doc.content.to_string(),doc.text,has_tasks(&doc.content),token,doc.id]).map_err(db_err)?;
        }
        tx.execute(
            "UPDATE notebooks SET root_id=NULL,relative_path=NULL,manual=1 WHERE root_id=?",
            [&root_id],
        )
        .map_err(db_err)?;
        tx.execute("DELETE FROM linked_notes WHERE root_id=?", [&root_id])
            .map_err(db_err)?;
        tx.execute("DELETE FROM linked_roots WHERE id=?", [&root_id])
            .map_err(db_err)?;
        tx.execute("UPDATE preferences SET revision=revision+1 WHERE id=1", [])
            .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        self.conversion = None;
        let mut library = self.library()?;
        for note in &mut library.notes {
            if ids.contains(&note.id) {
                *note = self.note(&note.id, true)?;
            }
        }
        Ok(library)
    }
}

fn validate_native(node: &Value) -> Result<()> {
    let kind = node["type"].as_str().unwrap_or("");
    if !matches!(
        kind,
        "doc"
            | "text"
            | "paragraph"
            | "heading"
            | "blockquote"
            | "codeBlock"
            | "horizontalRule"
            | "hardBreak"
            | "mixedList"
            | "mixedListItem"
            | "table"
            | "tableRow"
            | "tableHeader"
            | "tableCell"
            | "image"
            | "noteReference"
    ) {
        return Err(format!("Unsupported converted content: {kind}"));
    }
    let children = node["content"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let is_inline = |kind: &str| matches!(kind, "text" | "image" | "hardBreak" | "noteReference");
    let is_block = |kind: &str| {
        matches!(
            kind,
            "paragraph"
                | "heading"
                | "blockquote"
                | "codeBlock"
                | "horizontalRule"
                | "mixedList"
                | "table"
        )
    };
    let shape_valid = match kind {
        "doc" | "blockquote" | "tableCell" | "tableHeader" => {
            !children.is_empty()
                && children
                    .iter()
                    .all(|c| is_block(c["type"].as_str().unwrap_or("")))
        }
        "paragraph" | "heading" => children
            .iter()
            .all(|c| is_inline(c["type"].as_str().unwrap_or(""))),
        "codeBlock" => children
            .iter()
            .all(|c| c["type"] == "text" && c["marks"].as_array().is_none_or(Vec::is_empty)),
        "mixedList" => {
            !children.is_empty() && children.iter().all(|c| c["type"] == "mixedListItem")
        }
        "mixedListItem" => {
            children.first().is_some_and(|c| c["type"] == "paragraph")
                && children
                    .iter()
                    .all(|c| is_block(c["type"].as_str().unwrap_or("")))
        }
        "table" => !children.is_empty() && children.iter().all(|c| c["type"] == "tableRow"),
        "tableRow" => {
            !children.is_empty()
                && children
                    .iter()
                    .all(|c| matches!(c["type"].as_str(), Some("tableCell" | "tableHeader")))
        }
        "text" => children.is_empty() && node["text"].as_str().is_some_and(|text| !text.is_empty()),
        _ => children.is_empty(),
    };
    if !shape_valid {
        return Err(format!("Invalid converted {kind} content."));
    }
    if kind == "heading"
        && !node["attrs"]["level"]
            .as_u64()
            .is_some_and(|level| (1..=6).contains(&level))
    {
        return Err("Invalid converted heading level.".into());
    }
    if let Some(marks) = node.get("marks") {
        for mark in marks.as_array().ok_or("Invalid converted marks.")? {
            if !matches!(
                mark["type"].as_str(),
                Some("bold" | "italic" | "strike" | "code" | "link")
            ) {
                return Err("Unsupported converted text formatting.".into());
            }
            if mark["type"] == "link" && !mark["attrs"]["href"].is_string() {
                return Err("Invalid converted link.".into());
            }
        }
    }
    if kind == "image" {
        let src = node["attrs"]["src"].as_str().unwrap_or("");
        if !src.starts_with("data:image/")
            && !src.starts_with("https://")
            && !src.starts_with("http://")
        {
            return Err("A converted image still depends on a local file.".into());
        }
    }
    if let Some(children) = node["content"].as_array() {
        for child in children {
            validate_native(child)?;
        }
    }
    Ok(())
}
