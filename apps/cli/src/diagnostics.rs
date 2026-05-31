use crate::config;
use crate::error::{AppError, AppResult};
use crate::fs_util;
use crate::output;
use chrono::Local;
use crossterm::event::DisableMouseCapture;
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, LeaveAlternateScreen};
use std::backtrace::Backtrace;
use std::io;
use std::panic::{self, PanicHookInfo};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

static TUI_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn install_panic_hook() {
    let default_hook = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        if TUI_ACTIVE.load(Ordering::SeqCst) {
            restore_terminal();
        }
        let path = config::dev_log_path();
        let _ = append_panic_record(info, &path);
        eprintln!();
        eprintln!("consol crashed; diagnostic log: {}", path.display());
        default_hook(info);
    }));
}

pub fn set_tui_active(active: bool) {
    TUI_ACTIVE.store(active, Ordering::SeqCst);
}

pub fn dev_log_path() -> PathBuf {
    config::dev_log_path()
}

pub fn append_dev_log(level: &str, message: &str) -> AppResult<PathBuf> {
    append_log_line("dev", level, message)
}

pub fn append_cli_error(error: &AppError) -> AppResult<PathBuf> {
    let message = match error.hint() {
        Some(hint) => format!("{}; hint: {hint}", error.message()),
        None => error.message(),
    };
    append_log_line("cli", error.code(), &message)
}

fn restore_terminal() {
    let _ = disable_raw_mode();
    let _ = execute!(io::stdout(), DisableMouseCapture, LeaveAlternateScreen);
}

fn append_panic_record(info: &PanicHookInfo<'_>, path: &Path) -> AppResult<()> {
    let mut record = String::new();
    record.push_str(&format!("---- consol panic {} ----\n", timestamp()));
    record.push_str(&format!("cwd: {}\n", current_dir_label()));
    record.push_str(&format!("args: {}\n", redacted_args().join(" ")));
    if let Some(location) = info.location() {
        record.push_str(&format!(
            "location: {}:{}:{}\n",
            location.file(),
            location.line(),
            location.column()
        ));
    }
    record.push_str(&format!("message: {}\n", panic_message(info)));
    record.push_str(&format!("backtrace:\n{}\n\n", Backtrace::force_capture()));
    fs_util::append_private_file(path, record)
}

fn append_log_line(channel: &str, level: &str, message: &str) -> AppResult<PathBuf> {
    let path = config::dev_log_path();
    let line = format!("[{}] {channel} {level}: {}", timestamp(), one_line(message));
    fs_util::append_private_file(&path, format!("{line}\n"))?;
    Ok(path)
}

fn current_dir_label() -> String {
    std::env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|err| format!("<unavailable: {err}>"))
}

fn panic_message(info: &PanicHookInfo<'_>) -> String {
    if let Some(message) = info.payload().downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = info.payload().downcast_ref::<String>() {
        return message.clone();
    }
    "<non-string panic payload>".to_string()
}

fn timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn redacted_args() -> Vec<String> {
    let args = std::env::args().collect::<Vec<_>>();
    redact_args(&args)
}

fn redact_args(args: &[String]) -> Vec<String> {
    let mut redacted = Vec::with_capacity(args.len());
    let mut redact_next = false;
    for arg in args {
        if redact_next {
            redacted.push(redact_arg_value(arg));
            redact_next = false;
            continue;
        }

        if matches!(
            arg.as_str(),
            "--rpc-url" | "--private-key" | "--password" | "--mnemonic"
        ) {
            redacted.push(arg.clone());
            redact_next = true;
            continue;
        }

        if let Some((flag, value)) = arg.split_once('=') {
            if matches!(
                flag,
                "--rpc-url" | "--private-key" | "--password" | "--mnemonic"
            ) {
                redacted.push(format!("{flag}={}", redact_arg_value(value)));
                continue;
            }
        }

        redacted.push(redact_arg_value(arg));
    }
    redacted
}

fn redact_arg_value(value: &str) -> String {
    if looks_like_private_key(value) {
        return "<redacted>".to_string();
    }
    if looks_like_remote_url(value) {
        return output::redact_rpc_url(value);
    }
    value.to_string()
}

fn looks_like_private_key(value: &str) -> bool {
    let value = value.trim();
    value.len() == 66
        && value.starts_with("0x")
        && value[2..].chars().all(|ch| ch.is_ascii_hexdigit())
}

fn looks_like_remote_url(value: &str) -> bool {
    let value = value.trim();
    (value.starts_with("http://") || value.starts_with("https://"))
        && !value.contains("localhost")
        && !value.contains("127.0.0.1")
        && !value.contains("[::1]")
}

fn one_line(message: &str) -> String {
    message.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_args_redact_rpc_urls_and_private_keys() {
        let args = vec![
            "consol".to_string(),
            "--rpc-url".to_string(),
            "https://rpc.example.com/path?token=secret".to_string(),
            "--private-key=0x1111111111111111111111111111111111111111111111111111111111111111"
                .to_string(),
            "dev".to_string(),
        ];

        let redacted = redact_args(&args).join(" ");

        assert!(redacted.contains("https://rpc.example.com/<redacted>"));
        assert!(redacted.contains("--private-key=<redacted>"));
        assert!(!redacted.contains("secret"));
        assert!(
            !redacted.contains("1111111111111111111111111111111111111111111111111111111111111111")
        );
    }

    #[test]
    fn diagnostic_messages_are_single_line() {
        assert_eq!(
            one_line("first line\nsecond\tline"),
            "first line second line"
        );
    }
}
