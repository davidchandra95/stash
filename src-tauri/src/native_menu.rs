//! AppKit template images follow menu selection, disabled state and appearance.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    label: String,
    symbol: String,
    disabled: bool,
    separator: bool,
    shortcut: Option<String>,
}

#[tauri::command]
pub async fn show_outline_menu(
    window: tauri::WebviewWindow,
    actions: Vec<Action>,
    x: f64,
    y: f64,
) -> Result<Option<usize>, String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let owner = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = send.send(macos::popup(owner, actions, x, y));
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())??
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, actions, x, y);
        Err("Outline native menus require macOS".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::Action;
    use objc2::rc::Retained;
    use objc2::{define_class, msg_send, sel, ClassType, DefinedClass, MainThreadOnly};
    use objc2_app_kit::{NSEventModifierFlags as Flags, NSImage, NSMenu, NSMenuItem, NSView};
    use objc2_foundation::{
        MainThreadMarker, NSObject, NSObjectProtocol, NSPoint, NSSize, NSString,
    };
    use std::cell::Cell;

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
            // SF Symbols are available starting in macOS 11. Older systems omit the icon.
            if NSImage::class()
                .class_method(sel!(imageWithSystemSymbolName:accessibilityDescription:))
                .is_some()
            {
                if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
                    &NSString::from_str(&action.symbol),
                    None,
                ) {
                    image.setTemplate(true);
                    image.setSize(NSSize::new(16.0, 16.0));
                    item.setImage(Some(&image));
                }
            }
            menu.addItem(&item);
        }
        let pointer = window.ns_view().map_err(|e| e.to_string())?;
        // SAFETY: Tauri owns this NSView; the retained window stays alive throughout tracking.
        let view = unsafe { &*pointer.cast::<NSView>() };
        let location = NSPoint::new(x, view.frame().size.height - y);
        menu.popUpMenuPositioningItem_atLocation_inView(None, location, Some(view));
        Ok(target.ivars().get())
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
}

#[cfg(all(test, target_os = "macos"))]
mod image_tests {
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSString;
    #[test]
    fn menu_symbols_are_available_as_template_images() {
        for name in [
            "arrow.down",
            "arrow.up",
            "arrow.up.right.square",
            "square.and.pencil",
            "doc.on.doc",
            "folder",
            "folder.badge.plus",
            "link",
            "pencil",
            "pin",
            "pin.slash",
            "arrow.clockwise",
            "arrow.counterclockwise",
            "star",
            "star.slash",
            "trash",
        ] {
            let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
                &NSString::from_str(name),
                None,
            )
            .unwrap_or_else(|| panic!("Missing symbol: {name}"));
            image.setTemplate(true);
            assert!(image.isTemplate());
        }
    }
}
