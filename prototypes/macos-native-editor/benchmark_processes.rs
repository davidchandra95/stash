//! Read-only process attribution for the disposable macOS benchmark build.
//! WebKit's own MiniBrowser uses these diagnostic process identifiers.
#[tauri::command]
pub async fn register_input(window: tauri::WebviewWindow, path: String) -> Result<bool, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    window.with_webview(move |webview| {
        let result = unsafe {
            use objc2::{msg_send, runtime::AnyObject};
            let path = std::ffi::CString::new(path).unwrap();
            let handle = libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            if handle.is_null() { Err("Cannot load owned input library".to_string()) }
            else {
                let symbol = libc::dlsym(handle, c"stash_benchmark_register_input".as_ptr());
                if symbol.is_null() { Err("Cannot find owned input entry point".to_string()) }
                else {
                    let register: unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) = std::mem::transmute(symbol);
                    let view = webview.inner() as *mut AnyObject;
                    let native_window: *mut AnyObject = msg_send![view, window];
                    register(native_window.cast(), view.cast());
                    Ok(true)
                }
            }
        };
        let _ = tx.send(result);
    }).map_err(|error| error.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn processes(window: tauri::WebviewWindow) -> Result<Vec<i32>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    window.with_webview(move |webview| {
        let mut pids = Vec::new();
        unsafe {
            use objc2::{msg_send, sel};
            use objc2::runtime::AnyObject;
            let view = &*(webview.inner() as *mut AnyObject);
            let has_web: bool = msg_send![view, respondsToSelector: sel!(_webProcessIdentifier)];
            if has_web { let pid: i32 = msg_send![view, _webProcessIdentifier]; if pid > 0 { pids.push(pid); } }
            let has_gpu: bool = msg_send![view, respondsToSelector: sel!(_gpuProcessIdentifier)];
            if has_gpu { let pid: i32 = msg_send![view, _gpuProcessIdentifier]; if pid > 0 { pids.push(pid); } }
            let configuration: *mut AnyObject = msg_send![view, configuration];
            let store: *mut AnyObject = msg_send![configuration, websiteDataStore];
            let has_network: bool = msg_send![store, respondsToSelector: sel!(_networkProcessIdentifier)];
            if has_network { let pid: i32 = msg_send![store, _networkProcessIdentifier]; if pid > 0 { pids.push(pid); } }
        }
        let _ = tx.send(pids);
    }).map_err(|error| error.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|error| error.to_string())
}
