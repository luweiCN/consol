use crate::cli::Cli;
use crate::commands::{inspect, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
struct AbiData {
    target: String,
    contract: String,
    source_mode: String,
    project_root: String,
    artifact_path: String,
    abi: Value,
}

pub fn run(cli: &Cli, target_value: &str) -> AppResult<()> {
    let resolved = target::resolve(cli, Some(target_value))?;
    let artifact_path = target::artifact_path(&resolved)?;
    let artifact = inspect::read_artifact(&artifact_path)?;
    let abi = artifact.get("abi").cloned().ok_or_else(|| {
        AppError::user(
            "artifact_missing_abi",
            format!("Artifact has no ABI: {}", artifact_path.display()),
            Some("Run `consol build` and check that the target is deployable.".to_string()),
        )
    })?;
    let data = AbiData {
        target: target_value.to_string(),
        contract: resolved.contract_name,
        source_mode: resolved.source_mode.to_string(),
        project_root: resolved.project_root.display().to_string(),
        artifact_path: artifact_path.display().to_string(),
        abi,
    };

    if cli.json {
        let mut meta = Meta::new("abi");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else {
        println!("{}", serde_json::to_string_pretty(&data.abi)?);
        Ok(())
    }
}
