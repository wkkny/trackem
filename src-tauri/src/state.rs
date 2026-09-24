use crate::config;
use crate::forecast::Observation;
use crate::research::LocalResearch;
use crate::types::{ConfigPayload, DiagnosticEntry, ProviderId, TrackemConfig, UsageSnapshot, UsageSnapshotPayload, ViewKind};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Manager};

pub const REFRESH_INTERVAL_MS: i64 = 5 * 60_000;

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<AppInner>>,
    pub refresh_gate: Arc<tokio::sync::Mutex<()>>,
}

pub struct AppInner {
    pub config: TrackemConfig,
    pub config_file: PathBuf,
    pub research: LocalResearch,
    pub codex: Vec<UsageSnapshot>,
    pub claude: Vec<UsageSnapshot>,
    pub diagnostics: Vec<DiagnosticEntry>,
    pub last_checked_at: Option<String>,
    pub view: ViewKind,
    pub last_attempt: i64,
    pub failures: u32,
    pub quitting: bool,
    pub log_sequence: u64,
    pub history: HashMap<String, Vec<Observation>>,
    pub sent_notifications: HashMap<String, i64>,
    pub startup_supported: bool,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app.path().app_data_dir().map_err(|_| "Could not resolve Trackem's application data directory".to_string())?;
        fs::create_dir_all(&data_dir).map_err(|_| "Could not create Trackem's application data directory".to_string())?;
        let config_file = data_dir.join("config.json");
        let research_file = data_dir.join("research.json");
        if let Some(legacy) = config::legacy_user_data_dir() {
            migrate_file(&legacy.join("config.json"), &config_file);
            migrate_file(&legacy.join("research.json"), &research_file);
        }
        let (loaded, config_error) = match config::load_config(&config_file) {
            Ok(config) => (config, None),
            Err(error) => (TrackemConfig::default(), Some(error)),
        };
        let startup_supported = cfg!(any(target_os = "windows", target_os = "macos")) && !cfg!(debug_assertions);
        let research = LocalResearch::load(research_file, loaded.local_research);
        let state = Self {
            inner: Arc::new(Mutex::new(AppInner {
                config: loaded,
                config_file,
                research,
                codex: Vec::new(),
                claude: Vec::new(),
                diagnostics: Vec::new(),
                last_checked_at: None,
                view: ViewKind::Dashboard,
                last_attempt: 0,
                failures: 0,
                quitting: false,
                log_sequence: 0,
                history: HashMap::new(),
                sent_notifications: HashMap::new(),
                startup_supported,
            })),
            refresh_gate: Arc::new(tokio::sync::Mutex::new(())),
        };
        if let Some(error) = config_error { state.add_diagnostic("error", ProviderId::System, &error, None); }
        state.add_diagnostic("info", ProviderId::System, "Trackem started", None);
        Ok(state)
    }

    pub fn lock(&self) -> MutexGuard<'_, AppInner> {
        self.inner.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn usage_payload(&self) -> UsageSnapshotPayload {
        let inner = self.lock();
        UsageSnapshotPayload {
            codex: inner.codex.clone(),
            claude: inner.claude.clone(),
            diagnostics: inner.diagnostics.clone(),
            last_checked_at: inner.last_checked_at.clone(),
            view: inner.view,
        }
    }

    pub fn config_payload(&self) -> ConfigPayload {
        let inner = self.lock();
        ConfigPayload { config: inner.config.clone(), file: inner.config_file.to_string_lossy().into_owned(), startup_supported: inner.startup_supported }
    }

    pub fn add_diagnostic(&self, level: &str, provider_id: ProviderId, message: &str, account_label: Option<&str>) {
        let mut inner = self.lock();
        inner.log_sequence += 1;
        let entry = DiagnosticEntry {
            id: format!("{}-{}", crate::forecast::now_millis(), inner.log_sequence),
            level: level.to_string(),
            provider_id,
            account_label: account_label.map(ToOwned::to_owned),
            message: message.to_string(),
            timestamp: crate::forecast::timestamp_now(),
        };
        inner.diagnostics.insert(0, entry);
        inner.diagnostics.truncate(100);
    }
}

fn migrate_file(source: &std::path::Path, destination: &std::path::Path) {
    if destination.exists() || !source.exists() { return }
    if fs::copy(source, destination).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(destination, fs::Permissions::from_mode(0o600));
        }
    }
}
