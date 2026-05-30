use crate::cli::Cli;
use crate::commands::{build, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct AnalyzeData {
    project_root: String,
    status: String,
    build_status: String,
    test_status: String,
    diagnostics: Vec<build::Diagnostic>,
    findings: Vec<AnalyzeFinding>,
    test_stdout: String,
    test_stderr: String,
}

#[derive(Debug, Serialize)]
struct AnalyzeFinding {
    severity: String,
    source: String,
    message: String,
    file: Option<String>,
    line: Option<u64>,
    column: Option<u64>,
}

pub fn run(cli: &Cli) -> AppResult<()> {
    let data = analyze_data(cli)?;
    if cli.json {
        let mut meta = Meta::new("analyze");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else if data.status == "success" {
        println!("Analysis passed: {}", data.project_root);
        Ok(())
    } else {
        print_human_findings(&data);
        Err(AppError::user(
            "analysis_failed",
            "ConSol analysis found issues.",
            Some(format!("{} finding(s) reported.", data.findings.len())),
        ))
    }
}

fn analyze_data(cli: &Cli) -> AppResult<AnalyzeData> {
    let resolved = target::resolve(cli, None)?;
    let build = build::build_data(cli, None)?;
    let test = forge_test(&resolved.project_root)?;
    let mut findings = build
        .diagnostics
        .iter()
        .map(finding_from_diagnostic)
        .collect::<Vec<_>>();
    if test.status != "success" {
        findings.push(AnalyzeFinding {
            severity: "error".to_string(),
            source: "forge test".to_string(),
            message: "Foundry tests failed.".to_string(),
            file: None,
            line: None,
            column: None,
        });
    }
    let status = if build.status == "success"
        && test.status == "success"
        && !findings.iter().any(|finding| finding.severity == "error")
    {
        "success"
    } else {
        "failed"
    }
    .to_string();

    Ok(AnalyzeData {
        project_root: resolved.project_root.display().to_string(),
        status,
        build_status: build.status,
        test_status: test.status,
        diagnostics: build.diagnostics,
        findings,
        test_stdout: test.stdout,
        test_stderr: test.stderr,
    })
}

#[derive(Debug)]
struct TestRun {
    status: String,
    stdout: String,
    stderr: String,
}

fn forge_test(project_root: &std::path::Path) -> AppResult<TestRun> {
    let output = Command::new("forge")
        .arg("test")
        .arg("--root")
        .arg(project_root)
        .arg("--color")
        .arg("never")
        .output()
        .map_err(|err| {
            AppError::user(
                "analysis_test_failed",
                format!("Failed to run forge test: {err}"),
                Some("Install Foundry and make sure `forge` is on PATH.".to_string()),
            )
        })?;

    Ok(TestRun {
        status: if output.status.success() {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn finding_from_diagnostic(diagnostic: &build::Diagnostic) -> AnalyzeFinding {
    AnalyzeFinding {
        severity: diagnostic.severity.clone(),
        source: diagnostic.source.clone(),
        message: diagnostic.message.clone(),
        file: diagnostic.file.clone(),
        line: diagnostic.line,
        column: diagnostic.column,
    }
}

fn print_human_findings(data: &AnalyzeData) {
    println!("Analysis failed: {}", data.project_root);
    println!("  build: {}", data.build_status);
    println!("  test: {}", data.test_status);
    for finding in &data.findings {
        let location = match (&finding.file, finding.line, finding.column) {
            (Some(file), Some(line), Some(column)) => format!("{file}:{line}:{column}"),
            (Some(file), _, _) => file.clone(),
            _ => finding.source.clone(),
        };
        println!("  {} {} {}", finding.severity, location, finding.message);
    }
}
