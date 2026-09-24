mod config;
mod forecast;
mod providers;
mod research;
mod state;
mod types;

use crate::config::normalize_config;
use crate::forecast::{forecast_usage, now_millis, timestamp_from_millis, Observation};
use crate::providers::{claude, codex};
use crate::state::{AppInner, AppState, REFRESH_INTERVAL_MS};
use crate::types::{ConfigPayload, DiagnosticEntry, ProviderId, ResearchReport, UsageSnapshot, UsageSnapshotPayload, ViewKind, WindowId};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Window};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
fn usage_get(state: tauri::State<'_, AppState>) -> UsageSnapshotPayload {
    state.usage_payload()
}

#[tauri::command]
async fn usage_refresh(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    refresh_usage(app, state.inner().clone(), true).await;
    Ok(())
}

#[tauri::command]
fn config_get(state: tauri::State<'_, AppState>) -> ConfigPayload {
    state.config_payload()
}

#[tauri::command]
async fn config_set(app: AppHandle, state: tauri::State<'_, AppState>, next_config: Value) -> Result<ConfigPayload, String> {
    let state = state.inner().clone();
    let _refresh = state.refresh_gate.lock().await;
    let mut next = normalize_config(&next_config);
    let startup_supported = state.lock().startup_supported;
    if startup_supported {
        let manager = app.autolaunch();
        if next.launch_at_login {
            manager.enable().map_err(|_| "Could not enable launch at login".to_string())?;
        } else {
            manager.disable().map_err(|_| "Could not disable launch at login".to_string())?;
        }
        next.launch_at_login = manager.is_enabled().unwrap_or(false);
    } else {
        next.launch_at_login = false;
    }
    {
        let mut inner = state.lock();
        crate::config::save_config(&inner.config_file, &next)?;
        inner.config = next;
        let research_enabled = inner.config.local_research;
        inner.research.set_enabled(research_enabled);
        inner.history.clear();
        push_diagnostic(&mut inner, "info", ProviderId::System, "Preferences saved", None);
    }
    drop(_refresh);
    refresh_usage(app, state.clone(), true).await;
    Ok(state.config_payload())
}

#[tauri::command]
fn research_get(state: tauri::State<'_, AppState>) -> ResearchReport {
    state.lock().research.report()
}

#[tauri::command]
fn research_save(state: tauri::State<'_, AppState>, answers: Value) -> ResearchReport {
    state.lock().research.save(&answers)
}

#[tauri::command]
fn research_clear(state: tauri::State<'_, AppState>) -> ResearchReport {
    state.lock().research.clear()
}

#[tauri::command]
fn research_copy(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let report = state.lock().research.report();
    let serialized = serde_json::to_string_pretty(&report).map_err(|_| "Could not prepare the local study report".to_string())?;
    app.clipboard().write_text(serialized).map_err(|_| "Could not copy the report to the clipboard".to_string())
}

#[tauri::command]
fn window_dashboard(app: AppHandle, state: tauri::State<'_, AppState>) {
    show_dashboard(&app, state.inner());
}

#[tauri::command]
fn window_hide(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
}

#[tauri::command]
fn app_quit(app: AppHandle, state: tauri::State<'_, AppState>) {
    state.lock().quitting = true;
    app.exit(0);
}

fn push_diagnostic(inner: &mut AppInner, level: &str, provider_id: ProviderId, message: &str, account_label: Option<&str>) {
    inner.log_sequence += 1;
    inner.diagnostics.insert(0, DiagnosticEntry {
        id: format!("{}-{}", now_millis(), inner.log_sequence),
        level: level.to_string(),
        provider_id,
        account_label: account_label.map(ToOwned::to_owned),
        message: message.to_string(),
        timestamp: crate::forecast::timestamp_now(),
    });
    inner.diagnostics.truncate(100);
}

fn publish(app: &AppHandle, state: &AppState) {
    let _ = app.emit("usage:updated", state.usage_payload());
}

