use crate::types::{ResearchAnswers, ResearchReport};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct LocalResearch {
    file: PathBuf,
    enabled: bool,
    started_at: i64,
    days: BTreeSet<u64>,
    opens: u64,
    last_open: i64,
    answers: ResearchAnswers,
}

impl LocalResearch {
    pub fn load(file: PathBuf, enabled: bool) -> Self {
        let now = crate::forecast::now_millis();
        let mut research = Self { file, enabled, started_at: 0, days: BTreeSet::new(), opens: 0, last_open: 0, answers: empty_answers() };
        if !enabled {
            research.clear();
            return research;
        }
        if let Ok(contents) = fs::read_to_string(&research.file) {
            if let Ok(data) = serde_json::from_str::<Value>(&contents) {
                research.started_at = data.get("startedAt").and_then(Value::as_i64).filter(|at| *at > 0 && *at <= now).unwrap_or(now);
                research.days = data.get("days").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_u64).filter(|day| *day <= 89).collect();
                research.opens = data.get("opens").and_then(Value::as_u64).unwrap_or(0);
                research.answers = normalize_answers(data.get("answers").unwrap_or(&Value::Null));
            }
        }
        if research.started_at == 0 {
            research.started_at = now;
        }
        research
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        if enabled == self.enabled { return }
        self.enabled = enabled;
        self.clear();
    }

    pub fn record_open(&mut self, now: i64) {
        if !self.enabled || now - self.last_open < 60_000 { return }
        if self.started_at == 0 { self.started_at = now }
        let day = ((now - self.started_at) / 86_400_000).max(0) as u64;
        if day > 89 { return }
        self.last_open = now;
        self.days.insert(day);
        self.opens += 1;
        self.persist();
    }

    pub fn save(&mut self, value: &Value) -> ResearchReport {
        if self.enabled {
            self.answers = normalize_answers(value);
            self.persist();
        }
        self.report()
    }

    pub fn clear(&mut self) -> ResearchReport {
        self.started_at = if self.enabled { crate::forecast::now_millis() } else { 0 };
        self.days.clear();
        self.opens = 0;
        self.last_open = 0;
        self.answers = empty_answers();
        let _ = fs::remove_file(&self.file);
        self.report()
    }

    pub fn report(&self) -> ResearchReport {
        ResearchReport {
            version: 1,
            enabled: self.enabled,
            days_since_start: if self.started_at == 0 { 0 } else { ((crate::forecast::now_millis() - self.started_at).max(0) / 86_400_000) as u64 },
            active_days: self.days.iter().copied().collect(),
            opens: self.opens,
            answers: self.answers.clone(),
        }
    }

    fn persist(&self) {
        let Some(parent) = self.file.parent() else { return };
        if fs::create_dir_all(parent).is_err() { return }
        let value = json!({ "startedAt": self.started_at, "days": self.days, "opens": self.opens, "answers": self.answers });
        if let Ok(contents) = serde_json::to_vec(&value) {
            if fs::write(&self.file, contents).is_ok() {
                set_private_permissions(&self.file);
            }
        }
    }
}

fn empty_answers() -> ResearchAnswers {
    ResearchAnswers { paid_tools: "unanswered".to_string(), would_pay: "unanswered".to_string(), useful: "unanswered".to_string() }
}

pub fn normalize_answers(value: &Value) -> ResearchAnswers {
    let paid = value.get("paidTools").and_then(Value::as_str).unwrap_or("");
    let would = value.get("wouldPay").and_then(Value::as_str).unwrap_or("");
    let useful = value.get("useful").and_then(Value::as_str).unwrap_or("");
    ResearchAnswers {
        paid_tools: if ["one", "two", "three-plus"].contains(&paid) { paid.to_string() } else { "unanswered".to_string() },
        would_pay: if ["no", "maybe", "yes-3", "yes-5", "yes-10"].contains(&would) { would.to_string() } else { "unanswered".to_string() },
        useful: if ["yes", "no"].contains(&useful) { useful.to_string() } else { "unanswered".to_string() },
    }
}

#[cfg(unix)]
fn set_private_permissions(file: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(file, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn set_private_permissions(_file: &Path) {}
