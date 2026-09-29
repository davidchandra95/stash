//! Non-interactive provisioning for a self-hosted Mac. Credentials arrive on stdin,
//! never in command-line arguments, logs or the WebView. Normal launches do nothing.
use std::io::Read;

pub fn requested() -> bool {
    std::env::args().nth(1).as_deref() == Some("--configure-sync")
}
pub fn run() -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    return Err("Sync provisioning is currently supported on macOS only.".into());
    #[cfg(target_os = "macos")]
    {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Config {
            url: String,
            token: String,
        }
        let mut input = String::new();
        std::io::stdin()
            .take(8193)
            .read_to_string(&mut input)
            .map_err(|_| "Could not read connection configuration.")?;
        if input.len() > 8192 {
            return Err("Connection configuration is too large.".into());
        }
        let config: Config = serde_json::from_str(&input)
            .map_err(|_| "Expected JSON with url and token on stdin.")?;
        let home = std::env::var_os("HOME").ok_or("Could not locate the Mac home directory.")?;
        let dir = std::path::PathBuf::from(home)
            .join("Library/Application Support/local.upnote2.prototype");
        let mut store = crate::storage::Store::open(&dir)?;
        store.configure_sync(config.url, config.token)?;
        println!("Sync connection saved. Open Stash and press Sync.");
        Ok(())
    }
}
