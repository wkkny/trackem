use crate::forecast::{now_millis, timestamp_from_millis, timestamp_now};
use crate::providers::sessions::scan_session_usage;
use crate::types::{Account, ProviderId, ReserveSummary, SnapshotError, UsageSnapshot, UsageWindow, WindowId};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ATTEMPTS: usize = 2;

#[derive(Debug)]
struct ProviderFailure {
    kind: &'static str,
    message: String,
}

type ProviderResult<T> = Result<T, ProviderFailure>;

#[derive(Debug, Clone)]
struct Profile {
    home: PathBuf,
    is_default: bool,
}

struct Credentials {
    access_token: String,
    account_id: Option<String>,
    email: Option<String>,
    expired: bool,
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct UsageResponse {
    plan_type: Option<String>,
    rate_limit: Option<RateLimit>,
    credits: Option<Credits>,
}

#[derive(Debug, Deserialize)]
struct RateLimit {
    primary_window: Option<ApiWindow>,
    secondary_window: Option<ApiWindow>,
}

#[derive(Debug, Deserialize)]
struct ApiWindow {
    used_percent: Option<f64>,
    reset_at: Option<f64>,
    limit_window_seconds: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct Credits {
    has_credits: Option<bool>,
    unlimited: Option<bool>,
    balance: Option<f64>,
}

fn failure(kind: &'static str, message: impl Into<String>) -> ProviderFailure {
    ProviderFailure { kind, message: message.into() }
}

fn default_home() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).filter(|path| !path.as_os_str().is_empty())
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

fn discover_profiles(configured_homes: &[String]) -> Vec<Profile> {
    let default = default_home();
    let default = if default.is_absolute() { default } else { std::env::current_dir().unwrap_or_default().join(default) };
    let mut homes = vec![default.clone()];
    for configured in configured_homes.iter().take(20) {
        let home = PathBuf::from(configured);
        let home = if home.is_absolute() { home } else { std::env::current_dir().unwrap_or_default().join(home) };
        if !homes.contains(&home) { homes.push(home); }
    }
    homes.into_iter().take(21).map(|home| Profile { is_default: home == default, home }).collect()
}

fn decode_jwt_claims(token: &str) -> Value {
    let Some(payload) = token.split('.').nth(1) else { return Value::Null };
    URL_SAFE_NO_PAD.decode(payload).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or(Value::Null)
}

fn token_expired(token: &str) -> bool {
    decode_jwt_claims(token).get("exp").and_then(Value::as_i64).is_some_and(|expires| expires.saturating_mul(1000) <= now_millis())
}

fn read_credentials(profile: &Profile) -> ProviderResult<Credentials> {
    let file = profile.home.join("auth.json");
    let raw = std::fs::read_to_string(&file).map_err(|_| failure("missing-credential", format!("No Codex credentials found at {}. Run `codex login` for this profile.", file.display())))?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|_| failure("malformed-credential", format!("Codex auth file is not valid JSON: {}", file.display())))?;
    let tokens = parsed.get("tokens").and_then(Value::as_object);
    let access_token = tokens.and_then(|tokens| tokens.get("access_token")).and_then(Value::as_str)
        .ok_or_else(|| failure("missing-credential", format!("Codex auth file at {} has no OAuth token. Run `codex login`.", file.display())))?;
    let account_id = tokens.and_then(|tokens| tokens.get("account_id")).and_then(Value::as_str).map(ToOwned::to_owned);
    let id_token = tokens.and_then(|tokens| tokens.get("id_token")).and_then(Value::as_str);
    let claims = decode_jwt_claims(id_token.unwrap_or(access_token));
    let profile_claim = claims.get("https://api.openai.com/profile");
    let email = claims.get("email").and_then(Value::as_str)
        .or_else(|| profile_claim.and_then(|claim| claim.get("email")).and_then(Value::as_str))
        .map(ToOwned::to_owned);
    Ok(Credentials { access_token: access_token.to_string(), account_id, email, expired: token_expired(access_token), path: file })
}

fn account(profile: &Profile, credentials: Option<&Credentials>) -> Account {
    let label = credentials.and_then(|credentials| credentials.email.clone())
        .unwrap_or_else(|| if profile.is_default { "Default Codex".to_string() } else { profile.home.file_name().and_then(|name| name.to_str()).unwrap_or("Codex profile").to_string() });
    let source = credentials.and_then(|credentials| credentials.account_id.as_deref()).unwrap_or_else(|| profile.home.to_str().unwrap_or("codex"));
    let hash = Sha256::digest(source.as_bytes());
    Account {
        id: hex::encode(hash)[..12].to_string(),
        label,
        email: credentials.and_then(|credentials| credentials.email.clone()),
        home: profile.home.to_string_lossy().into_owned(),
        is_default: profile.is_default,
    }
}

