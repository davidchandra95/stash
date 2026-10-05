mod credentials;
#[cfg(target_os = "macos")]
mod macos_quit;
mod native_menu;
#[cfg(desktop)]
mod provision;
mod storage;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

#[derive(Default)]
struct StartupWindowReady(AtomicBool);

#[tauri::command]
fn show_startup_window(
    window: tauri::WebviewWindow,
    ready: tauri::State<'_, StartupWindowReady>,
) -> Result<(), String> {
    // Later theme changes must not reopen a window the user has hidden.
    if !ready.inner().0.load(Ordering::SeqCst) {
        window.show().map_err(|error| error.to_string())?;
        ready.inner().0.store(true, Ordering::SeqCst);
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_window_appearance(
    window: tauri::WebviewWindow,
    dark: bool,
    background: tauri::window::Color,
) -> Result<(), String> {
    window
        .set_theme(Some(if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }))
        .map_err(|error| error.to_string())?;
    window
        .set_background_color(Some(background))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn installed_fonts() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        core_text::font_manager::copy_available_font_family_names()
            .iter()
            .map(|name| name.to_string())
            .collect()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(target_os = "macos")]
    fn reads_real_mac_font_families() {
        let names = super::installed_fonts();
        assert!(!names.is_empty());
        assert!(names.iter().all(|name| !name.is_empty()));
        println!("Read {} installed font families", names.len());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    if provision::requested() {
        if let Err(error) = provision::run() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_stash_platform::init())
        .setup(|app| {
            app.manage(StartupWindowReady::default());
            // Mobile keeps its normal startup visibility.
            #[cfg(mobile)]
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_single_instance::init(|app, _, _| {
                    if !app
                        .state::<StartupWindowReady>()
                        .inner()
                        .0
                        .load(Ordering::SeqCst)
                    {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }))?;
            let dir = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let dir = std::env::var_os("UPNOTE2_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(dir);
            app.manage(Arc::new(storage::bridge::Service::with_credentials(
                dir,
                credentials::for_app(app.handle()),
            )));
            #[cfg(target_os = "macos")]
            macos_quit::install(app.handle())?;
            Ok(())
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            platform_info,
            native_menu::show_outline_menu,
            native_menu::cancel_outline_menu,
            set_mobile_keyboard,
            mobile_background,
            set_mobile_appearance,
            open_external_url,
            installed_fonts,
            set_window_appearance,
            show_startup_window,
            storage::bridge::sync_status,
            storage::bridge::configure_sync,
            storage::bridge::sync_library,
            storage::bridge::open_library,
            storage::bridge::load_note,
            storage::bridge::save_note,
            storage::bridge::save_preferences,
            storage::bridge::delete_notebook,
            storage::bridge::scan_folder,
            storage::bridge::link_folder,
            storage::bridge::prepare_notebook_conversion,
            storage::bridge::read_conversion_image,
            storage::bridge::open_external_file,
            storage::bridge::commit_notebook_conversion,
            storage::bridge::refresh_folder,
            storage::bridge::reselect_folder,
            storage::bridge::create_child_notebook,
            storage::bridge::read_note_asset,
            storage::bridge::write_note_asset,
            storage::bridge::resolve_file_conflict,
            storage::bridge::inspect_file_conflict,
            storage::bridge::clear_file_conflict,
            storage::bridge::preserve_file_conflict,
            storage::bridge::frontend_ready,
            storage::bridge::list_pdfs,
            storage::bridge::list_pdf_companions,
            storage::bridge::ensure_pdf_companion,
            storage::bridge::import_pdf,
            storage::bridge::read_pdf_range,
            storage::bridge::save_pdf_reading,
            storage::bridge::finish_quit
        ])
        .build(tauri::generate_context!())
        .expect("Could not start Stash")
        .run(|_app, event| match event {
            #[cfg(desktop)]
            tauri::RunEvent::ExitRequested { api, .. } => {
                if storage::bridge::request_quit(_app) {
                    api.prevent_exit();
                }
            }
            #[cfg(desktop)]
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                if storage::bridge::request_quit(_app) {
                    api.prevent_close();
                }
            }
            _ => {}
        });
}

#[tauri::command]
fn platform_info() -> serde_json::Value {
    serde_json::json!({"platform": std::env::consts::OS, "mobile": cfg!(mobile)})
}
#[tauri::command]
async fn set_mobile_keyboard(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_stash_platform::PlatformExt;
        return tauri::async_runtime::spawn_blocking(move || {
            app.stash_platform().keyboard(visible)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, visible);
        Ok(())
    }
}
#[tauri::command]
async fn mobile_background(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_stash_platform::PlatformExt;
        return tauri::async_runtime::spawn_blocking(move || app.stash_platform().background())
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}
#[tauri::command]
async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid link".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err("This link cannot be opened on this device.".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_stash_platform::PlatformExt;
        return tauri::async_runtime::spawn_blocking(move || app.stash_platform().open_url(&url))
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("External mobile links are unavailable on this platform.".into())
    }
}

// Called by the Android plugin with JVM-owned references. EnvUnowned catches panics
// and converts errors to Java exceptions instead of unwinding across the JNI boundary.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_local_stash_platform_StashPlatformPlugin_initTls<'local>(
    mut env: jni::EnvUnowned<'local>,
    _this: jni::objects::JObject<'local>,
    context: jni::objects::JObject<'local>,
) {
    env.with_env(|env| rustls_platform_verifier::android::init_with_env(env, context))
        .resolve::<jni::errors::ThrowRuntimeExAndDefault>();
}
#[tauri::command]
async fn set_mobile_appearance(
    app: tauri::AppHandle,
    dark: bool,
    background: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_stash_platform::PlatformExt;
        return tauri::async_runtime::spawn_blocking(move || {
            app.stash_platform().appearance(dark, &background)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, dark, background);
        Ok(())
    }
}
