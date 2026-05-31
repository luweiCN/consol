use crate::cli::Cli;
use crate::commands::target;
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct TestData {
    project_root: String,
    status: String,
    stdout: String,
    stderr: String,
}

pub fn run(cli: &Cli) -> AppResult<()> {
    let resolved = target::resolve(cli, None)?;
    let output = Command::new("forge")
        .args(["test", "--root"])
        .arg(&resolved.project_root)
        .arg("--color")
        .arg("never")
        .output()
        .map_err(|err| {
            AppError::user(
                "forge_unavailable",
                format!("Failed to run `forge test`: {err}"),
                Some("Install Foundry and make sure `forge` is on PATH.".to_string()),
            )
        })?;

    let data = TestData {
        project_root: resolved.project_root.display().to_string(),
        status: if output.status.success() {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    };

    if cli.json {
        let mut meta = Meta::new("test");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else if data.status == "success" {
        println!("Tests passed: {}", data.project_root);
        if !data.stdout.trim().is_empty() {
            print!("{}", data.stdout);
        }
        Ok(())
    } else {
        Err(AppError::user(
            "test_failed",
            "Foundry tests failed.",
            Some(if data.stderr.trim().is_empty() {
                data.stdout.clone()
            } else {
                data.stderr.clone()
            }),
        ))
    }
}
