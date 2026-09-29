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
