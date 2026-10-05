//! Managed PDFs are local-only; neither their bytes nor metadata enter note sync.
use super::*;
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom, Write};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingState {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    /// "page", "height", "width", or a numeric PDF.js scale (1 = 100%).
    pub zoom: Value,
}
impl Default for ReadingState {
    fn default() -> Self {
        Self {
            page: 1,
            x: 0.0,
            y: 0.0,
            zoom: Value::String("width".into()),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDocument {
    pub id: String,
    pub name: String,
    pub fingerprint: String,
    pub size: u64,
    pub imported: i64,
    pub unavailable: bool,
    pub reading: ReadingState,
}
impl Store {
    pub fn list_pdf_companions(&self) -> Result<std::collections::BTreeMap<String, String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT document_id,note_id FROM pdf_companions")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(db_err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(db_err)
    }
    pub fn ensure_pdf_companion(&mut self, document_id: &str) -> Result<Note> {
        let tx = self.conn.transaction().map_err(db_err)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT note_id FROM pdf_companions WHERE document_id=?",
                [document_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        let note_id = if let Some(id) = existing {
            id
        } else {
            let (name, fingerprint): (String, String) = tx
                .query_row(
                    "SELECT name,fingerprint FROM pdf_documents WHERE id=?",
                    [document_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|_| "This PDF is no longer available.".to_string())?;
            let id = uuid::Uuid::new_v4().to_string();
            let href = format!("upnote2://pdf/v1/{document_id}?fingerprint={fingerprint}&page=1");
            let content = serde_json::json!({"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":name,"marks":[{"type":"link","attrs":{"href":href}}]}]},
                {"type":"paragraph"}
            ]});
            let title = format!(
                "{} - Notes",
                if name.to_lowercase().ends_with(".pdf") {
                    &name[..name.len() - 4]
                } else {
                    &name
                }
            );
            Self::write_note_record(
                &tx,
                &SaveNote {
                    id: id.clone(),
                    title,
                    notebook_ids: vec![],
                    quick_access: false,
                    tags: vec![],
                    content: Some(content),
                    text: name,
                    pinned: false,
                    trashed: false,
                    markdown: None,
                    expected_fingerprint: None,
                    expected_revision: 0,
                    operation_id: uuid::Uuid::new_v4().to_string(),
                },
            )?;
            tx.execute(
                "INSERT INTO pdf_companions(document_id,note_id) VALUES(?,?)",
                params![document_id, id],
            )
            .map_err(db_err)?;
            id
        };
        tx.commit().map_err(db_err)?;
        self.note(&note_id, true)
    }
    fn pdf_dir(&self) -> PathBuf {
        self.path.parent().unwrap().join("pdfs")
    }
    pub fn recover_pdf_imports(&self) -> Result<()> {
        let dir = self.pdf_dir();
        fs::create_dir_all(&dir).map_err(db_err)?;
        sync_directory(self.path.parent().unwrap())?;
        for entry in fs::read_dir(&dir).map_err(db_err)? {
            let entry = entry.map_err(db_err)?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            // Only remove files owned by our import protocol, never arbitrary files.
            let owned = name
                .strip_suffix(".pdf")
                .or_else(|| name.strip_suffix(".import"));
            if let Some(id) = owned.filter(|id| uuid::Uuid::parse_str(id).is_ok()) {
                let registered: bool = self
                    .conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM pdf_documents WHERE id=?)",
                        [id],
                        |r| r.get(0),
                    )
                    .map_err(db_err)?;
                if !registered || name.ends_with(".import") {
                    fs::remove_file(path).map_err(db_err)?;
                }
            }
        }
        Ok(())
    }
    pub fn list_pdfs(&self) -> Result<Vec<PdfDocument>> {
        let mut stmt = self.conn.prepare("SELECT d.id,d.name,d.fingerprint,d.size,d.imported,r.state FROM pdf_documents d LEFT JOIN pdf_reading r ON r.document_id=d.id ORDER BY d.imported DESC,d.id").map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)? as u64,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(db_err)?;
        rows.map(|row| {
            let (id, name, fingerprint, size, imported, reading) = row.map_err(db_err)?;
            let unavailable = !self.pdf_dir().join(format!("{id}.pdf")).is_file();
            Ok(PdfDocument {
                id,
                name,
                fingerprint,
                size,
                imported,
                unavailable,
                reading: reading
                    .map(|s| serde_json::from_str(&s))
                    .transpose()
                    .map_err(db_err)?
                    .unwrap_or_default(),
            })
        })
        .collect()
    }
    pub fn import_pdf(&mut self, source: &Path) -> Result<PdfDocument> {
        let mut input = File::open(source).map_err(|e| format!("Could not read PDF: {e}"))?;
        if !input.metadata().map_err(db_err)?.is_file() {
            return Err("Choose a PDF file.".into());
        }
        let mut header = [0u8; 1024];
        let n = input.read(&mut header).map_err(db_err)?;
        if !header[..n].windows(5).any(|w| w == b"%PDF-") {
            return Err("This file is not a PDF.".into());
        }
        input.rewind().map_err(db_err)?;
        let id = uuid::Uuid::new_v4().to_string();
        let dir = self.pdf_dir();
        fs::create_dir_all(&dir).map_err(db_err)?;
        let temporary = dir.join(format!("{id}.import"));
        let destination = dir.join(format!("{id}.pdf"));
        let result = (|| {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(db_err)?;
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 128 * 1024];
            let mut size = 0u64;
            loop {
                let n = input.read(&mut buffer).map_err(db_err)?;
                if n == 0 {
                    break;
                }
                output.write_all(&buffer[..n]).map_err(db_err)?;
                hash.update(&buffer[..n]);
                size += n as u64;
            }
            output.sync_all().map_err(db_err)?;
            drop(output);
            let fingerprint = format!("{:x}", hash.finalize());
            if let Some(existing) = self
                .list_pdfs()?
                .into_iter()
                .find(|p| p.fingerprint == fingerprint)
            {
                // A verified identical import can repair missing bytes without changing identity.
                if existing.unavailable {
                    fs::rename(&temporary, dir.join(format!("{}.pdf", existing.id)))
                        .map_err(db_err)?;
                    sync_directory(&dir)?;
                } else {
                    fs::remove_file(&temporary).map_err(db_err)?;
                }
                return Ok(PdfDocument {
                    unavailable: false,
                    ..existing
                });
            }
            fs::rename(&temporary, &destination).map_err(db_err)?;
            sync_directory(&dir)?;
            let name = source
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let imported = now();
            let tx = self.conn.transaction().map_err(db_err)?;
            tx.execute(
                "INSERT INTO pdf_documents(id,name,fingerprint,size,imported) VALUES(?,?,?,?,?)",
                params![
                    id,
                    name,
                    fingerprint,
                    i64::try_from(size).map_err(db_err)?,
                    imported
                ],
            )
            .map_err(db_err)?;
            tx.commit().map_err(db_err)?;
            Ok(PdfDocument {
                id: id.clone(),
                name,
                fingerprint,
                size,
                imported,
                unavailable: false,
                reading: ReadingState::default(),
            })
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
            let _ = fs::remove_file(destination);
        }
        result
    }
    pub fn read_pdf_range(&self, id: &str, begin: u64, end: u64) -> Result<Vec<u8>> {
        let size: u64 = self
            .conn
            .query_row("SELECT size FROM pdf_documents WHERE id=?", [id], |r| {
                r.get::<_, i64>(0).map(|n| n as u64)
            })
            .map_err(|_| "PDF is not in this library.".to_string())?;
        if uuid::Uuid::parse_str(id).is_err()
            || begin >= end
            || end > size
            || end - begin > 1024 * 1024
        {
            return Err("Invalid PDF byte range.".into());
        }
        let mut file = File::open(self.pdf_dir().join(format!("{id}.pdf"))).map_err(|e| {
            format!("The managed PDF is unavailable. Reimport the original PDF to restore it. {e}")
        })?;
        if file.metadata().map_err(db_err)?.len() != size {
            return Err("The managed PDF has changed. Restore its original managed copy.".into());
        }
        file.seek(SeekFrom::Start(begin)).map_err(db_err)?;
        let mut bytes = vec![0; (end - begin) as usize];
        file.read_exact(&mut bytes).map_err(db_err)?;
        Ok(bytes)
    }
    pub fn save_pdf_reading(&self, id: &str, reading: &ReadingState) -> Result<()> {
        if reading.page == 0
            || !reading.x.is_finite()
            || !reading.y.is_finite()
            || !(0.0..=1.0).contains(&reading.x)
            || !(0.0..=1.0).contains(&reading.y)
            || !(matches!(reading.zoom.as_str(), Some("page" | "height" | "width"))
                || reading
                    .zoom
                    .as_f64()
                    .is_some_and(|z| z.is_finite() && (0.25..=5.0).contains(&z)))
        {
            return Err("Invalid PDF reading position.".into());
        }
        self.conn.execute("INSERT INTO pdf_reading(document_id,state) VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET state=excluded.state", params![id,serde_json::to_string(reading).map_err(db_err)?]).map_err(db_err)?;
        Ok(())
    }
}
fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(db_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(dir: &Path, name: &str, content: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        path
    }
    const PDF: &[u8] = b"%PDF-1.7\nfixture bytes\n%%EOF";
    #[test]
    fn reading_fit_modes_round_trip_and_reject_unknown_modes() {
        let library = tempfile::tempdir().unwrap();
        let originals = tempfile::tempdir().unwrap();
        let path = source(originals.path(), "fit.pdf", PDF);
        let mut store = Store::open(library.path()).unwrap();
        let document = store.import_pdf(&path).unwrap();
        for zoom in [serde_json::json!("page"), serde_json::json!("height"), serde_json::json!("width"), serde_json::json!(1), serde_json::json!(0.25), serde_json::json!(5)] {
            let state = ReadingState { zoom, ..ReadingState::default() };
            store.save_pdf_reading(&document.id, &state).unwrap();
            drop(store);
            store = Store::open(library.path()).unwrap();
            assert_eq!(store.list_pdfs().unwrap()[0].reading, state);
        }
        for zoom in [serde_json::json!("unknown"), serde_json::json!(0.24), serde_json::json!(5.01), serde_json::Value::Null] {
            assert!(store.save_pdf_reading(&document.id, &ReadingState { zoom, ..ReadingState::default() }).is_err());
        }
    }

    #[test]
    fn import_is_durable_and_reimport_preserves_identity_and_reading() {
        let library = tempfile::tempdir().unwrap();
        let originals = tempfile::tempdir().unwrap();
        let path = source(originals.path(), "reading.pdf", PDF);
        let mut store = Store::open(library.path()).unwrap();
        let first = store.import_pdf(&path).unwrap();
        let state = ReadingState {
            page: 4,
            x: 0.2,
            y: 0.45,
            zoom: serde_json::json!(1.5),
        };
        store.save_pdf_reading(&first.id, &state).unwrap();
        let second = store.import_pdf(&path).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.reading, state);
        fs::remove_file(path).unwrap();
        drop(store);
        let store = Store::open(library.path()).unwrap();
        let saved = store.list_pdfs().unwrap().remove(0);
        assert_eq!(saved.id, first.id);
        assert_eq!(saved.reading, state);
        assert_eq!(
            store
                .read_pdf_range(&saved.id, 0, PDF.len() as u64)
                .unwrap(),
            PDF
        );
    }
    #[test]
    fn same_name_different_bytes_are_separate_and_missing_import_repairs_verified_copy() {
        let library = tempfile::tempdir().unwrap();
        let originals = tempfile::tempdir().unwrap();
        let mut store = Store::open(library.path()).unwrap();
        let path = source(originals.path(), "reading.pdf", PDF);
        let first = store.import_pdf(&path).unwrap();
        fs::remove_file(store.pdf_dir().join(format!("{}.pdf", first.id))).unwrap();
        assert!(store.list_pdfs().unwrap()[0].unavailable);
        assert!(store
            .read_pdf_range(&first.id, 0, 5)
            .unwrap_err()
            .contains("unavailable"));
        let repaired = store.import_pdf(&path).unwrap();
        assert_eq!(first.id, repaired.id);
        assert!(!repaired.unavailable);
        fs::write(&path, b"%PDF-1.7\ndifferent revision").unwrap();
        let changed = store.import_pdf(&path).unwrap();
        assert_ne!(changed.id, first.id);
        assert_eq!(store.list_pdfs().unwrap().len(), 2);
    }
    #[test]
    fn failed_registration_cleans_bytes_and_startup_cleans_only_abandoned_imports() {
        let library = tempfile::tempdir().unwrap();
        let originals = tempfile::tempdir().unwrap();
        let mut store = Store::open(library.path()).unwrap();
        let path = source(originals.path(), "reading.pdf", PDF);
        store.conn.execute_batch("CREATE TRIGGER reject_pdf BEFORE INSERT ON pdf_documents BEGIN SELECT RAISE(ABORT,'disk failure'); END;").unwrap();
        assert!(store.import_pdf(&path).is_err());
        assert_eq!(fs::read_dir(store.pdf_dir()).unwrap().count(), 0);
        store
            .conn
            .execute_batch("DROP TRIGGER reject_pdf;")
            .unwrap();
        let doc = store.import_pdf(&path).unwrap();
        for extension in ["import", "pdf"] {
            fs::write(
                store
                    .pdf_dir()
                    .join(format!("{}.{}", uuid::Uuid::new_v4(), extension)),
                PDF,
            )
            .unwrap();
        }
        fs::write(store.pdf_dir().join("unrelated.txt"), "preserve").unwrap();
        drop(store);
        let store = Store::open(library.path()).unwrap();
        assert_eq!(fs::read_dir(store.pdf_dir()).unwrap().count(), 2);
        assert_eq!(store.list_pdfs().unwrap()[0].id, doc.id);
    }
    #[test]
    fn rejects_invalid_files_ranges_and_reading_state() {
        let library = tempfile::tempdir().unwrap();
        let originals = tempfile::tempdir().unwrap();
        let mut store = Store::open(library.path()).unwrap();
        assert!(store
            .import_pdf(&source(originals.path(), "bad.pdf", b"not pdf"))
            .is_err());
        assert!(store
            .import_pdf(&originals.path().join("absent.pdf"))
            .is_err());
        let doc = store
            .import_pdf(&source(originals.path(), "ok.pdf", PDF))
            .unwrap();
        for (begin, end) in [(5, 5), (8, 2), (0, 100), (0, 1024 * 1024 + 1)] {
            assert!(store.read_pdf_range(&doc.id, begin, end).is_err());
        }
        assert!(store.read_pdf_range("../../outside", 0, 5).is_err());
        assert!(store
            .save_pdf_reading(
                &doc.id,
                &ReadingState {
                    page: 0,
                    ..ReadingState::default()
                }
            )
            .is_err());
        assert!(store
            .save_pdf_reading(
                &doc.id,
                &ReadingState {
                    x: f64::NAN,
                    ..ReadingState::default()
                }
            )
            .is_err());
        assert!(store
            .save_pdf_reading(
                &doc.id,
                &ReadingState {
                    zoom: serde_json::json!(99),
                    ..ReadingState::default()
                }
            )
            .is_err());
        assert!(store
            .save_pdf_reading("unknown", &ReadingState::default())
            .is_err());
    }
    #[test]
    fn version_seven_upgrade_keeps_library_and_backup() {
        let library = tempfile::tempdir().unwrap();
        let store = Store::open(library.path()).unwrap();
        store
            .conn
            .execute_batch(
                "DROP TABLE pdf_companions; DROP TABLE pdf_reading; DROP TABLE pdf_documents; PRAGMA user_version=7;",
            )
            .unwrap();
        drop(store);
        let store = Store::open(library.path()).unwrap();
        assert_eq!(
            store
                .conn
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            9
        );
        assert!(store.list_pdfs().unwrap().is_empty());
        let backup = fs::read_dir(library.path().join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let db = Connection::open(backup).unwrap();
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            7
        );
    }
    #[test]
    fn legacy_note_and_pdf_workspace_targets_round_trip() {
        let old: WorkspaceTab = serde_json::from_value(
            serde_json::json!({"id":"note-tab","noteId":"note-id","preview":true}),
        )
        .unwrap();
        assert_eq!(old.kind, "note");
        assert_eq!(old.note_id, "note-id");
        let pdf: WorkspaceTab = serde_json::from_value(
            serde_json::json!({"id":"pdf-tab","kind":"pdf","documentId":"document-id"}),
        )
        .unwrap();
        assert_eq!(pdf.kind, "pdf");
        assert!(pdf.note_id.is_empty());
        let json = serde_json::to_value(pdf).unwrap();
        assert!(json.get("noteId").is_none());
        assert_eq!(json["documentId"], "document-id");
    }
}

