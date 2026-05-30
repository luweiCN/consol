use crate::cli::Cli;
use crate::commands::target;
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct BuildData {
    target: Option<String>,
    source_mode: String,
    project_root: String,
    status: String,
    diagnostics: Vec<Diagnostic>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct Diagnostic {
    severity: String,
    message: String,
    code: Option<String>,
    file: Option<String>,
    line: Option<u64>,
    column: Option<u64>,
    source: String,
}

pub fn run(cli: &Cli, target: Option<&str>) -> AppResult<()> {
    let resolved = target::resolve(cli, target)?;
    let output = Command::new("forge")
        .args(["build", "--root"])
        .arg(&resolved.project_root)
        .output()
        .map_err(|err| {
            AppError::user(
                "forge_unavailable",
                format!("Failed to run `forge build`: {err}"),
                Some("Install Foundry and make sure `forge` is on PATH.".to_string()),
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let data = BuildData {
        target: target.map(ToOwned::to_owned),
        source_mode: resolved.source_mode.to_string(),
        project_root: resolved.project_root.display().to_string(),
        status: if output.status.success() {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        diagnostics: parse_diagnostics(&stdout, &stderr),
        stdout,
        stderr,
    };

    if cli.json {
        let mut meta = Meta::new("build");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else if data.status == "success" {
        println!("Build succeeded: {}", data.project_root);
        if !data.diagnostics.is_empty() {
            println!("  diagnostics: {}", data.diagnostics.len());
        }
        Ok(())
    } else {
        Err(AppError::user(
            "build_failed",
            "Foundry build failed.",
            Some(data.stderr.clone()),
        ))
    }
}

fn parse_diagnostics(stdout: &str, stderr: &str) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let mut pending: Option<PendingDiagnostic> = None;
    for raw_line in stdout.lines().chain(stderr.lines()) {
        let line = strip_ansi(raw_line);
        let line = line.trim();
        if line.is_empty() || line == "Error: Compiler run failed:" {
            continue;
        }

        if let Some(next) = parse_diagnostic_message(line) {
            if let Some(previous) = pending.replace(next) {
                diagnostics.push(previous.into_diagnostic(None));
            }
            continue;
        }

        if let Some(location) = parse_location(line) {
            if let Some(previous) = pending.take() {
                diagnostics.push(previous.into_diagnostic(Some(location)));
            }
        }
    }

    if let Some(previous) = pending {
        diagnostics.push(previous.into_diagnostic(None));
    }
    diagnostics
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingDiagnostic {
    severity: String,
    message: String,
    code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Location {
    file: String,
    line: u64,
    column: u64,
}

impl PendingDiagnostic {
    fn into_diagnostic(self, location: Option<Location>) -> Diagnostic {
        Diagnostic {
            severity: self.severity,
            message: self.message,
            code: self.code,
            file: location.as_ref().map(|location| location.file.clone()),
            line: location.as_ref().map(|location| location.line),
            column: location.map(|location| location.column),
            source: "forge build".to_string(),
        }
    }
}

fn parse_diagnostic_message(line: &str) -> Option<PendingDiagnostic> {
    for (prefix, severity) in [("Error", "error"), ("Warning", "warning")] {
        let Some(rest) = line.strip_prefix(prefix) else {
            continue;
        };
        let rest = rest.trim_start();
        if let Some(rest) = rest.strip_prefix('(') {
            let (code, message) = rest.split_once("):")?;
            return Some(PendingDiagnostic {
                severity: severity.to_string(),
                message: message.trim().to_string(),
                code: Some(code.trim().to_string()),
            });
        }
        if let Some(message) = rest.strip_prefix(':') {
            return Some(PendingDiagnostic {
                severity: severity.to_string(),
                message: message.trim().to_string(),
                code: None,
            });
        }
    }
    None
}

fn parse_location(line: &str) -> Option<Location> {
    let location = line
        .strip_prefix("-->")
        .or_else(|| line.strip_prefix("╭─["))
        .or_else(|| line.split_once(" --> ").map(|(_, location)| location))?
        .trim()
        .trim_end_matches(']')
        .trim_end_matches(':');
    let (path_and_line, column) = location.rsplit_once(':')?;
    let (file, line) = path_and_line.rsplit_once(':')?;
    Some(Location {
        file: file.trim().to_string(),
        line: line.trim().parse().ok()?,
        column: column.trim().parse().ok()?,
    })
}

fn strip_ansi(value: &str) -> String {
    let mut stripped = String::new();
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            stripped.push(ch);
            continue;
        }
        for escaped in chars.by_ref() {
            if escaped.is_ascii_alphabetic() {
                break;
            }
        }
    }
    stripped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_solc_diagnostics_with_locations() {
        let stderr = r#"
Error: Compiler run failed:
Error (7576): Undeclared identifier.
 --> src/Broken.sol:5:9:
  |
5 |         missing = 1;
  |         ^^^^^^^
Warning (2018): Function state mutability can be restricted to pure
 --> src/Broken.sol:8:5:
  |
8 |     function value() public returns (uint256) {
  |     ^ (Relevant source part starts here and spans across multiple lines).
"#;
        let diagnostics = parse_diagnostics("", stderr);
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].severity, "error");
        assert_eq!(diagnostics[0].code.as_deref(), Some("7576"));
        assert_eq!(diagnostics[0].file.as_deref(), Some("src/Broken.sol"));
        assert_eq!(diagnostics[0].line, Some(5));
        assert_eq!(diagnostics[0].column, Some(9));
        assert_eq!(diagnostics[1].severity, "warning");
        assert_eq!(diagnostics[1].code.as_deref(), Some("2018"));
        assert_eq!(diagnostics[1].line, Some(8));
    }
}
