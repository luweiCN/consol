use crate::cli::{Cli, TargetRequiredArgs};
use crate::commands::{deploy, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use serde_json::Value;
use std::process::Command;

#[derive(Debug, Serialize)]
struct GasCompileData {
    target: String,
    contract: String,
    source_mode: String,
    project_root: String,
    creation: Value,
    functions: Vec<FunctionGas>,
    raw: Value,
}

#[derive(Debug, Serialize)]
struct FunctionGas {
    signature: String,
    gas: String,
    finite: bool,
}

pub fn compile(cli: &Cli, args: &TargetRequiredArgs) -> AppResult<()> {
    let resolved = target::resolve(cli, Some(&args.target))?;
    deploy::run_forge_build(&resolved.project_root)?;
    let raw = forge_gas_estimates(&resolved)?;
    let data = GasCompileData {
        target: args.target.clone(),
        contract: resolved.contract_name,
        source_mode: resolved.source_mode.to_string(),
        project_root: resolved.project_root.display().to_string(),
        creation: raw.get("creation").cloned().unwrap_or(Value::Null),
        functions: external_functions(&raw),
        raw,
    };
    print(cli, data)
}

fn print(cli: &Cli, data: GasCompileData) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new("gas compile");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else {
        println!("Gas estimates: {}", data.contract);
        for function in data.functions {
            println!(
                "  {:<40} {}",
                function.signature,
                if function.finite {
                    function.gas
                } else {
                    "infinite".to_string()
                }
            );
        }
        Ok(())
    }
}

fn forge_gas_estimates(resolved: &target::ResolvedTarget) -> AppResult<Value> {
    let output = Command::new("forge")
        .arg("inspect")
        .arg("--root")
        .arg(&resolved.project_root)
        .arg(&resolved.contract_name)
        .arg("gasEstimates")
        .output()
        .map_err(|err| {
            AppError::user(
                "gas_compile_failed",
                format!("Failed to run forge inspect gasEstimates: {err}"),
                Some("Install Foundry and make sure `forge` is on PATH.".to_string()),
            )
        })?;
    if !output.status.success() {
        return Err(AppError::user(
            "gas_compile_failed",
            "forge inspect gasEstimates failed.",
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|err| {
        AppError::user(
            "gas_parse_failed",
            format!("Failed to parse gas estimates: {err}"),
            Some(String::from_utf8_lossy(&output.stdout).to_string()),
        )
    })
}

fn external_functions(raw: &Value) -> Vec<FunctionGas> {
    let mut functions = raw
        .get("external")
        .and_then(Value::as_object)
        .map(|external| {
            external
                .iter()
                .map(|(signature, value)| {
                    let gas = value
                        .as_str()
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| value.to_string());
                    FunctionGas {
                        signature: signature.clone(),
                        finite: gas != "infinite",
                        gas,
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    functions.sort_by(|left, right| left.signature.cmp(&right.signature));
    functions
}
