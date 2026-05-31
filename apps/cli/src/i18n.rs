use crate::config;
use std::collections::HashMap;
use std::sync::OnceLock;

const EN_US: &str = include_str!("../locales/en-US.ftl");
const ZH_CN: &str = include_str!("../locales/zh-CN.ftl");

static ACTIVE_MESSAGES: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
static FALLBACK_MESSAGES: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();

pub(crate) fn t(key: &'static str) -> String {
    ACTIVE_MESSAGES
        .get_or_init(active_messages)
        .get(key)
        .or_else(|| {
            FALLBACK_MESSAGES
                .get_or_init(|| parse_messages(EN_US))
                .get(key)
        })
        .copied()
        .unwrap_or(key)
        .to_string()
}

pub(crate) fn tf(key: &'static str, vars: &[(&str, &str)]) -> String {
    let mut message = t(key);
    for (name, value) in vars {
        message = message.replace(&format!("{{{name}}}"), value);
    }
    message
}

fn active_messages() -> HashMap<&'static str, &'static str> {
    match active_locale().as_deref() {
        Some("zh-CN") | Some("zh_CN") | Some("zh") => parse_messages(ZH_CN),
        _ => parse_messages(EN_US),
    }
}

fn active_locale() -> Option<String> {
    config::configured_ui_language()
        .and_then(normalize_locale)
        .or_else(env_locale)
}

fn env_locale() -> Option<String> {
    ["CONSOL_LANG", "LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|name| std::env::var(name).ok())
        .and_then(normalize_locale)
}

fn normalize_locale(value: String) -> Option<String> {
    let normalized = value
        .split('.')
        .next()
        .unwrap_or(value.as_str())
        .replace('_', "-");
    let normalized = normalized.trim();
    (!normalized.is_empty() && !normalized.eq_ignore_ascii_case("system"))
        .then_some(normalized.to_string())
}

// Locale assets currently use a small `key = value` subset, not full Fluent syntax.
fn parse_messages(input: &'static str) -> HashMap<&'static str, &'static str> {
    input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim(), value.trim()))
        .collect()
}
