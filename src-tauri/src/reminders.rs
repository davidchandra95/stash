//! Task reminders are handed to the operating system, so they appear with Stash closed. The
//! WebView decides what is due (`src/projects/reminders.ts`) and these commands apply it.
//! A snooze is another pending notification, created natively when its action is chosen.
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderEntry {
    pub id: String,
    pub title: String,
    pub body: String,
    pub fire_at: i64,
}
const TASK_PREFIX: &str = "stash.task.";
const SNOOZE_PREFIX: &str = "stash.snooze.";

/// `stash.task.<task>.<minutes>.<anchor>` or `stash.snooze.<task>.<anchor>.<until>`.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn task_and_anchor(id: &str) -> Option<(&str, &str)> {
    let (rest, anchor_at) = match id.strip_prefix(TASK_PREFIX) {
        Some(rest) => (rest, 2),
        None => (id.strip_prefix(SNOOZE_PREFIX)?, 1),
    };
    let fields: Vec<&str> = rest.split('.').collect();
    (fields.len() == 3 && !fields[0].is_empty()).then(|| (fields[0], fields[anchor_at]))
}
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn snooze_id(id: &str, until: i64) -> Option<String> {
    let (task, anchor) = task_and_anchor(id)?;
    Some(format!("{SNOOZE_PREFIX}{task}.{anchor}.{until}"))
}
fn valid_entries(entries: &[ReminderEntry]) -> Result<(), String> {
    if entries.iter().all(|entry| {
        entry.id.starts_with(TASK_PREFIX) && task_and_anchor(&entry.id).is_some()
    }) {
        Ok(())
    } else {
        Err("Invalid reminder.".into())
    }
}
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread};
    use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSSet, NSString};
    use objc2_user_notifications::*;
    use std::ptr::NonNull;
    use std::sync::mpsc::channel;
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{Emitter, Manager};

    const CATEGORY: &str = "stash.reminder";
    const SNOOZES: [(i64, &str); 3] = [(600, "10 minutes"), (3600, "1 hour"), (86400, "1 day")];
    const ANSWER_TIMEOUT: Duration = Duration::from_secs(10);
    /// The permission dialog waits on the person.
    const PROMPT_TIMEOUT: Duration = Duration::from_secs(600);

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static OPEN: Mutex<Option<String>> = Mutex::new(None);

    /// `currentNotificationCenter` raises an uncatchable exception outside an app bundle, which
    /// includes `tauri dev`.
    pub fn available() -> bool {
        let bundle = NSBundle::mainBundle();
        bundle.bundlePath().to_string().ends_with(".app") && bundle.bundleIdentifier().is_some()
    }
    fn center() -> Result<Retained<UNUserNotificationCenter>, String> {
        if available() {
            Ok(UNUserNotificationCenter::currentNotificationCenter())
        } else {
            Err("This version of Stash can’t send notifications.".into())
        }
    }
    fn error_text(error: *mut NSError) -> Option<String> {
        // SAFETY: the system passes either nil or a valid NSError for this call's duration.
        unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string())
    }

    pub fn status() -> Result<String, String> {
        if !available() {
            return Ok("unavailable".into());
        }
        let (sender, receiver) = channel();
        let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: the system passes a valid settings object for this call's duration.
            let _ = sender.send(unsafe { settings.as_ref() }.authorizationStatus());
        });
        center()?.getNotificationSettingsWithCompletionHandler(&callback);
        let status = receiver
            .recv_timeout(ANSWER_TIMEOUT)
            .map_err(|_| "Could not read the notification permission.")?;
        Ok(match status {
            UNAuthorizationStatus::NotDetermined => "notDetermined",
            UNAuthorizationStatus::Denied => "denied",
            _ => "granted",
        }
        .into())
    }
    pub fn request_permission() -> Result<(), String> {
        let (sender, receiver) = channel();
        let callback = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
            let _ = sender.send(error_text(error));
        });
        center()?.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &callback,
        );
        match receiver.recv_timeout(PROMPT_TIMEOUT) {
            Ok(None) => Ok(()),
            Ok(Some(error)) => Err(format!("Could not ask for notification permission. {error}")),
            Err(_) => Err("Could not ask for notification permission.".into()),
        }
    }
    pub fn pending() -> Result<Vec<String>, String> {
        let (sender, receiver) = channel();
        let callback = RcBlock::new(move |requests: NonNull<NSArray<UNNotificationRequest>>| {
            // SAFETY: the system passes a valid array for this call's duration.
            let requests = unsafe { requests.as_ref() };
            let ids: Vec<String> =
                requests.iter().map(|request| request.identifier().to_string()).collect();
            let _ = sender.send(ids);
        });
        center()?.getPendingNotificationRequestsWithCompletionHandler(&callback);
        receiver
            .recv_timeout(ANSWER_TIMEOUT)
            .map_err(|_| "Could not read scheduled reminders.".into())
    }
    fn remove(center: &UNUserNotificationCenter, ids: &[String]) {
        if ids.is_empty() {
            return;
        }
        let ids: Vec<Retained<NSString>> = ids.iter().map(|id| NSString::from_str(id)).collect();
        center.removePendingNotificationRequestsWithIdentifiers(&NSArray::from_retained_slice(&ids));
    }
    pub fn cancel(ids: &[String]) -> Result<(), String> {
        remove(&*center()?, ids);
        Ok(())
    }
    /// Identifiers are kept, so adding one again replaces its text and time.
    fn add(center: &UNUserNotificationCenter, entry: &ReminderEntry) -> Result<(), String> {
        let seconds = (entry.fire_at - now()) as f64 / 1000.0;
        if seconds <= 0.0 {
            return Ok(());
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&entry.title));
        content.setBody(&NSString::from_str(&entry.body));
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(seconds, false);
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&entry.id),
            &content,
            Some(&trigger),
        );
        let (sender, receiver) = channel();
        let callback = RcBlock::new(move |error: *mut NSError| {
            let _ = sender.send(error_text(error));
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&callback));
        match receiver.recv_timeout(ANSWER_TIMEOUT) {
            Ok(None) => Ok(()),
            Ok(Some(error)) => Err(format!("Could not schedule a reminder. {error}")),
            Err(_) => Err("Could not schedule a reminder.".into()),
        }
    }
    pub fn sync(entries: &[ReminderEntry], drop: &[String]) -> Result<(), String> {
        let current = pending()?;
        let center = center()?;
        let stale: Vec<String> = current
            .into_iter()
            .filter(|id| {
                drop.contains(id)
                    || (id.starts_with(TASK_PREFIX) && !entries.iter().any(|entry| entry.id == *id))
            })
            .collect();
        remove(&center, &stale);
        for entry in entries {
            add(&center, entry)?;
        }
        Ok(())
    }
    pub fn take_open() -> Result<Option<String>, String> {
        Ok(OPEN.lock().map_err(|_| "Could not open that reminder's task.")?.take())
    }
    pub fn open_settings() -> Result<(), String> {
        let status = std::process::Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
            .status()
            .map_err(|error| format!("Could not open System Settings. {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not open System Settings.".into())
        }
    }

    fn snooze(response: &UNNotificationResponse, seconds: i64) {
        let request = response.notification().request();
        let content = request.content();
        let until = now() + seconds * 1000;
        let Some(id) = snooze_id(&request.identifier().to_string(), until) else {
            eprintln!("Reminder snooze ignored an unknown notification");
            return;
        };
        let entry = ReminderEntry {
            id,
            title: content.title().to_string(),
            body: content.body().to_string(),
            fire_at: until,
        };
        // This runs on the notification queue, so its completion can't be awaited here.
        std::thread::spawn(move || {
            if let Err(error) = center().and_then(|center| add(&center, &entry)) {
                eprintln!("{error}");
            }
            if let Some(app) = APP.get() {
                let _ = app.emit("task-reminders-changed", ());
            }
        });
    }
    fn opened(response: &UNNotificationResponse) {
        let id = response.notification().request().identifier().to_string();
        let Some((task, _)) = task_and_anchor(&id) else { return };
        if let Ok(mut open) = OPEN.lock() {
            *open = Some(task.to_string());
        }
        if let Some(app) = APP.get() {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("task-reminder-open", ());
        }
    }

    // SAFETY: NSObject has no subclass requirements. The delegate holds no state and its
    // callbacks use only thread-safe statics, so any queue may call them.
    define_class!(
        #[unsafe(super = NSObject)]
        #[name = "StashReminderDelegate"]
        struct Delegate;
        unsafe impl NSObjectProtocol for Delegate {}
        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                handler.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                handler: &block2::DynBlock<dyn Fn()>,
            ) {
                let action = response.actionIdentifier().to_string();
                if let Some(seconds) = action.strip_prefix("snooze.").and_then(|s| s.parse().ok()) {
                    snooze(response, seconds);
                } else if &*response.actionIdentifier()
                    == unsafe { UNNotificationDefaultActionIdentifier }
                {
                    opened(response);
                }
                handler.call(());
            }
        }
    );

    /// Must run during launch, so a click that launched the app still reaches the delegate.
    pub fn install(app: &AppHandle) {
        if !available() || APP.set(app.clone()).is_err() {
            return;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let actions: Vec<Retained<UNNotificationAction>> = SNOOZES
            .iter()
            .map(|(seconds, label)| {
                UNNotificationAction::actionWithIdentifier_title_options(
                    &NSString::from_str(&format!("snooze.{seconds}")),
                    &NSString::from_str(&format!("Snooze {label}")),
                    UNNotificationActionOptions::empty(),
                )
            })
            .collect();
        let category = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
            &NSString::from_str(CATEGORY),
            &NSArray::from_retained_slice(&actions),
            &NSArray::new(),
            UNNotificationCategoryOptions::empty(),
        );
        center.setNotificationCategories(&NSSet::from_retained_slice(&[category]));
        // SAFETY: plain allocation of an ivar-less NSObject subclass.
        let delegate: Retained<Delegate> = unsafe { msg_send![Delegate::alloc(), init] };
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // The center holds its delegate weakly, and this one lives as long as the app.
        std::mem::forget(delegate);
    }
}

