use crate::forecast::{now_millis, parse_timestamp, timestamp_now};
use crate::types::{Account, ProviderId, SnapshotError, UsageSnapshot, UsageWindow, WindowId};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION};
use reqwest::{Client, StatusCode};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

fn record(value: Option<&Value>) -> Option<&serde_json::Map<String, Value>> {
    value?.as_object()
}

fn account_id(home: &str) -> String {
    let digest = Sha256::digest(format!("claude:{home}").as_bytes());
    hex::encode(digest)[..12].to_string()
}

fn home_path(configured_home: &str) -> PathBuf {
    let raw = if !configured_home.trim().is_empty() {
        configured_home.to_string()
    } else if let Some(home) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|value| !value.is_empty()) {
        home.to_string_lossy().into_owned()
    } else {
        dirs::home_dir().unwrap_or_default().join(".claude").to_string_lossy().into_owned()
    };
    let expanded = crate::config::expand_home(&raw);
    PathBuf::from(expanded)
}

fn failure(home: &str, source: &str, kind: &str, message: &str) -> UsageSnapshot {
    UsageSnapshot {
        ok: false,
        provider_id: ProviderId::Claude,
        account: Account { id: account_id(home), label: "Claude Code".to_string(), email: None, home: home.to_string(), is_default: true },
        plan: None,
        source: source.to_string(),
        updated_at: timestamp_now(),
        windows: BTreeMap::new(),
        top_model: None,
        reserve: None,
        error: Some(SnapshotError { kind: kind.to_string(), message: message.to_string() }),
    }
}

async fn keychain_credentials() -> Option<String> {
    let output = tokio::time::timeout(Duration::from_secs(5), Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .kill_on_drop(true)
        .output()).await.ok()?.ok()?;
    if !output.status.success() { return None }
    String::from_utf8(output.stdout).ok()
}

fn map_windows(value: &Value) -> BTreeMap<WindowId, UsageWindow> {
    let mut windows = BTreeMap::new();
    let Some(data) = record(Some(value)) else { return windows };
    for (key, id, seconds) in [("five_hour", WindowId::FiveHour, 18_000), ("seven_day", WindowId::Weekly, 604_800)] {
        let Some(window) = record(data.get(key)) else { continue };
        let Some(used) = window.get("utilization").and_then(Value::as_f64).filter(|value| value.is_finite() && (0.0..=100.0).contains(value)) else { continue };
        let reset = window.get("resets_at").and_then(Value::as_str).and_then(parse_timestamp).map(crate::forecast::timestamp_from_millis);
        windows.insert(id, UsageWindow { id, used_percent: used, reset_at: reset, window_seconds: Some(seconds), forecast: None });
    }
    windows
}

pub async fn get_snapshot(configured_home: &str) -> UsageSnapshot {
    let home_path = home_path(configured_home);
    let home = home_path.to_string_lossy().into_owned();
    let file = home_path.join(".credentials.json");
    let mut source = file.to_string_lossy().into_owned();
    let raw = match tokio::fs::read_to_string(&file).await {
        Ok(raw) => raw,
        Err(_) => {
            if !configured_home.is_empty() || std::env::var_os("CLAUDE_CONFIG_DIR").is_some() || !cfg!(target_os = "macos") {
                return failure(&home, &source, "missing-credential", "No Claude Code credentials found. Sign in with `claude`, then refresh. For WSL, set the Claude directory in Settings.");
            }
            match keychain_credentials().await {
                Some(raw) => { source = "macOS Keychain: Claude Code-credentials".to_string(); raw }
                None => return failure(&home, &source, "missing-credential", "Sign in with `claude` first. Trackem reads the Claude Code credential file or its macOS Keychain entry."),
            }
        }
    };
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(_) => return failure(&home, &source, "malformed-credential", "Claude Code credentials are not valid JSON. Sign in again with `claude`."),
    };
    let oauth = parsed.get("claudeAiOauth").and_then(Value::as_object);
    let access_token = oauth.and_then(|oauth| oauth.get("accessToken")).and_then(Value::as_str).filter(|token| !token.is_empty());
    let Some(access_token) = access_token else {
        return failure(&home, &source, "missing-credential", "Claude Code OAuth login is required. API keys do not expose subscription quotas.");
    };
    if oauth.and_then(|oauth| oauth.get("expiresAt")).and_then(Value::as_f64).is_some_and(|expires| expires <= now_millis() as f64) {
        return failure(&home, &source, "authentication-expired", "Claude Code login expired. Open `claude` to renew it, then refresh Trackem.");
    }
    let mut headers = HeaderMap::new();
    let mut token = match HeaderValue::from_str(&format!("Bearer {access_token}")) {
        Ok(token) => token,
        Err(_) => return failure(&home, &source, "malformed-credential", "Claude Code credential contains an invalid access token."),
    };
    token.set_sensitive(true);
    headers.insert(AUTHORIZATION, token);
    headers.insert("anthropic-beta", HeaderValue::from_static("oauth-2025-04-20"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    let client = match Client::builder().timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build() {
        Ok(client) => client,
        Err(_) => return failure(&home, &source, "network-failure", "Could not initialize the Claude connection."),
    };
    let response = match client.get(USAGE_URL).headers(headers).send().await {
        Ok(response) => response,
        Err(error) if error.is_timeout() => return failure(&home, &source, "network-failure", "Could not reach Claude within 10 seconds. Check your connection and try again."),
        Err(_) => return failure(&home, &source, "network-failure", "Could not reach Claude within 10 seconds. Check your connection and try again."),
    };
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return failure(&home, &source, "authentication-expired", "Claude rejected this login or its permissions. Sign in again with `claude`.");
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return failure(&home, &source, "api-failure", "Claude rate-limited usage checks. Trackem will retry on its next background refresh.");
    }
    if !status.is_success() {
        return failure(&home, &source, "api-failure", &format!("Claude usage API returned HTTP {}. Try again later.", status.as_u16()));
    }
    let data: Value = match response.json().await {
        Ok(data) => data,
        Err(_) => return failure(&home, &source, "parse-failure", "Claude returned an unreadable usage response."),
    };
    let windows = map_windows(&data);
    if windows.is_empty() { return failure(&home, &source, "parse-failure", "Claude did not provide supported subscription quota windows.") }
    let plan = oauth.and_then(|oauth| oauth.get("subscriptionType")).and_then(Value::as_str).map(ToOwned::to_owned);
    UsageSnapshot {
        ok: true,
        provider_id: ProviderId::Claude,
        account: Account { id: account_id(&home), label: "Claude Code".to_string(), email: None, home, is_default: configured_home.is_empty() },
        plan,
        source,
        updated_at: timestamp_now(),
        windows,
        top_model: None,
        reserve: None,
        error: None,
    }
}
