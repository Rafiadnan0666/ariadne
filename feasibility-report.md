# Tauri 2 + WebView2 Feasibility Investigation for Chrome-like Desktop Browser

## Environment Summary
- **OS**: Windows 10 Home Single Language (Windows 10+ supported by Tauri)
- **Node.js**: v26.2.0
- **npm**: 11.13.0
- **Rust**: 1.100.0 (meets all requirements)
- **WebView2**: v158.0.4370.33 (installed)
- **Tauri 2 Stable**: v2.12.7 (released 2026-11-18)

## Feasibility Verdict: **LIMITED**

Tauri 2 + WebView2 is **partially viable** for building a Chrome-like desktop browser. Core browser features (navigation, cookies, sessions) are supported via stable APIs, but **multiple independent tabs within a single window require the `unstable` feature flag**.

---

## Supported Features (via Stable APIs)

### 1. Multiple Independent Browser Tabs
- **Method**: `Window::add_child()` (requires `unstable` feature) OR separate `WebviewWindow` instances (stable)
- **Supported on**: Windows, macOS, Linux (X11)
- **Implementation**: Create child webviews inside a main window at different positions/bounds
- **Profile isolation**: Each tab can have its own `profile_identifier` (WebView2 profile) for complete data isolation
- **Stable**: **NO** - `add_child` requires `unstable` feature flag. Alternative: Use separate `WebviewWindow` instances (stable but creates separate OS windows)

### 2. Persistent Sessions, Cookies, Authentication
- **Method**: `profile_identifier` in `WebviewAttributes`
- **Supported on**: Windows (WebView2 profiles), macOS (WKWebsiteDataStore)
- **Implementation**: Each webview uses a unique 16-byte profile identifier for isolated data stores
- **Cookie APIs**: `cookies()`, `cookies_for_url()`, `set_cookie()`, `delete_cookie()` available
- **Stable**: Yes - profile management APIs are stable

### 3. Navigation and Browser History
- **Method**: `navigate()`, `reload()`, `on_navigation()` callback
- **History control**: `on_navigation` callback allows cancelling/allowing navigations
- **URL getter**: `url()` returns current URL
- **Limitation**: No built-in `go_back`/`go_forward` APIs. Browser history must be implemented manually by tracking URL changes
- **Stable**: Yes

### 4. Downloads
- **Method**: `on_download()` callback in `WebviewBuilder`
- **Events**: `DownloadEvent::Requested { url, destination }` and `DownloadEvent::Finished { url, path, success }`
- **Implementation**: Can modify download destination, track progress
- **Stable**: Yes

### 5. Uploads
- **Method**: Standard HTML file input + WebView2's built-in handling
- **Implementation**: Tauri webview passes through native file dialogs
- **Stable**: Yes (WebView2 native behavior)

### 6. Popups / New Windows
- **Method**: `on_new_window()` callback
- **Response types**: `NewWindowResponse::Create`, `NewWindowResponse::Deny`, `NewWindowResponse::Allow`
- **Features**: NewWindowFeatures includes webview configuration sharing
- **Stable**: Yes

### 7. Website Permissions
- **Method**: `on_permission_request()` callback
- **Supported kinds**: Camera, Microphone, Geolocation, Notifications, ClipboardRead, DisplayCapture, Midi, Sensors, MediaKeySystemAccess, LocalFonts, WindowManagement, PointerLock, AutomaticDownloads, FileSystemAccess, Autoplay
- **Implementation**: Return `PermissionResponse::Allow/Deny/Default`
- **Stable**: Yes

### 8. Cross-Tab Communication
- **Method**: Tauri's IPC + `emit()`/`listen()` events
- **Implementation**: Use `app.emit()` to broadcast to all webviews, `webview.listen()` to receive
- **Stable**: Yes

### 9. Page Inspection, Text Extraction, Screenshots
- **Text extraction**: `eval_script()` / `eval_script_with_callback()` for DOM querying
- **DevTools**: `open_devtools()`, `close_devtools()`, `is_devtools_open()` (requires `devtools` feature or debug builds)
- **Screenshots**: **NOT directly supported**. Must use external screenshot crate (e.g., `screenshots` crate) or Windows API
- **Stable**: Text extraction stable; Screenshots require external solution

