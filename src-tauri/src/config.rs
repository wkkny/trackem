use crate::types::TrackemConfig;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn expand_home(value: &str) -> String {
    let trimmed = value.trim();
    let Some(home) = dirs::home_dir() else {
        return PathBuf::from(trimmed).to_string_lossy().into_owned();
    };
    if trimmed == "~" {
        return home.to_string_lossy().into_owned();
    }
    if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        return home.join(rest).to_string_lossy().into_owned();
    }
    let path = PathBuf::from(trimmed);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    absolute.to_string_lossy().into_owned()
}

pub fn normalize_config(value: &Value) -> TrackemConfig {
    let mut homes = Vec::new();
    let mut seen = HashSet::new();
    if let Some(values) = value.get("codexProfileHomes").and_then(Value::as_array) {
        for home in values.iter().filter_map(Value::as_str) {
            if home.trim().is_empty() {
                continue;
            }
            let expanded = expand_home(home);
            if seen.insert(expanded.clone()) {
                homes.push(expanded);
            }
            if homes.len() == 20 {
                break;
            }
        }
    }
    let fallback = TrackemConfig::default();
    TrackemConfig {
        codex_enabled: value.get("codexEnabled").and_then(Value::as_bool).unwrap_or(false),
        claude_enabled: value.get("claudeEnabled").and_then(Value::as_bool).unwrap_or(false),
        claude_home: value.get("claudeHome").and_then(Value::as_str).filter(|home| !home.trim().is_empty()).map(expand_home).unwrap_or_default(),
        scan_local_models: value.get("scanLocalModels").and_then(Value::as_bool).unwrap_or(false),
        launch_at_login: value.get("launchAtLogin").and_then(Value::as_bool).unwrap_or(false),
        notify_on_low_usage: value.get("notifyOnLowUsage").and_then(Value::as_bool).unwrap_or(true),
        local_research: value.get("localResearch").and_then(Value::as_bool).unwrap_or(false),
        codex_profile_homes: homes,
        notify_on_reset_expiry: value.get("notifyOnResetExpiry").and_then(Value::as_bool).unwrap_or(fallback.notify_on_reset_expiry),
        reset_expiry_days: value.get("resetExpiryDays").and_then(Value::as_f64).filter(|days| days.is_finite()).map(|days| days.round().clamp(1.0, 30.0) as u32).unwrap_or(fallback.reset_expiry_days),
    }
}

pub fn load_config(file: &Path) -> Result<TrackemConfig, String> {
    match fs::read_to_string(file) {
        Ok(contents) => {
            let value: Value = serde_json::from_str(&contents).map_err(|_| "Preferences file is not valid JSON".to_string())?;
            Ok(normalize_config(&value))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(TrackemConfig::default()),
        Err(_) => Err("Could not read preferences file".to_string()),
    }
}

pub fn save_config(file: &Path, config: &TrackemConfig) -> Result<(), String> {
    let Some(parent) = file.parent() else {
        return Err("Preferences path has no parent directory".to_string());
    };
    fs::create_dir_all(parent).map_err(|_| "Could not create preferences directory".to_string())?;
    let serialized = serde_json::to_vec_pretty(config).map_err(|_| "Could not serialize preferences".to_string())?;
    fs::write(file, serialized).map_err(|_| "Could not write preferences file".to_string())?;
    set_private_permissions(file)?;
    Ok(())
}

pub fn legacy_user_data_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    #[cfg(target_os = "macos")]
    { return Some(home.join("Library/Application Support/trackem")); }
    #[cfg(target_os = "windows")]
    { return std::env::var_os("APPDATA").map(PathBuf::from).map(|path| path.join("trackem")); }
    #[cfg(target_os = "linux")]
    {
        let root = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
        return Some(root.join("trackem"));
    }
    #[allow(unreachable_code)]
    None
}

#[cfg(unix)]
fn set_private_permissions(file: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(file, fs::Permissions::from_mode(0o600)).map_err(|_| "Could not secure preferences file".to_string())
}

#[cfg(not(unix))]
fn set_private_permissions(_file: &Path) -> Result<(), String> {
    Ok(())
}
