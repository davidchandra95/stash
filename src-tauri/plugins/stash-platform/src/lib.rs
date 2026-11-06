#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
pub struct Platform<R: Runtime>(PluginHandle<R>);
#[cfg(target_os = "android")]
impl<R: Runtime> Platform<R> {
    pub fn keyboard(&self, visible: bool) -> Result<(), String> {
        self.0
            .run_mobile_plugin("keyboard", serde_json::json!({"visible":visible}))
            .map_err(|_| "Could not update the keyboard.".into())
    }
    pub fn save_token(&self, device: &str, token: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin(
                "saveToken",
                serde_json::json!({"device":device,"token":token}),
            )
            .map_err(|_| "Could not securely save the device token. Try connecting again.".into())
    }
    pub fn load_token(&self, device: &str) -> Result<String, String> {
        #[derive(serde::Deserialize)]
        struct Token {
            token: String,
        }
        self.0
            .run_mobile_plugin::<Token>("loadToken", serde_json::json!({"device":device}))
            .map(|v| v.token)
            .map_err(|_| {
                "Could not read the saved device token. Open Sync settings to reconnect.".into()
            })
    }
    pub fn appearance(&self, dark: bool, background: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin(
                "appearance",
                serde_json::json!({"dark":dark,"background":background}),
            )
            .map_err(|_| "Could not update system appearance.".into())
    }
    pub fn background(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("background", ())
            .map_err(|_| "Could not leave the app.".into())
    }
    /// Waits on the system picker. The copy it returns is ours to delete; None means cancelled.
    pub fn pick_pdf(&self) -> Result<Option<String>, String> {
        #[derive(serde::Deserialize)]
        struct Picked {
            path: Option<String>,
        }
        self.0
            .run_mobile_plugin::<Picked>("pickPdf", ())
            .map(|v| v.path)
            .map_err(|_| "Could not read that file. Try choosing it again.".into())
    }
    pub fn reminder_status(&self) -> Result<String, String> {
        #[derive(serde::Deserialize)]
        struct Status {
            status: String,
        }
        self.0
            .run_mobile_plugin::<Status>("reminderStatus", ())
            .map(|v| v.status)
            .map_err(|_| "Could not read the notification permission.".into())
    }
    /// Waits on the system's permission dialog.
    pub fn reminder_request_permission(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("reminderRequestPermission", ())
            .map_err(|_| "Could not ask for notification permission.".into())
    }
    pub fn reminder_pending(&self) -> Result<Vec<String>, String> {
        #[derive(serde::Deserialize)]
        struct Pending {
            ids: Vec<String>,
        }
        self.0
            .run_mobile_plugin::<Pending>("reminderPending", ())
            .map(|v| v.ids)
            .map_err(|_| "Could not read scheduled reminders.".into())
    }
    pub fn reminder_sync(&self, entries: serde_json::Value, drop: &[String]) -> Result<(), String> {
        self.0
            .run_mobile_plugin("reminderSync", serde_json::json!({"entries":entries,"drop":drop}))
            .map_err(|_| "Could not schedule reminders.".into())
    }
    pub fn reminder_cancel(&self, ids: &[String]) -> Result<(), String> {
        self.0
            .run_mobile_plugin("reminderCancel", serde_json::json!({"ids":ids}))
            .map_err(|_| "Could not cancel the snooze.".into())
    }
    pub fn reminder_take_open(&self) -> Result<Option<String>, String> {
        #[derive(serde::Deserialize)]
        struct Open {
            task: Option<String>,
        }
        self.0
            .run_mobile_plugin::<Open>("reminderTakeOpen", ())
            .map(|v| v.task)
            .map_err(|_| "Could not open that reminder's task.".into())
    }
    pub fn reminder_open_settings(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("reminderOpenSettings", ())
            .map_err(|_| "Could not open notification settings.".into())
    }
    pub fn open_url(&self, url: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin("openUrl", serde_json::json!({"url":url}))
            .map_err(|_| "No app could open this link.".into())
    }
}
#[cfg(target_os = "android")]
pub trait PlatformExt<R: Runtime> {
    fn stash_platform(&self) -> &Platform<R>;
}
#[cfg(target_os = "android")]
impl<R: Runtime, T: Manager<R>> PlatformExt<R> for T {
    fn stash_platform(&self) -> &Platform<R> {
        self.state::<Platform<R>>().inner()
    }
}
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("stash-platform")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(Platform(_api.register_android_plugin(
                "local.stash.platform",
                "StashPlatformPlugin",
            )?));
            Ok(())
        })
        .build()
}
