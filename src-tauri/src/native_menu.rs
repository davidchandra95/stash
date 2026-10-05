//! AppKit template images follow menu selection, disabled state and appearance.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    label: String,
    icon_png: Option<String>,
    disabled: bool,
    separator: bool,
    shortcut: Option<String>,
    #[serde(default)]
    checked: bool,
    color: Option<String>,
}

#[tauri::command]
pub async fn show_outline_menu(
    window: tauri::WebviewWindow,
    actions: Vec<Action>,
    x: f64,
    y: f64,
    above: Option<bool>,
    tracking_id: Option<String>,
) -> Result<Option<usize>, String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let owner = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = send.send(macos::popup(
                    owner,
                    actions,
                    x,
                    y,
                    above.unwrap_or(false),
                    tracking_id,
                ));
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())??
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, actions, x, y, above, tracking_id);
        Err("Outline native menus require macOS".into())
    }
}

#[tauri::command]
pub fn cancel_outline_menu(
    window: tauri::WebviewWindow,
    tracking_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let label = window.label().to_owned();
        window
            .run_on_main_thread(move || macos::cancel(&label, &tracking_id))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, tracking_id);
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::Action;
    use objc2::rc::Retained;
    use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass, MainThreadOnly};
    use objc2_app_kit::{
        NSBitmapFormat, NSBitmapImageRep, NSControlStateValueOn, NSDeviceRGBColorSpace,
        NSEventModifierFlags as Flags, NSImage, NSMenu, NSMenuItem, NSView,
    };
    use objc2_foundation::{
        MainThreadMarker, NSData, NSObject, NSObjectProtocol, NSPoint, NSSize, NSString,
    };
    use std::cell::{Cell, RefCell};

    thread_local! {
        static TRACKING: RefCell<Option<(String, String, Retained<NSMenu>)>> = const { RefCell::new(None) };
    }

    pub fn cancel(window: &str, id: &str) {
        let menu = TRACKING.with(|tracking| {
            tracking
                .borrow()
                .as_ref()
                .filter(|(owner, token, _)| owner == window && token == id)
                .map(|(_, _, menu)| menu.clone())
        });
        if let Some(menu) = menu {
            menu.cancelTrackingWithoutAnimation();
        }
    }

    fn template_icon(encoded: &str) -> Result<Retained<NSImage>, String> {
        use base64::Engine;
        if encoded.len() > 64 * 1024 {
            return Err("Menu icon PNG is too large".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| format!("Invalid menu icon base64: {error}"))?;
        if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("Menu icon must be a PNG".into());
        }
        let data = NSData::from_vec(bytes);
        // Decode eagerly: NSImage can accept corrupt data and defer failure until drawing.
        let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &data)
            .ok_or("Could not decode menu icon PNG")?;
        if bitmap.pixelsWide() != 48 || bitmap.pixelsHigh() != 48 {
            return Err("Menu icon PNG must be 48px square".into());
        }
        bitmap.setSize(NSSize::new(16.0, 16.0));
        let image = NSImage::initWithSize(NSImage::alloc(), NSSize::new(16.0, 16.0));
        image.addRepresentation(&bitmap);
        image.setTemplate(true);
        Ok(image)
    }

    fn swatch(color: &str) -> Option<Retained<NSImage>> {
        let hex = color.strip_prefix('#')?;
        if !matches!(hex.len(), 6 | 8) || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let red = u8::from_str_radix(&hex[0..2], 16).ok()?;
        let green = u8::from_str_radix(&hex[2..4], 16).ok()?;
        let blue = u8::from_str_radix(&hex[4..6], 16).ok()?;
        let alpha = if hex.len() == 8 {
            u8::from_str_radix(&hex[6..8], 16).ok()?
        } else {
            255
        };
        // A 2x bitmap keeps the dot sharp without making it a template image.
        // SAFETY: Null planes asks AppKit to own a 32x32, non-planar RGBA buffer.
        let bitmap = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bitmapFormat_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(), std::ptr::null_mut(), 32, 32, 8, 4, true, false,
                NSDeviceRGBColorSpace, NSBitmapFormat::AlphaNonpremultiplied, 128, 32,
            )
        }?;
        let pointer = bitmap.bitmapData();
        if pointer.is_null() {
            return None;
        }
        // SAFETY: The owned representation above has exactly 32 rows of 128 bytes.
        let pixels = unsafe { std::slice::from_raw_parts_mut(pointer, 32 * 128) };
        for y in 0..32 {
            for x in 0..32 {
                let distance = ((x as f64 - 15.5).powi(2) + (y as f64 - 15.5).powi(2)).sqrt();
                let coverage = (14.5 - distance).clamp(0.0, 1.0);
                let rgba = if distance > 12.5 {
                    [128, 128, 128, (coverage * 255.0) as u8]
                } else {
                    [red, green, blue, (coverage * alpha as f64) as u8]
                };
                pixels[(y * 32 + x) * 4..(y * 32 + x + 1) * 4].copy_from_slice(&rgba);
            }
        }
        bitmap.setSize(NSSize::new(16.0, 16.0));
        let image = NSImage::initWithSize(NSImage::alloc(), NSSize::new(16.0, 16.0));
        image.addRepresentation(&bitmap);
        image.setTemplate(false);
        Some(image)
    }

    // SAFETY: NSObject has no subclass requirements; all access stays on the main thread.
    define_class!(
        #[unsafe(super = NSObject)]
        #[name = "StashOutlineMenuTarget"]
        #[thread_kind = MainThreadOnly]
        #[ivars = Cell<Option<usize>>]
        struct Target;
        unsafe impl NSObjectProtocol for Target {}
        impl Target {
            #[unsafe(method(choose:))]
            fn choose(&self, item: &NSMenuItem) {
                self.ivars().set(Some(item.tag() as usize));
            }
        }
    );

    fn shortcut(binding: Option<&str>) -> (String, Flags) {
        let mut flags = Flags::empty();
        let mut key = String::new();
        for part in binding.unwrap_or("").split('+') {
            match part {
                "Mod" | "Meta" => flags |= Flags::Command,
                "Ctrl" => flags |= Flags::Control,
                "Alt" => flags |= Flags::Option,
                "Shift" => flags |= Flags::Shift,
                "Backspace" => key = "\u{8}".into(),
                "Delete" => key = "\u{f728}".into(),
                "Enter" => key = "\r".into(),
                "Escape" => key = "\u{1b}".into(),
                "Tab" => key = "\t".into(),
                "Space" => key = " ".into(),
                "ArrowUp" => key = "\u{f700}".into(),
                "ArrowDown" => key = "\u{f701}".into(),
                "ArrowLeft" => key = "\u{f702}".into(),
                "ArrowRight" => key = "\u{f703}".into(),
                "Home" => key = "\u{f729}".into(),
                "End" => key = "\u{f72b}".into(),
                "PageUp" => key = "\u{f72c}".into(),
                "PageDown" => key = "\u{f72d}".into(),
                value if value.starts_with('F') => {
                    if let Ok(number @ 1..=35) = value[1..].parse::<u32>() {
                        key = char::from_u32(0xf704 + number - 1).unwrap().to_string();
                    }
                }
                value => key = value.to_lowercase(),
            }
        }
        (key, flags)
    }

    pub fn popup(
        window: tauri::WebviewWindow,
        actions: Vec<Action>,
        x: f64,
        y: f64,
        above: bool,
        tracking_id: Option<String>,
    ) -> Result<Option<usize>, String> {
        let mtm = MainThreadMarker::new().ok_or("Menu must run on the main thread")?;
        let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str(""));
        menu.setAutoenablesItems(false);
        // SAFETY: Target inherits NSObject's initializer. It outlives synchronous menu tracking.
        let target: Retained<Target> =
            unsafe { msg_send![super(Target::alloc(mtm).set_ivars(Cell::new(None))), init] };
        for (index, action) in actions.iter().enumerate() {
            if action.separator {
                menu.addItem(&NSMenuItem::separatorItem(mtm));
            }
            let (key, flags) = shortcut(action.shortcut.as_deref());
            // SAFETY: choose: is defined above with the NSMenuItem action signature.
            let item = unsafe {
                NSMenuItem::initWithTitle_action_keyEquivalent(
                    NSMenuItem::alloc(mtm),
                    &NSString::from_str(&action.label),
                    Some(sel!(choose:)),
                    &NSString::from_str(&key),
                )
            };
            unsafe {
                item.setTarget(Some(&target));
            }
            item.setTag(index as isize);
            item.setEnabled(!action.disabled);
            item.setKeyEquivalentModifierMask(flags);
            if action.checked {
                item.setState(NSControlStateValueOn);
            }
            if let Some(image) = action.color.as_deref().and_then(swatch) {
                item.setImage(Some(&image));
            } else if let Some(encoded) = action.icon_png.as_deref() {
                match template_icon(encoded) {
                    Ok(image) => item.setImage(Some(&image)),
                    Err(error) => {
                        eprintln!("Could not prepare menu icon for {}: {error}", action.label)
                    }
                }
            }

            menu.addItem(&item);
        }
        let pointer = window.ns_view().map_err(|e| e.to_string())?;
        // SAFETY: Tauri owns this NSView; the retained window stays alive throughout tracking.
        let view = unsafe { &*pointer.cast::<NSView>() };
        // NSMenu lays out in points and AppKit handles collisions with screen edges.
        let location = NSPoint::new(
            x,
            view.frame().size.height - y + if above { menu.size().height } else { 0.0 },
        );
        if let Some(id) = tracking_id.as_ref() {
            TRACKING.with(|tracking| {
                *tracking.borrow_mut() = Some((window.label().to_owned(), id.clone(), menu.clone()))
            });
        }
        menu.popUpMenuPositioningItem_atLocation_inView(None, location, Some(view));
        if let Some(id) = tracking_id {
            TRACKING.with(|tracking| {
                if tracking
                    .borrow()
                    .as_ref()
                    .is_some_and(|(_, token, _)| token == &id)
                {
                    *tracking.borrow_mut() = None;
                }
            });
        }
        Ok(target.ivars().get())
    }

    #[test]
    fn png_icons_are_sized_template_images() {
        // A transparent 48px plus, captured from a browser canvas.
        let png = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAA20lEQVR4AeyVUQ6EIAxEd/f+d17xD5sGCXXGGJ+RxAJtmXkm/D4PfxBwN0AIQKDoAL9Q0cByOgTKFhYLQKBoYDldSeDfTtePFl7/KgVcf9qkIgISU6xTELDanTSDQGKKdepNBKzGTjdbIdDfrqPveIjR3n4t5g3jFQHDgu5FBLgdj/1WCHxbkZnRth3emZx9zyHpLFgRcFbTuo4Aq91JMwgkplinIGC1O2kGgcQU65SSwH6r9kMiTClAcuBYFAHREXcMAbfjsZ+GQOwijBEgNHeqNASmbBJuejyBDQAA///eMOLwAAAABklEQVQDABHeGGFhfoo5AAAAAElFTkSuQmCC";
        let image = template_icon(png).expect("valid PNG");
        assert!(image.isTemplate());
        assert_eq!(image.size(), NSSize::new(16.0, 16.0));
        assert!(image.TIFFRepresentation().is_some());
    }

    #[test]
    fn rejects_invalid_menu_images() {
        use base64::Engine;
        for invalid in [
            "".to_owned(),
            "!!!".into(),
            "aGVsbG8=".into(),
            "A".repeat(64 * 1024 + 1),
            base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\ntruncated"),
        ] {
            assert!(template_icon(&invalid).is_err());
        }
    }

    #[test]
    fn shortcuts_keep_modifier_and_special_key_semantics() {
        let (key, flags) = shortcut(Some("Mod+Shift+Backspace"));
        assert_eq!(key, "\u{8}");
        assert_eq!(flags, Flags::Command | Flags::Shift);
        assert_eq!(
            shortcut(Some("Alt+F12")),
            ("\u{f70f}".into(), Flags::Option)
        );
        assert_eq!(shortcut(None), (String::new(), Flags::empty()));
    }

    #[test]
    fn color_swatches_keep_color_and_alpha_without_template_tinting() {
        for color in ["#216f9c", "#5b9cd440"] {
            let image = swatch(color).expect("valid palette color");
            assert!(!image.isTemplate());
            assert_eq!(image.size(), NSSize::new(16.0, 16.0));
            assert!(image.TIFFRepresentation().is_some());
        }
        for color in ["red", "#12", "#ffffffzz", "#éfffff"] {
            assert!(swatch(color).is_none());
        }
    }
}
