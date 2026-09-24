use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{Read, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_FILES: usize = 100;
const MAX_FILE_BYTES: u64 = 6 * 1024 * 1024;
const MAX_SCAN_BYTES: u64 = 32 * 1024 * 1024;
const WINDOW_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS: i64 = 15 * 60 * 1000;

#[derive(Debug, Clone, Default)]
pub struct SessionUsageSummary {
    pub top_model: Option<String>,
}

static CACHE: OnceLock<Mutex<HashMap<PathBuf, (i64, SessionUsageSummary)>>> = OnceLock::new();

#[derive(Default)]
struct ModelTally {
    tokens: u64,
    turns: u64,
}

pub fn scan_session_usage(home: &Path) -> SessionUsageSummary {
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let now = crate::forecast::now_millis();
    if let Ok(cache) = cache.lock() {
        if let Some((at, summary)) = cache.get(home).filter(|(at, _)| now - *at < CACHE_TTL_MS) {
            let _ = at;
            return summary.clone();
        }
    }

    let mut tallies: BTreeMap<String, ModelTally> = BTreeMap::new();
    let mut scanned_bytes = 0_u64;
    for file in list_session_files(home, now) {
        let Ok(metadata) = fs::metadata(&file) else { continue };
        if metadata.len() > MAX_FILE_BYTES || scanned_bytes + metadata.len() > MAX_SCAN_BYTES { continue }
        let Ok(content) = read_bounded_file(&file, MAX_FILE_BYTES.min(MAX_SCAN_BYTES - scanned_bytes)) else { continue };
        scanned_bytes += content.len() as u64;
        if scanned_bytes > MAX_SCAN_BYTES { break }
        tally_content(&content, &mut tallies);
    }

    let top_model = tallies.iter().filter(|(_, tally)| tally.tokens > 0).max_by_key(|(_, tally)| tally.tokens).map(|(model, _)| model.clone());
    let summary = SessionUsageSummary {
        top_model,
    };
    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= 21 {
            if let Some(oldest) = cache.iter().min_by_key(|(_, (at, _))| *at).map(|(key, _)| key.clone()) {
                cache.remove(&oldest);
            }
        }
        cache.insert(home.to_path_buf(), (now, summary.clone()));
    }
    summary
}

fn read_bounded_file(file: &Path, max_bytes: u64) -> std::io::Result<String> {
    let handle = File::open(file)?;
    let mut content = String::new();
    handle.take(max_bytes).read_to_string(&mut content)?;
    Ok(content)
}

fn list_session_files(home: &Path, now: i64) -> Vec<PathBuf> {
    let cutoff = now.saturating_sub(WINDOW_MS);
    let mut visited = 0_usize;
    let mut candidates = Vec::new();
    for root in [home.join("archived_sessions"), home.join("sessions")] {
        for entry in walkdir::WalkDir::new(root).follow_links(false).max_depth(5).into_iter().filter_map(Result::ok) {
            visited += 1;
            if visited > 5000 { break }
            if !entry.file_type().is_file() || !entry.file_name().to_string_lossy().ends_with(".jsonl") { continue }
            let Ok(metadata) = entry.metadata() else { continue };
            let modified = metadata.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_millis() as i64).unwrap_or(0);
            if modified >= cutoff { candidates.push((entry.path().to_path_buf(), modified)); }
        }
    }
    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    candidates.into_iter().take(MAX_FILES).map(|(path, _)| path).collect()
}

fn object(value: Option<&Value>) -> Option<&serde_json::Map<String, Value>> {
    value?.as_object()
}

fn token_count(value: Option<&Value>) -> Option<u64> {
    value?.as_u64()
}

fn usage_total(value: Option<&Value>) -> Option<u64> {
    let usage = object(value)?;
    if let Some(total) = token_count(usage.get("total_tokens")) { return Some(total) }
    let input = token_count(usage.get("input_tokens"));
    let output = token_count(usage.get("output_tokens"));
    if input.is_none() && output.is_none() { None } else { Some(input.unwrap_or(0).saturating_add(output.unwrap_or(0))) }
}

fn read_model(sources: &[Option<&Value>]) -> Option<String> {
    for source in sources {
        let Some(map) = object(*source) else { continue };
        let model = map.get("model_name").or_else(|| map.get("model")).and_then(Value::as_str);
        if let Some(model) = model.filter(|model| !model.is_empty()) { return Some(model.to_string()) }
    }
    None
}

fn tally_content(content: &str, tallies: &mut BTreeMap<String, ModelTally>) {
    let mut current_model: Option<String> = None;
    let mut previous_total: Option<u64> = None;
    let mut incremental_since_total = 0_u64;
    for line in BufReader::new(content.as_bytes()).lines().map_while(Result::ok) {
        let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
        let payload = event.get("payload");
        if event.get("type").and_then(Value::as_str) == Some("turn_context") {
            current_model = read_model(&[payload, Some(&event)]).or(current_model);
            if let Some(model) = &current_model { tallies.entry(model.clone()).or_default().turns += 1; }
            continue;
        }
        if event.get("type").and_then(Value::as_str) != Some("event_msg") || payload.and_then(|value| value.get("type")).and_then(Value::as_str) != Some("token_count") { continue }
        let Some(info) = payload.and_then(|value| value.get("info")) else { continue };
        let cumulative = usage_total(info.get("total_token_usage")).or_else(|| token_count(info.get("total_token_count")));
        let incremental = usage_total(info.get("last_token_usage"));
        let tokens = if let Some(incremental) = incremental {
            if cumulative.is_none() { incremental_since_total = incremental_since_total.saturating_add(incremental); }
            incremental
        } else if let Some(cumulative) = cumulative {
            let reset = previous_total.is_some_and(|previous| cumulative < previous);
            let delta = if previous_total.is_none() || reset { cumulative } else { cumulative.saturating_sub(previous_total.unwrap_or(0)) };
            if reset { delta } else { delta.saturating_sub(incremental_since_total) }
        } else { 0 };
        if let Some(cumulative) = cumulative {
            previous_total = Some(cumulative);
            incremental_since_total = 0;
        }
        let model = read_model(&[Some(info), payload, Some(&event)]).or_else(|| current_model.clone());
        if let Some(model) = model.filter(|_| tokens > 0) {
            let tally = tallies.entry(model).or_default();
            tally.tokens = tally.tokens.saturating_add(tokens);
        }
    }
}
