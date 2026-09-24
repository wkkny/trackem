use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowId {
    FiveHour,
    Weekly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    pub status: String,
    pub runs_out_at: Option<String>,
    pub sample_minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub id: WindowId,
    pub used_percent: f64,
    pub reset_at: Option<String>,
    pub window_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forecast: Option<Forecast>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: String,
    pub email: Option<String>,
    pub home: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReserveSummary {
    pub available: Option<u64>,
    pub next_expires_at: Option<String>,
    pub expirations: Vec<String>,
    pub balance: Option<f64>,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotError {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub ok: bool,
    pub provider_id: ProviderId,
    pub account: Account,
    pub plan: Option<String>,
    pub source: String,
    pub updated_at: String,
    pub windows: BTreeMap<WindowId, UsageWindow>,
    pub top_model: Option<String>,
    pub reserve: Option<ReserveSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<SnapshotError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderId {
    Codex,
    Claude,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEntry {
    pub id: String,
    pub level: String,
    pub provider_id: ProviderId,
    pub account_label: Option<String>,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewKind {
    Dashboard,
    Popover,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshotPayload {
    pub codex: Vec<UsageSnapshot>,
    pub claude: Vec<UsageSnapshot>,
    pub diagnostics: Vec<DiagnosticEntry>,
    pub last_checked_at: Option<String>,
    pub view: ViewKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackemConfig {
    pub codex_profile_homes: Vec<String>,
    pub notify_on_reset_expiry: bool,
    pub reset_expiry_days: u32,
    pub codex_enabled: bool,
    pub claude_enabled: bool,
    pub claude_home: String,
    pub scan_local_models: bool,
    pub launch_at_login: bool,
    pub notify_on_low_usage: bool,
    pub local_research: bool,
}

impl Default for TrackemConfig {
    fn default() -> Self {
        Self {
            codex_profile_homes: Vec::new(),
            notify_on_reset_expiry: true,
            reset_expiry_days: 7,
            codex_enabled: false,
            claude_enabled: false,
            claude_home: String::new(),
            scan_local_models: false,
            launch_at_login: false,
            notify_on_low_usage: true,
            local_research: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPayload {
    pub config: TrackemConfig,
    pub file: String,
    pub startup_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResearchAnswers {
    pub paid_tools: String,
    pub would_pay: String,
    pub useful: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchReport {
    pub version: u8,
    pub enabled: bool,
    pub days_since_start: u64,
    pub active_days: Vec<u64>,
    pub opens: u64,
    pub answers: ResearchAnswers,
}
