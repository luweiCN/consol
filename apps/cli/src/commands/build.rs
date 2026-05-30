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
    stdout: String,
    stderr: String,
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

    let data = BuildData {
        target: target.map(ToOwned::to_owned),
        source_mode: resolved.source_mode.to_string(),
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
        let mut meta = Meta::new("build");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else if data.status == "success" {
        println!("Build succeeded: {}", data.project_root);
        Ok(())
    } else {
        Err(AppError::user(
            "build_failed",
            "Foundry build failed.",
            Some(data.stderr.clone()),
        ))
    }
}