### 10. Injecting Scripts
- **Method**: `eval_script()`, `eval_script_with_callback()`, `initialization_script()`
- **Implementation**: Can inject arbitrary JavaScript to read/click/fill elements
- **Stable**: Yes

### 11. Sites That Block Iframe Embedding
- **Method**: Each tab is a separate WebView2 instance, not an iframe
- **Implementation**: `add_child` creates independent webview instances (requires unstable)
- **Stable**: Requires `unstable` feature for child webviews

---

## Unsupported / Unstable Features

### 1. Multiple Child Webviews in Single Window
- **Status**: **Requires `unstable` feature flag**
- **Workaround**: Enable `unstable` feature in Cargo.toml, or use separate `WebviewWindow` instances (creates separate OS windows)
- **Complexity**: Low (just add feature flag) but API may change

### 2. Native Browser History (Back/Forward)
- **Status**: Not available
- **Workaround**: Track URL changes manually via `on_navigation` callback and maintain history stack
- **Complexity**: Medium

### 3. Native Screenshots
- **Status**: Not available in Tauri 2 webview API
- **Workaround**: Use external crate (e.g., `screenshots`, `xcap`) or Windows Graphics Capture API
- **Complexity**: Medium (requires external dependency)

### 4. Native Find-in-Page
- **Status**: Not available in Tauri webview API
- **Workaround**: Inject JavaScript `window.find()` or implement custom search
- **Complexity**: Low

### 5. Download Progress Tracking
- **Status**: Only `Requested` and `Finished` events, no progress updates
- **Workaround**: Implement custom download via HTTP client for progress tracking
- **Complexity**: Medium

### 6. DevTools in Release Builds
- **Status**: Requires `devtools` feature flag (not enabled by default)
- **Workaround**: Enable `devtools` feature in `Cargo.toml` for release builds
- **Note**: On macOS, requires calling private APIs - not recommended for App Store

### 7. True Tab Reordering / Drag-and-Drop
- **Status**: Not built-in
- **Workaround**: Implement custom drag-and-drop in frontend, use `set_bounds()` to reposition webviews
- **Complexity**: High (requires careful Z-order management)

### 8. Webview Z-Order / Overlapping Tabs
- **Status**: Child webviews don't support native z-ordering well
- **Workaround**: Use `hide()`/`show()` to switch between tabs
- **Complexity**: Medium

---

## Workaround Notes for Unstable Features

### Enable Unstable Feature (Cargo.toml):
```toml
[dependencies]
tauri = { version = "2", features = ["unstable", "devtools"] }
```

### For Multiple Tabs (Requires unstable):
```rust
let window = tauri::Window::builder(app, "main").build()?;

let webview = window.add_child(
    tauri::webview::WebviewBuilder::new("tab-1", WebviewUrl::External("https://example.com".parse().unwrap()))
        .profile_identifier([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    tauri::LogicalPosition::new(0, 80),
    tauri::LogicalSize::new(800, 520),
)?;
```

### For History (Manual):
```rust
let mut history: Vec<Url> = vec![];
let mut current_index = 0;

webview.on_navigation(move |url| {
    history.truncate(current_index + 1);
    history.push(url.clone());
    current_index = history.len() - 1;
    true
});
```

### For Screenshots (External):
```rust
// Use xcap or screenshots crate
use xcap::Window;
let window = Window::all().unwrap()[0];
let image = window.capture_image().unwrap();
```

---

## Proof-of-Concept: Multiple WebView2 Tabs in Tauri 2

### src-tauri/Cargo.toml
```toml
[package]
name = "tauri-browser"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["unstable", "devtools"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

### src-tauri/src/main.rs
```rust
use tauri::{
    Manager, WebviewBuilder, WebviewUrl, WebviewWindowBuilder,
};
use std::sync::Mutex;

#[derive(Default)]
struct AppState {
    tabs: Mutex<Vec<String>>,
    active_tab: Mutex<Option<String>>,
}

