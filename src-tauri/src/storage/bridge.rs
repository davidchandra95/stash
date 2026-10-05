use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};

pub struct Service {
    credentials: Arc<dyn crate::credentials::CredentialStore>,
    pub dir: PathBuf,
    pub store: Mutex<Option<Store>>,
    pub ready: AtomicBool,
    pub exiting: AtomicBool,
}
impl Service {
    pub fn with_credentials(
        dir: PathBuf,
        credentials: Arc<dyn crate::credentials::CredentialStore>,
    ) -> Self {
        Self {
            credentials,
            dir,
            store: Mutex::new(None),
            ready: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
        }
    }
    fn access<T>(&self, action: impl FnOnce(&mut Store) -> Result<T>) -> Result<T> {
        let mut guard = self.store.lock().map_err(|_| {
            "The storage worker stopped unexpectedly. Keep your pending edits open.".to_string()
        })?;
        if guard.is_none() {
            let mut store = Store::open(&self.dir)?;
            store.credentials = self.credentials.clone();
            *guard = Some(store);
        }
        action(guard.as_mut().unwrap())
    }
}
async fn work<T: Send + 'static>(
    service: Arc<Service>,
    action: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || service.access(action))
        .await
        .map_err(db_err)?
}
#[tauri::command]
pub async fn open_library(service: tauri::State<'_, Arc<Service>>) -> Result<Library> {
    work(service.inner().clone(), |s| s.open_linked_library()).await
}
#[tauri::command]
pub async fn load_note(id: String, service: tauri::State<'_, Arc<Service>>) -> Result<Note> {
    work(service.inner().clone(), move |s| s.load_note(&id)).await
}
#[tauri::command]
pub async fn save_note(
    input: SaveNote,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<SaveResponse> {
    work(service.inner().clone(), move |s| {
        match s.save_note(&input) {
            Ok(saved) => Ok(SaveResponse { revision: saved.revision, updated: saved.updated, note: s.note(&input.id,true)? }),
            Err(error) => { if error.starts_with("FILE_CONFLICT:") || error.starts_with("NAME_COLLISION:") {s.conn.execute("INSERT INTO file_conflicts VALUES(?,?,?) ON CONFLICT(note_id) DO UPDATE SET draft=excluded.draft,error=excluded.error",params![input.id,serde_json::to_string(&input).map_err(db_err)?,error]).map_err(db_err)?;} Err(error) }
        }
    }).await
}
#[tauri::command]
pub async fn save_preferences(
    input: SavePreferences,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Saved> {
    work(service.inner().clone(), move |s| s.save_preferences(&input)).await
}
#[tauri::command]
pub async fn delete_notebook(
    input: DeleteNotebookRequest,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Library> {
    work(service.inner().clone(), move |s| s.delete_notebook(&input)).await
}
#[tauri::command]
pub fn frontend_ready(_service: tauri::State<'_, Arc<Service>>) {
    #[cfg(desktop)]
    _service.ready.store(true, Ordering::SeqCst);
}
#[tauri::command]
pub fn finish_quit(_app: tauri::AppHandle, _service: tauri::State<'_, Arc<Service>>) {
    #[cfg(desktop)]
    {
        _service.exiting.store(true, Ordering::SeqCst);
        _app.exit(0);
    }
}
#[cfg(desktop)]
pub fn request_quit(app: &tauri::AppHandle) -> bool {
    let service = app.state::<Arc<Service>>();
    if service.exiting.load(Ordering::SeqCst) || !service.ready.load(Ordering::SeqCst) {
        return false;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("save-before-quit", ());
    true
}

#[tauri::command]
pub async fn scan_folder(path: String) -> Result<linked::Scan> {
    tauri::async_runtime::spawn_blocking(move || linked::scan(&path))
        .await
        .map_err(db_err)?
}
#[tauri::command]
pub async fn link_folder(
    path: String,
    name: String,
    parent: Option<String>,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Library> {
    work(service.inner().clone(), move |s| {
        s.link_folder(&path, &name, parent)
    })
    .await
}
#[tauri::command]
pub async fn refresh_folder(
    id: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Library> {
    work(service.inner().clone(), move |s| {
        s.refresh_root(&id)?;
        s.library()
    })
    .await
}
#[tauri::command]
pub async fn reselect_folder(
    id: String,
    path: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Library> {
    work(service.inner().clone(), move |s| {
        s.reselect_root(&id, &path)
    })
    .await
}
#[tauri::command]
pub async fn create_child_notebook(
    parent: String,
    name: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Library> {
    work(service.inner().clone(), move |s| {
        s.create_child(&parent, &name)
    })
    .await
}
#[tauri::command]
pub async fn read_note_asset(
    id: String,
    href: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<String> {
    work(service.inner().clone(), move |s| s.read_asset(&id, &href)).await
}
#[tauri::command]
pub async fn write_note_asset(
    id: String,
    name: String,
    data: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<String> {
    work(service.inner().clone(), move |s| {
        s.write_asset(&id, &name, &data)
    })
    .await
}
#[tauri::command]
pub async fn resolve_file_conflict(
    id: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Option<Note>> {
    work(service.inner().clone(), move |s| {
        s.abandon_operations(&id)?;
        if s.note(&id, false).is_err() {
            return Ok(None);
        }
        s.load_note(&id).map(Some)
    })
    .await
}
#[tauri::command]
pub async fn inspect_file_conflict(
    id: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Option<Note>> {
    work(service.inner().clone(), move |s| {
        if s.note(&id, false).is_err() {
            return Ok(None);
        }
        s.load_note(&id).map(Some)
    })
    .await
}

#[derive(Serialize)]
pub struct SaveResponse {
    pub revision: i64,
    pub updated: i64,
    pub note: Note,
}
#[tauri::command]
pub async fn clear_file_conflict(
    id: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<()> {
    work(service.inner().clone(), move |s| {
        s.conn
            .execute("DELETE FROM file_conflicts WHERE note_id=?", [id])
            .map_err(db_err)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn preserve_file_conflict(
    input: SaveNote,
    error: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<()> {
    work(service.inner().clone(), move |s| {
        s.conn.execute("INSERT INTO file_conflicts VALUES(?,?,?) ON CONFLICT(note_id) DO UPDATE SET draft=excluded.draft,error=excluded.error", params![input.id,serde_json::to_string(&input).map_err(db_err)?,error]).map_err(db_err)?;
        Ok(())
    }).await
}

#[tauri::command]
pub async fn sync_status(service: tauri::State<'_, Arc<Service>>) -> Result<sync::Status> {
    work(service.inner().clone(), |s| s.sync_status()).await
}
#[tauri::command]
pub async fn configure_sync(
    url: String,
    token: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<sync::Status> {
    work(service.inner().clone(), move |s| {
        s.configure_sync(url, token)
    })
    .await
}
#[tauri::command]
pub async fn sync_library(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<sync::Outcome> {
    work(service.inner().clone(), move |s| {
        s.run_sync(|message| {
            let _ = app.emit("sync-progress", message);
        })
    })
    .await
}

#[tauri::command]
pub async fn prepare_notebook_conversion(
    id: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<conversion::Preparation> {
    work(service.inner().clone(), move |s| s.prepare_conversion(&id)).await
}
#[tauri::command]
pub async fn read_conversion_image(
    token: String,
    id: String,
    href: String,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<String> {
    work(service.inner().clone(), move |s| {
        s.conversion_image(&token, &id, &href)
    })
    .await
}
#[tauri::command]
pub async fn commit_notebook_conversion(
    token: String,
    documents: Vec<conversion::Document>,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Library> {
    work(service.inner().clone(), move |s| {
        s.commit_conversion(&token, documents)
    })
    .await
}

#[tauri::command]
pub async fn open_external_file(href: String) -> Result<()> {
    let url = reqwest::Url::parse(&href).map_err(db_err)?;
    if url.scheme() != "file" {
        return Err("Only local file links are supported here.".into());
    }
    let path = url.to_file_path().map_err(|_| "Invalid local file link")?;
    if !path.is_file() {
        return Err("The linked file is missing or unavailable.".into());
    }
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let program = "xdg-open";
    tauri::async_runtime::spawn_blocking(move || {
        let status = std::process::Command::new(program)
            .arg(path)
            .status()
            .map_err(db_err)?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not open the linked file.".into())
        }
    })
    .await
    .map_err(db_err)?
}

#[tauri::command]
pub async fn list_pdfs(service: tauri::State<'_, Arc<Service>>) -> Result<Vec<pdf::PdfDocument>> {
    work(service.inner().clone(), |s| s.list_pdfs()).await
}
#[tauri::command]
pub async fn import_pdf(path: String, service: tauri::State<'_, Arc<Service>>) -> Result<pdf::PdfDocument> {
    work(service.inner().clone(), move |s| s.import_pdf(Path::new(&path))).await
}
#[tauri::command]
pub async fn read_pdf_range(id: String, begin: u64, end: u64, service: tauri::State<'_, Arc<Service>>) -> Result<tauri::ipc::Response> {
    work(service.inner().clone(), move |s| s.read_pdf_range(&id, begin, end)).await.map(tauri::ipc::Response::new)
}
#[tauri::command]
pub async fn save_pdf_reading(id: String, reading: pdf::ReadingState, service: tauri::State<'_, Arc<Service>>) -> Result<()> {
    work(service.inner().clone(), move |s| s.save_pdf_reading(&id, &reading)).await
}

#[tauri::command]
pub async fn list_pdf_companions(service: tauri::State<'_, Arc<Service>>) -> Result<std::collections::BTreeMap<String, String>> {
    work(service.inner().clone(), |s| s.list_pdf_companions()).await
}
#[tauri::command]
pub async fn ensure_pdf_companion(document_id: String, service: tauri::State<'_, Arc<Service>>) -> Result<Note> {
    work(service.inner().clone(), move |s| s.ensure_pdf_companion(&document_id)).await
}
