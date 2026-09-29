use std::collections::HashMap;

#[tauri::command]
pub async fn render_symbols(
    window: tauri::WebviewWindow,
    names: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    #[cfg(target_os = "macos")]
    {
        if names.len() > 128
            || names.iter().any(|name| {
                name.len() > 64
                    || !name
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.')
            })
        {
            return Err("Invalid symbol request".into());
        }
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let _ = send.send(macos::render(names));
            })
            .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receive.recv().map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())??
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, names);
        Ok(HashMap::new())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use base64::Engine;
    use objc2::AnyThread;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSFontWeightRegular, NSImage,
        NSImageSymbolConfiguration,
    };
    use objc2_foundation::{NSDictionary, NSString};
    use std::collections::HashMap;

    pub fn render(names: Vec<String>) -> Result<HashMap<String, String>, String> {
        let config = NSImageSymbolConfiguration::configurationWithPointSize_weight(64.0, unsafe {
            NSFontWeightRegular
        });
        let mut rendered = HashMap::new();
        for name in names {
            let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
                &NSString::from_str(&name),
                None,
            ) else {
                continue;
            };
            let Some(image) = image.imageWithSymbolConfiguration(&config) else {
                continue;
            };
            let Some(tiff) = image.TIFFRepresentation() else {
                continue;
            };
            let Some(bitmap) = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)
            else {
                continue;
            };
            // SAFETY: An empty property dictionary is valid for PNG encoding.
            let Some(png) = (unsafe {
                bitmap.representationUsingType_properties(
                    NSBitmapImageFileType::PNG,
                    &NSDictionary::new(),
                )
            }) else {
                continue;
            };
            rendered.insert(
                name,
                format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(png.to_vec())
                ),
            );
        }
        Ok(rendered)
    }

    #[test]
    fn renders_a_system_symbol_as_png() {
        let rendered = render(vec!["plus".into(), "does.not.exist".into()]).unwrap();
        let uri = rendered.get("plus").expect("plus should be available");
        let png = base64::engine::general_purpose::STANDARD
            .decode(uri.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(!rendered.contains_key("does.not.exist"));
    }
}