fn show_dashboard(app: &AppHandle, state: &AppState) {
    let Some(window) = app.get_webview_window("main") else { return };
    state.lock().view = ViewKind::Dashboard;
    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);
    let _ = window.set_resizable(true);
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(760.0, 600.0)));
    let _ = window.set_size(tauri::LogicalSize::new(1080.0, 760.0));
    let _ = window.center();
    publish(app, state);
    let _ = window.show();
    let _ = window.set_focus();
    record_open(state);
}

fn show_popover(app: &AppHandle, state: &AppState) {
    let Some(window) = app.get_webview_window("main") else { return };
    if window.is_visible().unwrap_or(false) && matches!(state.lock().view, ViewKind::Popover) {
        let _ = window.hide();
        return;
    }
    state.lock().view = ViewKind::Popover;
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(1.0, 1.0)));
    let _ = window.set_resizable(false);
    let _ = window.set_decorations(false);
    let _ = window.set_always_on_top(true);

    let rect = app.tray_by_id("main").and_then(|tray| tray.rect().ok().flatten());
    if let Some(rect) = rect {
        let anchor = rect.position.to_physical::<f64>(1.0);
        let icon_size = rect.size.to_physical::<f64>(1.0);
        let center_x = anchor.x + icon_size.width / 2.0;
        let center_y = anchor.y + icon_size.height / 2.0;
        if let Ok(Some(monitor)) = app.monitor_from_point(center_x, center_y) {
            let scale = monitor.scale_factor();
            let work = monitor.work_area();
            let width = ((420.0 * scale) as u32).min(work.size.width);
            let height = ((560.0 * scale) as u32).min(work.size.height);
            let left = work.position.x as f64;
            let top = work.position.y as f64;
            let right = left + work.size.width as f64;
            let bottom = top + work.size.height as f64;
            let x = (center_x - width as f64 / 2.0).clamp(left, right - width as f64);
            let y = if center_y >= top + work.size.height as f64 / 2.0 {
                (anchor.y - height as f64 - 8.0 * scale).clamp(top, bottom - height as f64)
            } else {
                (anchor.y + icon_size.height + 8.0 * scale).clamp(top, bottom - height as f64)
            };
            let _ = window.set_size(tauri::LogicalSize::new(width as f64 / scale, height as f64 / scale));
            let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
        }
    } else {
        let _ = window.set_size(tauri::LogicalSize::new(420.0, 560.0));
        let _ = window.center();
    }
    publish(app, state);
    let _ = window.show();
    let _ = window.set_focus();
    record_open(state);
    let last_attempt = state.lock().last_attempt;
    if now_millis() - last_attempt > REFRESH_INTERVAL_MS {
        let app = app.clone();
        let state = state.clone();
        tauri::async_runtime::spawn(async move { refresh_usage(app, state, false).await; });
    }
}

fn record_open(state: &AppState) {
    state.lock().research.record_open(now_millis());
}

async fn refresh_usage(app: AppHandle, state: AppState, force: bool) {
    let _refresh = match state.refresh_gate.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            let guard = state.refresh_gate.lock().await;
            drop(guard);
            return;
        }
    };
    let started = now_millis();
    let config = {
        let mut inner = state.lock();
        if inner.quitting || (!force && started - inner.last_attempt < 30_000) { return }
        inner.last_attempt = started;
        inner.config.clone()
    };

    let codex_future = async {
        if config.codex_enabled { codex::get_snapshots(&config.codex_profile_homes, config.scan_local_models).await } else { Vec::new() }
    };
    let claude_future = async {
        if config.claude_enabled { vec![claude::get_snapshot(&config.claude_home).await] } else { Vec::new() }
    };
    let (codex_snapshots, claude_snapshots) = tokio::join!(codex_future, claude_future);
    let codex_count = codex_snapshots.len();
    let mut all: Vec<UsageSnapshot> = codex_snapshots.iter().chain(claude_snapshots.iter()).cloned().collect();
    let finished = now_millis();
    let notifications = {
        let mut inner = state.lock();
        inner.last_checked_at = Some(timestamp_from_millis(finished));
        let checked: Vec<_> = all.iter().filter(|snapshot| snapshot.error.as_ref().is_none_or(|error| error.kind != "missing-credential")).collect();
        inner.failures = if !checked.is_empty() && checked.iter().all(|snapshot| !snapshot.ok) { (inner.failures + 1).min(3) } else { 0 };
        for snapshot in &all {
            if snapshot.error.as_ref().is_some_and(|error| error.kind == "missing-credential") { continue }
            let message = if snapshot.ok { format!("Quota refreshed in {} ms", finished - started) } else { snapshot.error.as_ref().map(|error| error.message.clone()).unwrap_or_else(|| "Quota refresh failed".to_string()) };
            push_diagnostic(&mut inner, if snapshot.ok { "info" } else { "error" }, snapshot.provider_id, &message, Some(&snapshot.account.label));
        }
        let notifications = enrich_and_notify(&mut inner, &mut all, finished);
        inner.codex = all[..codex_count].to_vec();
        inner.claude = all[codex_count..].to_vec();
        update_tray_tooltip(&app, &all);
        notifications
    };
    for (title, body) in notifications {
        let _ = app.notification().builder().title(title).body(body).show();
    }
    publish(&app, &state);
}