#[cfg(test)]
mod companion_tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, Store, PdfDocument) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.pdf");
        fs::write(&path, b"%PDF-1.4\nfixture").unwrap();
        let mut store = Store::open(&dir.path().join("library")).unwrap();
        let pdf = store.import_pdf(&path).unwrap();
        (dir, store, pdf)
    }
    #[test]
    fn companion_identity_trash_deletion_and_restart() {
        let (dir, mut store, pdf) = setup();
        let first = store.ensure_pdf_companion(&pdf.id).unwrap();
        assert_eq!(first.title, "source - Notes");
        assert!(first.notebook_ids.is_empty());
        assert!(first
            .content
            .as_ref()
            .unwrap()
            .to_string()
            .contains("upnote2://pdf/v1/"));
        assert_eq!(first.revision, 1);
        assert_eq!(store.ensure_pdf_companion(&pdf.id).unwrap().id, first.id);
        assert_eq!(store.sync_status().unwrap().pending, 1);
        store
            .conn
            .execute(
                "UPDATE notes SET title='Renamed',trashed_at=1 WHERE id=?",
                [&first.id],
            )
            .unwrap();
        let trashed = store.ensure_pdf_companion(&pdf.id).unwrap();
        assert!(trashed.trashed);
        assert_eq!(trashed.title, "Renamed");
        drop(store);
        let mut store = Store::open(&dir.path().join("library")).unwrap();
        assert_eq!(store.ensure_pdf_companion(&pdf.id).unwrap().id, first.id);
        store
            .conn
            .execute("DELETE FROM notes WHERE id=?", [&first.id])
            .unwrap();
        assert!(store.list_pdf_companions().unwrap().is_empty());
        assert_ne!(store.ensure_pdf_companion(&pdf.id).unwrap().id, first.id);
    }
    #[test]
    fn failed_association_rolls_back_note_and_sync_dirty_record() {
        let (_dir, mut store, pdf) = setup();
        store.conn.execute_batch("CREATE TRIGGER fail_pair BEFORE INSERT ON pdf_companions BEGIN SELECT RAISE(ABORT,'full disk'); END;").unwrap();
        assert!(store.ensure_pdf_companion(&pdf.id).is_err());
        assert_eq!(
            store
                .conn
                .query_row("SELECT count(*) FROM notes", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(store.sync_status().unwrap().pending, 0);
        store.conn.execute_batch("DROP TRIGGER fail_pair;").unwrap();
        assert!(store.ensure_pdf_companion(&pdf.id).is_ok());
        assert!(store.ensure_pdf_companion("missing").is_err());
        assert_eq!(store.list_pdf_companions().unwrap().len(), 1);
    }
    #[test]
    fn version_eight_migration_preserves_documents_and_has_backup() {
        let (dir, store, pdf) = setup();
        store
            .conn
            .execute_batch("DROP TABLE pdf_companions; PRAGMA user_version=8;")
            .unwrap();
        drop(store);
        let mut store = Store::open(&dir.path().join("library")).unwrap();
        assert_eq!(store.list_pdfs().unwrap()[0].id, pdf.id);
        assert!(store.read_pdf_range(&pdf.id, 0, 5).is_ok());
        assert!(store.ensure_pdf_companion(&pdf.id).is_ok());
        let backup = fs::read_dir(dir.path().join("library/backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let db = Connection::open(backup).unwrap();
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            8
        );
        assert_eq!(
            db.query_row("SELECT id FROM pdf_documents", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            pdf.id
        );
    }
}

#[cfg(test)]
mod companion_preferences_tests {
    use super::*;
    #[test]
    fn split_preferences_round_trip_and_bad_geometry_is_rejected_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        let mut input: SavePreferences = serde_json::from_value(serde_json::json!({
            "appearance": {"dark":true,"theme":"qrafthive","width":80,"size":17,"uiFont":"system","noteFont":"georgia","codeFont":"menlo"}, "notebooks": [], "expectedRevision": 0, "operationId": "save-layout",
            "workspace": { "tabs": [], "activeTabId": null, "pdfNotes": {
                "document": { "open": true, "ratio": 0.54, "scroll": 140, "pane": "note" }
            }}
        }))
        .unwrap();
        store.save_preferences(&input).unwrap();
        input.expected_revision = 1;
        input.operation_id = "bad-layout".into();
        input
            .workspace
            .as_mut()
            .unwrap()
            .pdf_notes
            .get_mut("document")
            .unwrap()
            .ratio = 1.5;
        assert!(store.save_preferences(&input).is_err());
        drop(store);
        let store = Store::open(dir.path()).unwrap();
        let saved: String = store
            .conn
            .query_row("SELECT workspace FROM preferences", [], |r| r.get(0))
            .unwrap();
        let workspace: WorkspacePreferences = serde_json::from_str(&saved).unwrap();
        let layout = &workspace.pdf_notes["document"];
        assert!(layout.open);
        assert_eq!(layout.ratio, 0.54);
        assert_eq!(layout.scroll, 140.0);
        assert_eq!(layout.pane, "note");
        let old: WorkspacePreferences =
            serde_json::from_value(serde_json::json!({"tabs":[],"activeTabId":null})).unwrap();
        assert!(old.pdf_notes.is_empty());
    }
}
