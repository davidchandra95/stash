use std::sync::Arc;
pub trait CredentialStore: Send + Sync {
    fn save(&self, device: &str, token: &str) -> Result<(), String>;
    fn load(&self, device: &str) -> Result<String, String>;
}
pub struct SystemCredentials;
impl CredentialStore for SystemCredentials {
    fn save(&self, device: &str, token: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        return security_framework::passwords::set_generic_password(
            "local.upnote2.prototype.sync",
            device,
            token.as_bytes(),
        )
        .map_err(|_| "Could not save the device token in Keychain.".into());
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (device, token);
            Err("Secure credentials are unavailable on this platform.".into())
        }
    }
    fn load(&self, device: &str) -> Result<String, String> {
        #[cfg(target_os = "macos")]
        return security_framework::passwords::get_generic_password(
            "local.upnote2.prototype.sync",
            device,
        )
        .map_err(|_| {
            "Could not read the device token from Keychain. Open Sync settings to reconnect."
                .to_string()
        })
        .and_then(|v| String::from_utf8(v).map_err(|_| "Invalid saved credentials.".into()));
        #[cfg(not(target_os = "macos"))]
        {
            let _ = device;
            Err("Secure credentials are unavailable on this platform.".into())
        }
    }
}
#[cfg(target_os = "android")]
struct AndroidCredentials(tauri::AppHandle);
#[cfg(target_os = "android")]
impl CredentialStore for AndroidCredentials {
    fn save(&self, device: &str, token: &str) -> Result<(), String> {
        use tauri_plugin_stash_platform::PlatformExt;
        self.0.stash_platform().save_token(device, token)
    }
    fn load(&self, device: &str) -> Result<String, String> {
        use tauri_plugin_stash_platform::PlatformExt;
        self.0.stash_platform().load_token(device)
    }
}
pub fn for_app(_app: &tauri::AppHandle) -> Arc<dyn CredentialStore> {
    #[cfg(target_os = "android")]
    return Arc::new(AndroidCredentials(_app.clone()));
    #[cfg(not(target_os = "android"))]
    Arc::new(SystemCredentials)
}