fn enrich_and_notify(inner: &mut AppInner, snapshots: &mut [UsageSnapshot], now: i64) -> Vec<(String, String)> {
    let mut active_keys = HashSet::new();
    inner.sent_notifications.retain(|_, expires| *expires > now);
    if !inner.config.notify_on_low_usage { inner.sent_notifications.retain(|key, _| key.starts_with("reset:")); }
    if !inner.config.notify_on_reset_expiry { inner.sent_notifications.retain(|key, _| !key.starts_with("reset:")); }
    let mut notifications = Vec::new();
    for snapshot in snapshots.iter_mut().filter(|snapshot| snapshot.ok) {
        let provider = match snapshot.provider_id { ProviderId::Codex => "Codex", _ => "Claude" };
        for window in snapshot.windows.values_mut() {
            let key = format!("{}:{}:{:?}", provider, snapshot.account.id, window.id);
            active_keys.insert(key.clone());
            let samples = inner.history.entry(key.clone()).or_default();
            let last = samples.last();
            let observation = Observation { at: now, used: window.used_percent, reset_at: window.reset_at.clone() };
            if last.is_none_or(|last| now - last.at >= 60_000) { samples.push(observation); } else if let Some(last) = samples.last_mut() { *last = observation; }
            let cutoff = now - 2 * 60 * 60_000;
            let start = samples.iter().position(|sample| sample.at >= cutoff).unwrap_or(samples.len());
            if start > 0 { samples.drain(..start); }
            if samples.len() > 120 { samples.drain(..samples.len() - 120); }
            window.forecast = Some(forecast_usage(samples, now));
            let reset = window.reset_at.as_deref().and_then(crate::forecast::parse_timestamp).unwrap_or(0);
            let eta = window.forecast.as_ref().and_then(|forecast| forecast.runs_out_at.as_deref()).and_then(crate::forecast::parse_timestamp).map(|at| at - now).unwrap_or(i64::MAX);
            if inner.config.notify_on_low_usage && reset > now && (window.used_percent >= 90.0 || eta <= 60 * 60_000) {
                let title = format!("{provider} quota warning");
                let label = if window.id == WindowId::FiveHour { "Session" } else { "Weekly" };
                let suffix = if eta <= 60 * 60_000 { " Estimated to run out within an hour at your recent pace." } else { "" };
                let body = format!("{label} quota: {}% left.{suffix}", (100.0 - window.used_percent).round() as i64);
                notify_once(inner, &mut notifications, format!("{key}:{}", window.reset_at.as_deref().unwrap_or("")), reset, title, body);
            }
        }
        let expiry = snapshot.reserve.as_ref().and_then(|reserve| reserve.next_expires_at.as_ref());
        if inner.config.notify_on_reset_expiry && snapshot.provider_id == ProviderId::Codex && snapshot.reserve.as_ref().is_some_and(|reserve| reserve.available.unwrap_or(0) > 0) {
            if let Some(expiry) = expiry {
                let expires = crate::forecast::parse_timestamp(expiry).unwrap_or(0);
                if expires > now && expires - now <= inner.config.reset_expiry_days as i64 * 86_400_000 {
                    notify_once(inner, &mut notifications, format!("reset:{}:{expiry}", snapshot.account.id), expires, "Codex reset expiring soon".to_string(), format!("A banked reset expires on {}. Open Trackem for details.", expiry.get(0..10).unwrap_or(expiry)));
                }
            }
        }
    }
    inner.history.retain(|key, _| active_keys.contains(key));
    notifications
}

