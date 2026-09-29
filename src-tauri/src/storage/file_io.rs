//! Recoverable filesystem steps. The journal is durable before any step runs.
use super::*;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn identity(path: &Path) -> Result<String> {
    let m = fs::symlink_metadata(path).map_err(db_err)?;
    if !m.is_file() {
        return Err("Only regular files can be opened.".into());
    }
    Ok(format!("{}:{}", m.dev(), m.ino()))
}
pub fn read(path: &Path) -> Result<Vec<u8>> {
    use std::io::Read;
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(db_err)?;
    if !file.metadata().map_err(db_err)?.is_file() {
        return Err("Only regular files can be read.".into());
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(db_err)?;
    Ok(bytes)
}
pub fn sync_dir(path: &Path) -> Result<()> {
    File::open(path).and_then(|f| f.sync_all()).map_err(db_err)
}
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(db_err)?;
    f.write_all(bytes)
        .and_then(|_| f.sync_all())
        .map_err(db_err)?;
    sync_dir(path.parent().ok_or("Missing parent folder")?)
}
pub fn rename(from: &Path, to: &Path, swap: bool) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let from = std::ffi::CString::new(from.as_os_str().as_bytes()).map_err(db_err)?;
        let to = std::ffi::CString::new(to.as_os_str().as_bytes()).map_err(db_err)?;
        // RENAME_SWAP preserves the displaced file. RENAME_EXCL never clobbers a destination.
        let result =
            unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), if swap { 2 } else { 4 }) };
        if result != 0 {
            return Err(db_err(std::io::Error::last_os_error()));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (from, to, swap);
        Err("This filesystem does not support safe Stash file replacement.".into())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Change {
    pub path: PathBuf,
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
    pub staging: PathBuf,
}
impl Change {
    pub fn new(path: PathBuf, before: Option<Vec<u8>>, after: Option<Vec<u8>>, id: &str) -> Self {
        let staging = path.with_file_name(format!(".stash-{}-{}", id, uuid::Uuid::new_v4()));
        Self {
            path,
            before,
            after,
            staging,
        }
    }
    fn current(&self) -> Result<Option<Vec<u8>>> {
        match fs::symlink_metadata(&self.path) {
            Ok(_) => read(&self.path).map(Some),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(db_err(e)),
        }
    }
    pub fn preflight(&self) -> Result<()> {
        if self.current()? != self.before {
            return Err(format!(
                "FILE_CONFLICT: {} changed outside Stash.",
                self.path.display()
            ));
        }
        Ok(())
    }
    pub fn apply(&self) -> Result<()> {
        let current = self.current()?;
        // A crash after the filesystem step but before its acknowledgement is safe to replay.
        if current == self.after {
            return Ok(());
        }
        if current != self.before {
            return Err(format!(
                "FILE_CONFLICT: {} changed outside Stash.",
                self.path.display()
            ));
        }
        let parent = self.path.parent().ok_or("Missing parent folder")?;
        if let Some(after) = &self.after {
            if self.staging.exists() {
                if read(&self.staging)? != *after {
                    return Err("FILE_CONFLICT: recovery contains another file version.".into());
                }
            } else {
                write_new(&self.staging, after)?;
            }
            if self.before.is_some() {
                // Apply metadata again on replay, including a crash immediately after staging.
                #[cfg(target_os = "macos")]
                copy_metadata(&self.path, &self.staging)?;
                File::open(&self.staging)
                    .and_then(|f| f.sync_all())
                    .map_err(db_err)?;
            }
            rename(&self.staging, &self.path, self.before.is_some())?;
            sync_dir(parent)?;
            if let Some(before) = &self.before {
                if read(&self.staging)? != *before {
                    // An editor won the race between the check and swap. Preserve its bytes.
                    if self.current()?.as_ref() == Some(after) {
                        rename(&self.staging, &self.path, true)?;
                        sync_dir(parent)?;
                    }
                    return Err("FILE_CONFLICT: the file changed during saving. Both versions were retained.".into());
                }
            }
        } else {
            rename(&self.path, &self.staging, false)?;
            sync_dir(parent)?;
            if Some(read(&self.staging)?) != self.before {
                if !self.path.exists() {
                    rename(&self.staging, &self.path, false)?;
                }
                return Err(
                    "FILE_CONFLICT: the file changed during moving. Its contents were retained."
                        .into(),
                );
            }
        }
        Ok(())
    }
    pub fn cleanup(&self) {
        // Only remove known staging bytes. Unexpected content remains available for recovery.
        if let Ok(bytes) = read(&self.staging) {
            if Some(&bytes) == self.before.as_ref() || Some(&bytes) == self.after.as_ref() {
                let _ = fs::remove_file(&self.staging);
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn copy_metadata(from: &Path, to: &Path) -> Result<()> {
    use std::os::unix::ffi::OsStrExt;
    unsafe extern "C" {
        fn copyfile(
            from: *const libc::c_char,
            to: *const libc::c_char,
            state: *mut libc::c_void,
            flags: u32,
        ) -> libc::c_int;
    }
    let from = std::ffi::CString::new(from.as_os_str().as_bytes()).map_err(db_err)?;
    let to = std::ffi::CString::new(to.as_os_str().as_bytes()).map_err(db_err)?;
    // COPYFILE_ACL | COPYFILE_STAT | COPYFILE_XATTR, excluding file contents.
    if unsafe { copyfile(from.as_ptr(), to.as_ptr(), std::ptr::null_mut(), 7) } != 0 {
        return Err(db_err(std::io::Error::last_os_error()));
    }
    Ok(())
}

/// An empty child folder is staged with a recorded identity before it becomes visible.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DirectoryChange {
    pub path: PathBuf,
    pub staging: PathBuf,
    pub identity: String,
}
impl DirectoryChange {
    pub fn stage(path: PathBuf, id: &str) -> Result<Self> {
        if fs::symlink_metadata(&path).is_ok() {
            return Err("A folder or file already has this name.".into());
        }
        let staging = path.with_file_name(format!(".stash-folder-{id}"));
        fs::create_dir(&staging).map_err(db_err)?;
        sync_dir(staging.parent().ok_or("Missing parent folder")?)?;
        let metadata = fs::symlink_metadata(&staging).map_err(db_err)?;
        Ok(Self {
            path,
            staging,
            identity: format!("{}:{}", metadata.dev(), metadata.ino()),
        })
    }
    pub fn apply(&self) -> Result<()> {
        if let Ok(metadata) = fs::symlink_metadata(&self.path) {
            if metadata.is_dir()
                && format!("{}:{}", metadata.dev(), metadata.ino()) == self.identity
            {
                return Ok(());
            }
            return Err("Another file or folder occupies the new sub-notebook path.".into());
        }
        let metadata = fs::symlink_metadata(&self.staging).map_err(db_err)?;
        if !metadata.is_dir() || format!("{}:{}", metadata.dev(), metadata.ino()) != self.identity {
            return Err("The staged sub-notebook changed outside Stash.".into());
        }
        rename(&self.staging, &self.path, false)?;
        sync_dir(self.path.parent().ok_or("Missing parent folder")?)
    }
}