#[cfg(target_os = "android")]
mod platform {
    use super::*;
    use tauri_plugin_stash_platform::PlatformExt;
    pub fn status(app: &AppHandle) -> Result<String, String> {
        app.stash_platform().reminder_status()
    }
    pub fn request_permission(app: &AppHandle) -> Result<(), String> {
        app.stash_platform().reminder_request_permission()
    }
    pub fn pending(app: &AppHandle) -> Result<Vec<String>, String> {
        app.stash_platform().reminder_pending()
    }
    pub fn sync(app: &AppHandle, entries: &[ReminderEntry], drop: &[String]) -> Result<(), String> {
        let entries = serde_json::to_value(entries).map_err(|error| error.to_string())?;
        app.stash_platform().reminder_sync(entries, drop)
    }
    pub fn cancel(app: &AppHandle, ids: &[String]) -> Result<(), String> {
        app.stash_platform().reminder_cancel(ids)
    }
    pub fn take_open(app: &AppHandle) -> Result<Option<String>, String> {
        app.stash_platform().reminder_take_open()
    }
    pub fn open_settings(app: &AppHandle) -> Result<(), String> {
        app.stash_platform().reminder_open_settings()
    }
}

#[cfg(target_os = "macos")]
pub use platform::install;

#[cfg(not(any(target_os = "macos", target_os = "android")))]
const UNSUPPORTED: &str = "This version of Stash can’t send notifications.";