fn notify_once(inner: &mut AppInner, notifications: &mut Vec<(String, String)>, key: String, expires: i64, title: String, body: String) {
    if inner.sent_notifications.contains_key(&key) { return }
    inner.sent_notifications.insert(key, expires);
    notifications.push((title, body));
}

fn update_tray_tooltip(app: &AppHandle, snapshots: &[UsageSnapshot]) {
    let providers: Vec<String> = snapshots.iter().filter(|snapshot| snapshot.ok).filter_map(|snapshot| {
        let remaining = snapshot.windows.values().map(|window| window.used_percent).reduce(f64::max)?;
        let provider = match snapshot.provider_id { ProviderId::Codex => "Codex", _ => "Claude" };
        Some(format!("{provider} {}% left", (100.0 - remaining).round() as i64))
    }).collect();
    let tooltip = if providers.is_empty() { "Trackem: no connected providers".to_string() } else { format!("Trackem: {}", providers.join(" · ")) };
    if let Some(tray) = app.tray_by_id("main") { let _ = tray.set_tooltip(Some(tooltip.chars().take(127).collect::<String>())); }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open dashboard", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh usage", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Trackem", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &refresh, &separator, &quit])?;
    let icon_bytes: &[u8] = if cfg!(target_os = "macos") { include_bytes!("../../build/trayTemplate.png") } else { include_bytes!("../../build/icon.png") };
    let icon = tauri::image::Image::from_bytes(icon_bytes)?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Trackem: usage at a glance")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                let app = tray.app_handle();
                let state = app.state::<AppState>();
                show_popover(app, state.inner());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let state = app.state::<AppState>();
                show_dashboard(app, state.inner());
            }
            "refresh" => {
                let state = app.state::<AppState>().inner().clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move { refresh_usage(app, state, true).await; });
            }
            "quit" => {
                app.state::<AppState>().lock().quitting = true;
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn handle_window_event(window: &Window, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        tauri::WindowEvent::Focused(false) => {
            let state = window.app_handle().state::<AppState>();
            if matches!(state.lock().view, ViewKind::Popover) { let _ = window.hide(); }
        }
        _ => {}
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let state = app.state::<AppState>();
            show_dashboard(app, state.inner());
        }))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            usage_get,
            usage_refresh,
            config_get,
            config_set,
            research_get,
            research_save,
            research_clear,
            research_copy,
            window_dashboard,
            window_hide,
            app_quit,
        ])
        .on_window_event(handle_window_event)
        .setup(|app| {
            let state = AppState::new(app.handle()).map_err(std::io::Error::other)?;
            app.manage(state.clone());
            if state.lock().startup_supported {
                let mut inner = state.lock();
                inner.config.launch_at_login = app.autolaunch().is_enabled().unwrap_or(false);
            }
            build_tray(app)?;
            let hidden = std::env::args().any(|arg| arg == "--hidden");
            if !hidden { show_dashboard(app.handle(), &state); }
            let app_handle = app.handle().clone();
            let refresh_state = state.clone();
            tauri::async_runtime::spawn(async move {
                refresh_usage(app_handle.clone(), refresh_state.clone(), true).await;
                loop {
                    let (delay, quitting) = {
                        let inner = refresh_state.lock();
                        (REFRESH_INTERVAL_MS.saturating_mul(1_i64 << inner.failures).min(30 * 60_000), inner.quitting)
                    };
                    if quitting { break }
                    tokio::time::sleep(Duration::from_millis(delay as u64)).await;
                    refresh_usage(app_handle.clone(), refresh_state.clone(), false).await;
                }
            });
            Ok(())
        });
    let app = builder.build(tauri::generate_context!()).expect("failed to build Trackem");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Resumed) {
            let state = app.state::<AppState>().inner().clone();
            state.lock().history.clear();
            let app = app.clone();
            tauri::async_runtime::spawn(async move { refresh_usage(app, state, true).await; });
        }
    });
}
