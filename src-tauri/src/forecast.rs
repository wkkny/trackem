use crate::types::Forecast;

#[derive(Debug, Clone)]
pub struct Observation {
    pub at: i64,
    pub used: f64,
    pub reset_at: Option<String>,
}

pub fn forecast_usage(samples: &[Observation], now: i64) -> Forecast {
    let empty = Forecast { status: "collecting".to_string(), runs_out_at: None, sample_minutes: 0.0 };
    let Some(last) = samples.last() else { return empty };
    if !last.used.is_finite() { return empty }
    let reset = last.reset_at.as_deref().and_then(parse_timestamp);
    if now - last.at > 15 * 60_000 || last.at > now || reset.is_some_and(|at| at <= now) {
        return Forecast { status: "stale".to_string(), ..empty };
    }
    if last.used >= 100.0 {
        return Forecast { status: "exhausted".to_string(), ..empty };
    }
    let Some(reset) = reset else { return empty };

    let mut recent: Vec<&Observation> = samples.iter().filter(|sample| {
        sample.reset_at == last.reset_at && sample.at >= now - 2 * 60 * 60_000 && sample.at <= now
    }).collect();
    for index in (1..recent.len()).rev() {
        let current = recent[index];
        let previous = recent[index - 1];
        if current.used < previous.used || current.at - previous.at > 15 * 60_000 {
            recent = recent.split_off(index);
            break;
        }
    }
    let Some(first) = recent.first() else { return empty };
    let sample_minutes = (last.at - first.at) as f64 / 60_000.0;
    if recent.len() < 3 || sample_minutes < 10.0 {
        return Forecast { sample_minutes, ..empty };
    }
    let delta = last.used - first.used;
    if delta <= 0.0 {
        return Forecast { status: "idle".to_string(), sample_minutes, ..empty };
    }
    let runs_out = last.at as f64 + (100.0 - last.used) / delta * (last.at - first.at) as f64;
    if !runs_out.is_finite() { return Forecast { sample_minutes, ..empty } }
    if runs_out < reset as f64 {
        Forecast { status: "depleting".to_string(), runs_out_at: Some(timestamp_from_millis(runs_out as i64)), sample_minutes }
    } else {
        Forecast { status: "lasts".to_string(), runs_out_at: None, sample_minutes }
    }
}

pub fn parse_timestamp(value: &str) -> Option<i64> {
    // RFC 3339 timestamps from provider endpoints always include a zone offset.
    let parsed = time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok()?;
    Some(parsed.unix_timestamp_nanos() as i64 / 1_000_000)
}

pub fn timestamp_now() -> String {
    timestamp_from_millis(now_millis())
}

pub fn now_millis() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_millis() as i64).unwrap_or_default()
}

pub fn timestamp_from_millis(value: i64) -> String {
    time::OffsetDateTime::from_unix_timestamp_nanos(value as i128 * 1_000_000)
        .map(|datetime| datetime.format(&time::format_description::well_known::Rfc3339).unwrap_or_default())
        .unwrap_or_default()
}