// Worker threads: these wait on system answers, which must not block the main thread.
#[tauri::command(async)]
pub fn reminder_status(app: AppHandle) -> Result<String, String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    return platform::status();
    #[cfg(target_os = "android")]
    return platform::status(&app);
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    Ok("unavailable".into())
}
#[tauri::command(async)]
pub fn reminder_request_permission(app: AppHandle) -> Result<(), String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    return platform::request_permission();
    #[cfg(target_os = "android")]
    return platform::request_permission(&app);
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    Err(UNSUPPORTED.into())
}
#[tauri::command(async)]
pub fn reminder_pending(app: AppHandle) -> Result<Vec<String>, String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    return platform::pending();
    #[cfg(target_os = "android")]
    return platform::pending(&app);
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    Ok(Vec::new())
}
#[tauri::command(async)]
pub fn reminder_sync(app: AppHandle, entries: Vec<ReminderEntry>, drop: Vec<String>) -> Result<(), String> {
    let _ = &app;
    valid_entries(&entries)?;
    #[cfg(target_os = "macos")]
    return platform::sync(&entries, &drop);
    #[cfg(target_os = "android")]
    return platform::sync(&app, &entries, &drop);
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    {
        let _ = drop;
        Err(UNSUPPORTED.into())
    }
}
#[tauri::command(async)]
pub fn reminder_cancel(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    return platform::cancel(&ids);
    #[cfg(target_os = "android")]
    return platform::cancel(&app, &ids);
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    {
        let _ = ids;
        Err(UNSUPPORTED.into())
    }
}
#[tauri::command(async)]
pub fn reminder_take_open(app: AppHandle) -> Result<Option<String>, String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    return platform::take_open();
    #[cfg(target_os = "android")]
    return platform::take_open(&app);
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    Ok(None)
}
#[tauri::command(async)]
pub fn reminder_open_settings(app: AppHandle) -> Result<(), String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    return platform::open_settings();
    #[cfg(target_os = "android")]
    return platform::open_settings(&app);
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    Err(UNSUPPORTED.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snooze_ids_keep_the_task_and_anchor() {
        assert_eq!(snooze_id("stash.task.t-1.15.1000", 5000).as_deref(), Some("stash.snooze.t-1.1000.5000"));
        assert_eq!(snooze_id("stash.snooze.t-1.1000.5000", 9000).as_deref(), Some("stash.snooze.t-1.1000.9000"));
        assert_eq!(snooze_id("other.t-1.15.1000", 5000), None);
        assert_eq!(snooze_id("stash.task.t-1.15", 5000), None);
    }
    #[test]
    fn sync_accepts_only_task_reminders() {
        let entry = |id: &str| ReminderEntry { id: id.into(), title: "T".into(), body: "B".into(), fire_at: 1 };
        assert!(valid_entries(&[entry("stash.task.t.0.1")]).is_ok());
        assert!(valid_entries(&[entry("stash.snooze.t.1.2")]).is_err());
        assert!(valid_entries(&[entry("stash.task.t.0")]).is_err());
    }
}
