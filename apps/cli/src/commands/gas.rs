use crate::cli::{Cli, SendArgs, TargetRequiredArgs};
use crate::commands::{deploy, interact, target};
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

#[derive(Debug, Serialize)]
struct GasEstimateData {
    target: String,
    contract: String,
    address: String,
    function: String,
    signature: String,
    args: Vec<String>,
    value: Option<String>,
    from: Option<String>,
    gas: String,
}

#[derive(Debug, Serialize)]
struct GasReportData {
    project_root: String,
    match_contract: Option<String>,
    status: String,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
struct GasSnapshotData {
    project_root: String,
    diff: bool,
    check: bool,
    status: String,
    stdout: String,
    stderr: String,
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

pub fn estimate(cli: &Cli, args: &SendArgs) -> AppResult<()> {
    let context = interact::context(cli, &args.target)?;
    let signature = interact::resolve_function_signature(&context.artifact, &args.function, true)?;
    let gas = interact::estimate_gas(
        &context.address,
        &signature,
        &args.args,
        args.value.as_deref(),
        &context.network.rpc_url,
        context.account.address.as_deref(),
    )?;
    let data = GasEstimateData {
        target: args.target.clone(),
        contract: context.resolved.contract_name.clone(),
        address: context.address.clone(),
        function: args.function.clone(),
        signature,
        args: args.args.clone(),
        value: args.value.clone(),
        from: context.account.address.clone(),
        gas,
    };
    if cli.json {
        let mut meta = Meta::new("gas estimate");
        meta.project_root = Some(context.resolved.project_root.display().to_string());
        meta.network = Some(context.network);
        meta.account = Some(context.account);
        output::print_json(data, meta)
    } else {
        println!(
            "Gas estimate: {} {} -> {}",
            data.contract, data.signature, data.gas
        );
        if let Some(value) = data.value {
            println!("  value: {value}");
        }
        if let Some(from) = data.from {
            println!("  from: {from}");
        }
        Ok(())
    }
}

pub fn report(cli: &Cli, match_contract: Option<&str>) -> AppResult<()> {
    let resolved = target::resolve(cli, None)?;
    let mut command = Command::new("forge");
    command
        .arg("test")
        .arg("--root")
        .arg(&resolved.project_root)
        .arg("--gas-report")
        .arg("--color")
        .arg("never");
    if let Some(match_contract) = match_contract {
        command.arg("--match-contract").arg(match_contract);
    }

    let output = command.output().map_err(|err| {
        AppError::user(
            "gas_report_failed",
            format!("Failed to run forge test --gas-report: {err}"),
            Some("Install Foundry and make sure `forge` is on PATH.".to_string()),
        )
    })?;
    let data = GasReportData {
        project_root: resolved.project_root.display().to_string(),
        match_contract: match_contract.map(ToOwned::to_owned),
        status: if output.status.success() {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    };
    print_report(cli, data)
}

pub fn snapshot(cli: &Cli, diff: bool, check: bool) -> AppResult<()> {
    if diff && check {
        return Err(AppError::user(
            "gas_snapshot_mode_conflict",
            "`gas snapshot` accepts only one of `--diff` or `--check`.",
            Some(
                "Run either `consol gas snapshot --diff` or `consol gas snapshot --check`."
                    .to_string(),
            ),
        ));
    }

    let resolved = target::resolve(cli, None)?;
    let mut command = Command::new("forge");
    command
        .arg("snapshot")
        .arg("--root")
        .arg(&resolved.project_root)
        .arg("--snap")
        .arg(resolved.project_root.join(".gas-snapshot"))
        .arg("--color")
        .arg("never");
    if diff {
        command.arg("--diff");
    }
    if check {
        command.arg("--check");
    }

    let output = command.output().map_err(|err| {
        AppError::user(
            "gas_snapshot_failed",
            format!("Failed to run forge snapshot: {err}"),
            Some("Install Foundry and make sure `forge` is on PATH.".to_string()),
        )
    })?;
    let data = GasSnapshotData {
        project_root: resolved.project_root.display().to_string(),
        diff,
        check,
        status: if output.status.success() {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    };
    print_snapshot(cli, data)
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

fn print_report(cli: &Cli, data: GasReportData) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new("gas report");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else if data.status == "success" {
        print!("{}", data.stdout);
        if !data.stderr.trim().is_empty() {
            eprint!("{}", data.stderr);
        }
        Ok(())
    } else {
        Err(AppError::user(
            "gas_report_failed",
            "forge test --gas-report failed.",
            Some(if data.stderr.trim().is_empty() {
                data.stdout
            } else {
                data.stderr
            }),
        ))
    }
}

fn print_snapshot(cli: &Cli, data: GasSnapshotData) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new("gas snapshot");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else if data.status == "success" {
        print!("{}", data.stdout);
        if !data.stderr.trim().is_empty() {
            eprint!("{}", data.stderr);
        }
        Ok(())
    } else {
        Err(AppError::user(
            "gas_snapshot_failed",
            "forge snapshot failed.",
            Some(if data.stderr.trim().is_empty() {
                data.stdout
            } else {
                data.stderr
            }),
        ))
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