fn headers(credentials: &Credentials) -> ProviderResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    let mut token = HeaderValue::from_str(&format!("Bearer {}", credentials.access_token)).map_err(|_| failure("malformed-credential", "Codex credential contains an invalid access token."))?;
    token.set_sensitive(true);
    headers.insert(AUTHORIZATION, token);
    headers.insert(USER_AGENT, HeaderValue::from_static("codex-cli"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    if let Some(account_id) = &credentials.account_id {
        let value = HeaderValue::from_str(account_id).map_err(|_| failure("malformed-credential", "Codex account identifier is invalid."))?;
        headers.insert("ChatGPT-Account-Id", value);
    }
    Ok(headers)
}

async fn request(credentials: &Credentials, url: &'static str, timeout: Duration) -> ProviderResult<(StatusCode, String)> {
    let headers = headers(credentials)?;
    let client = Client::builder().timeout(timeout).redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|_| failure("network-failure", "Could not initialize the Codex connection."))?;
    for attempt in 0..MAX_ATTEMPTS {
        let response = client.get(url).headers(headers.clone()).send().await;
        match response {
            Ok(response) => {
                let status = response.status();
                let retry_after = response.headers().get("retry-after").and_then(|value| value.to_str().ok()).map(ToOwned::to_owned);
                if attempt + 1 < MAX_ATTEMPTS && (status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()) {
                    let delay = retry_after.and_then(|value| {
                        value.parse::<u64>().ok().map(|seconds| Duration::from_secs(seconds.min(5)))
                            .or_else(|| httpdate::parse_http_date(&value).ok().map(|date| date.duration_since(std::time::SystemTime::now()).unwrap_or_default().min(Duration::from_secs(5))))
                    }).unwrap_or(Duration::from_millis(250));
                    tokio::time::sleep(delay).await;
                    continue;
                }
                let body = response.text().await.unwrap_or_default();
                return Ok((status, body));
            }
            Err(error) => {
                if attempt + 1 < MAX_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    continue;
                }
                let message = if error.is_timeout() { format!("Codex request timed out after {} ms.", timeout.as_millis()) } else { "Could not reach Codex. Check your connection and try again.".to_string() };
                return Err(failure("network-failure", message));
            }
        }
    }
    Err(failure("network-failure", "Could not reach Codex. Check your connection and try again."))
}

async fn usage_response(credentials: &Credentials) -> ProviderResult<UsageResponse> {
    let (status, body) = request(credentials, USAGE_URL, FETCH_TIMEOUT).await?;
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(failure("authentication-expired", "Codex token expired or invalid. Run `codex login` to re-authenticate."));
    }
    if !status.is_success() { return Err(failure("api-failure", format!("Codex usage API returned HTTP {}. Try again later.", status.as_u16()))) }
    let data: UsageResponse = serde_json::from_str(&body).map_err(|_| failure("parse-failure", "Codex usage API returned a non-JSON response."))?;
    let rate_limit = data.rate_limit.as_ref();
    if !rate_limit.is_some_and(|rate| map_window(rate.primary_window.as_ref(), WindowId::FiveHour).is_some() || map_window(rate.secondary_window.as_ref(), WindowId::Weekly).is_some()) {
        return Err(failure("parse-failure", "Codex did not provide supported quota windows."));
    }
    Ok(data)
}

fn map_window(window: Option<&ApiWindow>, id: WindowId) -> Option<UsageWindow> {
    let window = window?;
    let used = window.used_percent?;
    if !used.is_finite() || !(0.0..=100.0).contains(&used) { return None }
    let reset_at = window.reset_at.filter(|value| value.is_finite() && value.abs() < 8.64e12).map(|value| timestamp_from_millis((value * 1000.0) as i64));
    let window_seconds = window.limit_window_seconds.filter(|value| value.is_finite() && *value > 0.0).map(|value| value as u64);
    Some(UsageWindow { id, used_percent: used, reset_at, window_seconds, forecast: None })
}

#[derive(Debug)]
struct ResetCredits {
    available: u64,
    next_expires_at: Option<String>,
    expirations: Vec<String>,
}

