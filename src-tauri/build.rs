fn main() {
    println!("cargo:rerun-if-env-changed=STASH_SYNC_TEST_CA_FILE");
    if let Ok(path) = std::env::var("STASH_SYNC_TEST_CA_FILE") {
        println!("cargo:rerun-if-changed={path}");
    }
    tauri_build::build()
}
