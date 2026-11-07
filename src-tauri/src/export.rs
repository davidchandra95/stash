//! Writes exported notes to a folder the person chose. Every path stays inside that folder: names
//! are relative, without `..`, and a folder export always goes into a new, uniquely named folder,
//! so it never overwrites anything. Writing a single file in place requires `overwrite`, which the
//! app sets only after the system save dialog has confirmed replacing it.
use base64::Engine;
use serde::Deserialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    /// Relative to the export folder, with `/` between parts.
    pub path: String,
    #[serde(default)]
    pub text: Option<String>,
    /// Binary content such as an image, base64-encoded.
    #[serde(default)]
    pub base64: Option<String>,
}

const MAX_FILES: usize = 50_000;

fn safe_relative(path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    let valid = !path.is_empty()
        && !path.contains('\0')
        && relative.components().all(|part| match part {
            Component::Normal(name) => !name.is_empty() && name.len() <= 255,
            _ => false,
        });
    if valid {
        Ok(relative.to_path_buf())
    } else {
        Err(format!("Invalid export file name: {path}"))
    }
}

/// `parent/name`, or `parent/name 2`, … — the first that doesn't exist yet.
fn unique_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    safe_relative(name)?;
    for n in 1..10_000 {
        let candidate = parent.join(if n == 1 { name.to_string() } else { format!("{name} {n}") });
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Couldn't create the export folder: {error}")),
        }
    }
    Err("Couldn't find a free name for the export folder.".into())
}

/// Writes `files` into `directory` (or a new `folder` inside it) and returns the folder written.
pub fn write_export(
    directory: &str,
    folder: Option<&str>,
    files: &[ExportFile],
    overwrite: bool,
) -> Result<String, String> {
    if files.is_empty() || files.len() > MAX_FILES {
        return Err("Nothing to export.".into());
    }
    let parent = Path::new(directory);
    if !parent.is_absolute() || !parent.is_dir() {
        return Err("The export location is not a folder.".into());
    }
    let mut prepared = Vec::with_capacity(files.len());
    for file in files {
        let relative = safe_relative(&file.path)?;
        let bytes = match (&file.text, &file.base64) {
            (Some(text), None) => text.clone().into_bytes(),
            (None, Some(data)) => base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| format!("Invalid export data for {}", file.path))?,
            _ => return Err(format!("Invalid export data for {}", file.path)),
        };
        prepared.push((relative, bytes));
    }
    let root = match folder {
        Some(name) => unique_folder(parent, name)?,
        None => parent.to_path_buf(),
    };
    for (relative, bytes) in prepared {
        let target = root.join(&relative);
        if let Some(dir) = target.parent() {
            fs::create_dir_all(dir).map_err(|error| format!("Couldn't create {}: {error}", dir.display()))?;
        }
        // A new folder starts empty; in place, only an approved file may be replaced.
        if target.exists() && (folder.is_some() || !overwrite) {
            return Err(format!("{} already exists.", target.display()));
        }
        fs::write(&target, bytes).map_err(|error| format!("Couldn't write {}: {error}", target.display()))?;
    }
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn export_files(
    directory: String,
    folder: Option<String>,
    files: Vec<ExportFile>,
    overwrite: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || write_export(&directory, folder.as_deref(), &files, overwrite))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(path: &str, content: &str) -> ExportFile {
        ExportFile { path: path.into(), text: Some(content.into()), base64: None }
    }

    #[test]
    fn folder_exports_go_into_a_new_unique_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let files = vec![
            text("Work/Plan.md", "# Plan\n"),
            ExportFile { path: "Work/images/a.png".into(), text: None, base64: Some("iVBORw==".into()) },
        ];
        let first = write_export(root, Some("Stash export"), &files, false).unwrap();
        let second = write_export(root, Some("Stash export"), &files, false).unwrap();
        assert!(first.ends_with("Stash export"));
        assert!(second.ends_with("Stash export 2"));
        assert_eq!(fs::read_to_string(Path::new(&first).join("Work/Plan.md")).unwrap(), "# Plan\n");
        assert_eq!(fs::read(Path::new(&first).join("Work/images/a.png")).unwrap(), [0x89, 0x50, 0x4e, 0x47]);
    }

    #[test]
    fn paths_stay_inside_and_files_are_only_replaced_when_approved() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        for bad in ["../escape.md", "/abs.md", "a/../../b.md", "", "a//b.md\0"] {
            assert!(write_export(root, None, &[text(bad, "x")], true).is_err(), "{bad}");
        }
        assert!(write_export(root, Some("../up"), &[text("a.md", "x")], false).is_err());
        assert!(write_export("relative/dir", None, &[text("a.md", "x")], true).is_err());
        assert!(write_export(root, None, &[], true).is_err());
        assert!(write_export(root, None, &[ExportFile { path: "b.png".into(), text: None, base64: Some("%%%".into()) }], true).is_err());

        write_export(root, None, &[text("Note.md", "one")], false).unwrap();
        assert!(write_export(root, None, &[text("Note.md", "two")], false).unwrap_err().contains("already exists"));
        write_export(root, None, &[text("Note.md", "two")], true).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("Note.md")).unwrap(), "two");
    }
}