async fn reset_credits(credentials: &Credentials) -> Option<ResetCredits> {
    let (status, body) = request(credentials, RESET_CREDITS_URL, Duration::from_secs(8)).await.ok()?;
    if !status.is_success() { return None }
    let value: Value = serde_json::from_str(&body).ok()?;
    let available_count = value.get("available_count").and_then(Value::as_u64);
    let credits = value.get("credits").and_then(Value::as_array);
    if available_count.is_none() && credits.is_none() { return None }
    let now = now_millis();
    let mut available_from_items = 0_u64;
    let mut expirations = Vec::new();
    for credit in credits.into_iter().flatten() {
        if credit.get("redeemed_at").is_some_and(|value| !value.is_null()) || credit.get("status").and_then(Value::as_str) == Some("expired") { continue }
        if let Some(date) = credit.get("expires_at").and_then(Value::as_str) {
            if let Some(millis) = crate::forecast::parse_timestamp(date) {
                if millis <= now { continue }
                expirations.push((millis, timestamp_from_millis(millis)));
            }
        }
        available_from_items += 1;
    }
    expirations.sort_by_key(|(millis, _)| *millis);
    let expiration_strings: Vec<String> = expirations.into_iter().map(|(_, date)| date).take(6).collect();
    let available = available_count.unwrap_or(available_from_items);
    Some(ResetCredits { available, next_expires_at: expiration_strings.first().cloned(), expirations: expiration_strings })
}

fn map_snapshot(profile: &Profile, credentials: &Credentials, data: &UsageResponse, credits: Option<ResetCredits>, top_model: Option<String>) -> UsageSnapshot {
    let mut windows = BTreeMap::new();
    if let Some(rate_limit) = &data.rate_limit {
        if let Some(window) = map_window(rate_limit.primary_window.as_ref(), WindowId::FiveHour) { windows.insert(WindowId::FiveHour, window); }
        if let Some(window) = map_window(rate_limit.secondary_window.as_ref(), WindowId::Weekly) { windows.insert(WindowId::Weekly, window); }
    }
    let available_balance = data.credits.as_ref().filter(|credits| credits.has_credits == Some(true) && credits.unlimited != Some(true)).and_then(|credits| credits.balance).filter(|balance| balance.is_finite());
    let reserve = credits.map(|credits| ReserveSummary { available: Some(credits.available), next_expires_at: credits.next_expires_at, expirations: credits.expirations, balance: available_balance, unit: "credits".to_string() })
        .or_else(|| available_balance.map(|balance| ReserveSummary { available: None, next_expires_at: None, expirations: Vec::new(), balance: Some(balance), unit: "credits".to_string() }));
    UsageSnapshot {
        ok: true,
        provider_id: ProviderId::Codex,
        account: account(profile, Some(credentials)),
        plan: data.plan_type.clone(),
        source: credentials.path.to_string_lossy().into_owned(),
        updated_at: timestamp_now(),
        windows,
        top_model,
        reserve,
        error: None,
    }
}

fn map_error(profile: &Profile, error: ProviderFailure) -> UsageSnapshot {
    UsageSnapshot {
        ok: false,
        provider_id: ProviderId::Codex,
        account: account(profile, None),
        plan: None,
        source: profile.home.join("auth.json").to_string_lossy().into_owned(),
        updated_at: timestamp_now(),
        windows: BTreeMap::new(),
        top_model: None,
        reserve: None,
        error: Some(SnapshotError { kind: error.kind.to_string(), message: error.message }),
    }
}

async fn profile_snapshot(profile: Profile, scan_models: bool) -> UsageSnapshot {
    let credentials = match read_credentials(&profile) { Ok(credentials) => credentials, Err(error) => return map_error(&profile, error) };
    if credentials.expired { return map_error(&profile, failure("authentication-expired", format!("Codex token expired for {}. Run `codex login`.", profile.home.display()))) }
    let data = match usage_response(&credentials).await { Ok(data) => data, Err(error) => return map_error(&profile, error) };
    let credits = reset_credits(&credentials);
    let model = if scan_models {
        let home = profile.home.clone();
        tokio::task::spawn_blocking(move || scan_session_usage(&home)).await.ok().map(|summary| summary.top_model)
    } else { None };
    map_snapshot(&profile, &credentials, &data, credits.await, model.flatten())
}

pub async fn get_snapshots(configured_homes: &[String], scan_models: bool) -> Vec<UsageSnapshot> {
    let profiles = discover_profiles(configured_homes);
    futures::future::join_all(profiles.into_iter().map(|profile| profile_snapshot(profile, scan_models))).await
}
