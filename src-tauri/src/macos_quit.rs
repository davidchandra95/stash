//! AppKit's predefined Quit menu calls terminate: directly, bypassing Tauri's
//! ExitRequested event. Add the optional delegate veto so menu, Cmd+Q and Dock
//! quit all use the same save handshake as window close. Do not replace any
//! existing delegate implementation if a future Tao version adds one.
use objc2::{
    runtime::{AnyClass, AnyObject, Imp, Sel},
    MainThreadMarker,
};
use objc2_app_kit::NSApplication;
use std::sync::OnceLock;
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
unsafe extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: &AnyObject) -> usize {
    match APP.get() {
        Some(app) if crate::storage::bridge::request_quit(app) => 0, // NSTerminateCancel
        _ => 1, // NSTerminateNow (before editing is enabled or after save completion)
    }
}
pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let mtm =
        MainThreadMarker::new().ok_or("The quit handler must be installed on the main thread")?;
    let application = NSApplication::sharedApplication(mtm);
    let delegate = application
        .delegate()
        .ok_or("Missing AppKit application delegate")?;
    let object: &AnyObject = (*delegate).as_ref();
    let class = object.class();
    let selector = objc2::sel!(applicationShouldTerminate:);
    if class.instance_method(selector).is_some() {
        return Err("AppKit quit delegate changed; the save guard needs review".into());
    }
    APP.set(app.clone())
        .map_err(|_| "Quit guard was already installed")?;
    // SAFETY: the selector has AppKit's NSUInteger return and (id, SEL, id)
    // signature on 64-bit macOS. The callback is static, has no captured pointers,
    // and the existing delegate's class and all other methods remain unchanged.
    let added = unsafe {
        let implementation: Imp = std::mem::transmute(
            should_terminate as unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize,
        );
        objc2::ffi::class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            selector,
            implementation,
            c"Q@:@".as_ptr(),
        )
    };
    if !added.as_bool() {
        return Err("Could not install the AppKit save-before-quit guard".into());
    }
    // Refresh AppKit's cached optional-delegate-method availability.
    application.setDelegate(Some(&delegate));
    Ok(())
}
