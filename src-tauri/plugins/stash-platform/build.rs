fn main() {
    tauri_plugin::Builder::new(&["register_listener", "remove_listener"])
        .android_path("android")
        .build();
}