#[tauri::command]
async fn create_tab(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    
    let label = format!("tab-{}", uuid::Uuid::new_v4());
    
    let webview = window.add_child(
        WebviewBuilder::new(&label, WebviewUrl::External(url.parse().unwrap()))
            .on_navigation(|url| {
                println!("Navigating to: {}", url);
                true
            })
            .on_new_window(|url, _features| {
                tauri::webview::NewWindowResponse::Create
            })
            .profile_identifier([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
        tauri::LogicalPosition::new(0, 80),
        tauri::LogicalSize::new(800, 520),
    ).map_err(|e| e.to_string())?;
    
    webview.hide().map_err(|e| e.to_string())?;
    
    Ok(label)
}

#[tauri::command]
async fn switch_tab(app: tauri::AppHandle, tab_id: String) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    
    for webview in window.webviews() {
        let _ = webview.hide();
    }
    
    if let Some(webview) = window.get_webview(&tab_id) {
        webview.show().map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn navigate_tab(app: tauri::AppHandle, tab_id: String, url: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&tab_id) {
        webview.navigate(url.parse().unwrap()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_tab(app: tauri::AppHandle, tab_id: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&tab_id) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            create_tab,
            switch_tab,
            navigate_tab,
            close_tab
        ])
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Tauri Browser")
                .inner_size(1024.0, 768.0)
                .build()?;
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### src/index.html
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Tauri Browser</title>
    <style>
        body { margin: 0; font-family: sans-serif; }
        .toolbar { height: 40px; background: #f0f0f0; display: flex; align-items: center; padding: 0 10px; }
        .tab-bar { height: 40px; background: #e0e0e0; display: flex; }
        .tab { padding: 10px 20px; cursor: pointer; border-right: 1px solid #ccc; }
        .tab.active { background: #fff; }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="new-tab">+ New Tab</button>
        <input id="url-bar" type="text" placeholder="Enter URL..." style="flex: 1; margin: 0 10px;">
        <button id="go">Go</button>
    </div>
    <div class="tab-bar" id="tab-bar"></div>
    
    <script type="module">
        import { invoke } from '@tauri-apps/api/core';
        
        let tabs = [];
        let activeTab = null;
        
        document.getElementById('new-tab').addEventListener('click', async () => {
            const url = 'https://www.google.com';
            const tabId = await invoke('create_tab', { url });
            tabs.push(tabId);
            
            const tabEl = document.createElement('div');
            tabEl.className = 'tab';
            tabEl.textContent = `Tab ${tabs.length}`;
            tabEl.dataset.tabId = tabId;
            tabEl.addEventListener('click', () => switchTab(tabId));
            document.getElementById('tab-bar').appendChild(tabEl);
            
            switchTab(tabId);
        });
        
        async function switchTab(tabId) {
            await invoke('switch_tab', { tabId });
            activeTab = tabId;
            
            document.querySelectorAll('.tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tabId === tabId);
            });
        }
        
        document.getElementById('go').addEventListener('click', async () => {
            const url = document.getElementById('url-bar').value;
            if (activeTab) {
                await invoke('navigate_tab', { tabId: activeTab, url });
            }
        });
    </script>
</body>
</html>
```

---

## Summary

### Verdict: **LIMITED** (Not fully viable for a complete Chrome-like browser without workarounds)

**What Works Well:**
- ✅ Multiple independent webviews (not iframes) - requires `unstable` feature
- ✅ Persistent sessions via WebView2 profiles
- ✅ Navigation control
- ✅ Downloads/uploads
- ✅ Popups/new windows
- ✅ Website permissions
- ✅ Cross-tab communication via IPC
- ✅ Script injection
- ✅ Sites that block iframe embedding (no iframes used)

**What's Missing/Requires Workarounds:**
- ❌ Multiple child webviews require `unstable` feature flag
- ❌ Native browser history (back/forward) - must implement manually
- ❌ Native screenshots - requires external crate
- ❌ Native find-in-page - requires JavaScript injection
- ❌ Download progress tracking - only start/finish events
- ❌ True tab reordering with drag-and-drop - requires complex UI work
- ❌ Webview z-ordering for overlapping tabs - requires hide/show workaround

**Recommendation:**
Tauri 2 + WebView2 can serve as a **foundation** for a desktop browser, but significant custom development is needed for features that Chrome provides natively. For a production browser, consider:
1. Enabling `unstable` feature for child webviews
2. Implementing history manually
3. Using external crates for screenshots
4. Building custom UI for all browser chrome elements

**Alternative Consideration:**
For a more complete browser experience with less workaround effort, consider:
- **Electron** (has more mature browser APIs)
- **CEF (Chromium Embedded Framework)** via Rust bindings
- **Servo** (Rust-native browser engine, but less mature)
