# Android development

Stash shares React, Tiptap, the serialized save queue, Rust, SQLite and the manual sync protocol with desktop. Native platform detection selects the mobile shell. Android is the first mobile target; iOS still needs its own native credentials adapter, project setup and acceptance testing.

## Prerequisites

Install Node/npm, Rust, Java 17, Android SDK platform 36, build tools, Android platform tools, and NDK 28.2.13676358. This workspace uses:

```sh
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
npm install
npm run android:init
npm run tauri -- icon assets/new-logo-icon.png
```

`android:init` uses Tauri to generate `src-tauri/gen/android` and install the Android Rust targets. Do not edit generated Kotlin or Gradle files. App-specific Android code lives in `src-tauri/plugins/stash-platform`. Its Gradle build locates the certificate verifier AAR using Cargo metadata, so it stays matched to Cargo.lock.

## Run and build

```sh
# Native development, with a running emulator or USB device
npm run android:dev

# Fast browser preview, using session-only sample data
npm run dev:mobile

# Self-contained debug APK for modern ARM64 phones and the Pixel emulator
CARGO_PROFILE_DEV_DEBUG=0 npm run android:build -- --target aarch64

# All supported Android architectures
npm run android:build
```

The delivered build uses `CARGO_PROFILE_DEV_DEBUG=0` to omit Rust debug symbols while retaining debug app behavior and WebView inspection. Omit that environment variable when debugging native Rust. The debug APK contains the built frontend and Rust library. It does not need Vite, a computer, or a sync server for offline editing. Its path is `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. The ARM64 command includes only ARM64 even though Tauri calls the output directory `universal`.

```sh
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n local.upnote2.prototype/.MainActivity
```

The package ID is `local.upnote2.prototype`, minimum Android API 24. Debug builds are signed with the local Android debug key. Keep that key to install updates without removing app data. This APK is for sideloading, not store publication.

## App behavior

- Cold launch starts at All notes. The drawer keeps notebook expansion separate from navigation. Notebook detail shows immediate children followed by direct notes, with pinned notes first.
- Existing notes open without requesting the keyboard. New notes focus the wrapping title; Next moves to the body. Back first closes the keyboard or overlay, then returns through page history. At the root, it waits for pending saves before moving the app to the background.
- Editor commands and settings definitions are shared with desktop. Mobile uses native selection handles, a scrollable floating toolbar, and a tools sheet. Short landscape viewports use compact controls and reserve a visible writing line.
- Appearance, Typography, Editor and Sync open as settings pages. Desktop layouts, installed Mac fonts, custom cursor controls and shortcut editing are hidden. Interface, title, body and code typography remain independent.
- Notes and preferences live in private application storage. Mobile writes are scheduled immediately, serialized, and flushed before navigation and on pause/visibility signals. The note header omits routine save status; saves complete only after SQLite acknowledges the write. Failed writes retain their draft and operation ID for Retry.
- Sync runs only when requested. Saving a connection or resuming the app never starts sync. Editing is paused during the existing durable sync cycle, then the library refreshes.
- Android tokens use AES-256-GCM with an Android Keystore key. Only ciphertext is stored in `no_backup`; the token is never written to SQLite or preferences. Missing or invalid keys require reconnecting without deleting notes. Credential loading is unavailable through frontend plugin permissions. macOS keeps its existing Keychain service.
- Native system-bar, cutout and keyboard insets resize the WebView, then are zeroed before reaching it. CSS and VisualViewport handle the remaining browser layout without applying the keyboard height again. This also supports older Android System WebViews.

Folder linking, automatic sync, iOS builds, tablet split panes and store publication are outside this milestone.

## Validation

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run android:build -- --target aarch64
make release
```

Use an isolated server/database for sync acceptance. Never use a real library as a test fixture. The existing two-client HTTP integration test takes a file with device ID on line 1 and token on line 2:

```sh
STASH_SYNC_TEST_DEVICE_FILE=/absolute/path/test.device \
STASH_SYNC_TEST_URL=http://127.0.0.1:18097 \
cargo test --manifest-path src-tauri/Cargo.toml two_sqlite_clients_through_real_http_service -- --ignored
```

Android's platform TLS verifier uses AndroidCAStore, not an application network-security-config. For an isolated localhost HTTPS server with a fixture CA, create a separate debug-only acceptance APK:

```sh
STASH_SYNC_TEST_CA_FILE=/absolute/path/fixture-ca.pem \
npm run android:build -- --target aarch64 --features sync-test-ca
```

This opt-in build verifies TLS using only that fixture CA. It cannot be built in release mode. Normal APKs have no fixture CA or test trust configuration. Always rebuild without the feature before delivery. The normal platform verifier is initialized from the Android application context before networking starts.

See [Android acceptance](ANDROID_ACCEPTANCE.md) for tested behavior and device limits.

References: [Tauri mobile development](https://v2.tauri.app/develop/#developing-your-mobile-application), [Android WebView insets](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets), [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
