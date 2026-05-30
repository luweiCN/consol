use crate::cli::{Cli, DeployArgs};
use crate::commands::{cache, chain, detect, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::process::Command;

#[derive(Debug, Serialize)]
struct DeployData {
    contract: String,
    address: String,
    tx_hash: Option<String>,
    cached: bool,
    bytecode_hash: String,
    constructor_args_hash: String,
    network: String,
    chain_id: Option<u64>,
}

pub fn run(cli: &Cli, args: &DeployArgs) -> AppResult<()> {
    let resolved = target::resolve(cli, Some(&args.target))?;
    ensure_local_chain(cli)?;
    run_forge_build(&resolved.project_root)?;
    let artifact_path = target::artifact_path(&resolved)?;
    let artifact: Value = serde_json::from_str(&fs::read_to_string(&artifact_path)?)?;
    let bytecode_hash = artifact
        .get("bytecode")
        .and_then(|bytecode| {
            bytecode
                .get("object")
                .and_then(Value::as_str)
                .or_else(|| bytecode.as_str())
        })
        .map(target::stable_hash)
        .unwrap_or_else(|| "0".to_string());

    let network = detect::active_network(cli)?;
    let account = detect::active_account(cli)?;
    let mut deployments = cache::load(&resolved.project_root)?;
    let cache_key = cache::key(
        &resolved,
        &bytecode_hash,
        &args.constructor_args,
        &network,
        &account,
    );

    if let Some(entry) = deployments.entries.get(&cache_key).cloned() {
        if has_code(&entry.address, &network.rpc_url) {
            let data = DeployData {
                contract: resolved.contract_name,
                address: entry.address,
                tx_hash: entry.deploy_tx,
                cached: true,
                bytecode_hash,
                constructor_args_hash: cache::args_hash(&args.constructor_args),
                network: network.name.clone(),
                chain_id: network.chain_id,
            };
            return print(cli, data, Some(network), Some(account));
        }
    }

    if !cli.yes && network.write_policy != "local" {
        return Err(AppError::user(
            "confirmation_required",
            "Remote deploy requires explicit confirmation.",
            Some("Pass --yes only for local/dev networks; remote confirmation policy is coming next.".to_string()),
        ));
    }

    let contract_id = contract_identifier(&resolved)?;
    let private_key = crate::config::private_key_for_write(cli, &network)?;
    let mut command = Command::new("forge");
    command
        .arg("create")
        .arg("--root")
        .arg(&resolved.project_root)
        .arg(&contract_id)
        .arg("--rpc-url")
        .arg(&network.rpc_url)
        .arg("--private-key")
        .arg(private_key)
        .arg("--broadcast");
    if !args.constructor_args.is_empty() {
        command.arg("--constructor-args");
        command.args(&args.constructor_args);
    }

    let output = command.output().map_err(|err| {
        AppError::user(
            "deploy_failed",
            format!("Failed to run forge create: {err}"),
            Some("Check that Foundry is installed and the target compiles.".to_string()),
        )
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(AppError::user(
            "deploy_failed",
            "forge create failed.",
            Some(format!("{stdout}\n{stderr}")),
        ));
    }

    let address = parse_line_value(&stdout, "Deployed to:").ok_or_else(|| {
        AppError::user(
            "deploy_parse_failed",
            "Could not parse deployed address.",
            Some(stdout.clone()),
        )
    })?;
    let tx_hash = parse_line_value(&stdout, "Transaction hash:");
    let entry = cache::entry(
        &resolved,
        address.clone(),
        bytecode_hash.clone(),
        &args.constructor_args,
        &network,
        &account,
        tx_hash.clone(),
    );
    deployments.entries.insert(cache_key, entry);
    cache::save(&resolved.project_root, &deployments)?;

    let data = DeployData {
        contract: resolved.contract_name,
        address,
        tx_hash,
        cached: false,
        bytecode_hash,
        constructor_args_hash: cache::args_hash(&args.constructor_args),
        network: network.name.clone(),
        chain_id: network.chain_id,
    };
    print(cli, data, Some(network), Some(account))
}

fn print(
    cli: &Cli,
    data: DeployData,
    network: Option<crate::output::NetworkMeta>,
    account: Option<crate::output::AccountMeta>,
) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new("deploy");
        meta.network = network;
        meta.account = account;
        output::print_json(data, meta)
    } else {
        println!(
            "{} deployed at {}{}",
            data.contract,
            data.address,
            if data.cached { " (cached)" } else { "" }
        );
        Ok(())
    }
}

pub fn run_forge_build(project_root: &std::path::Path) -> AppResult<()> {
    let output = Command::new("forge")
        .args(["build", "--root"])
        .arg(project_root)
        .output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::user(
            "build_failed",
            "Foundry build failed before deploy.",
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ))
    }
}

pub fn ensure_local_chain(cli: &Cli) -> AppResult<()> {
    chain::ensure_local_chain_running(cli)
}

pub fn has_code(address: &str, rpc_url: &str) -> bool {
    let output = Command::new("cast")
        .args(["code", address, "--rpc-url", rpc_url])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            let code = String::from_utf8_lossy(&output.stdout);
            let code = code.trim();
            !code.is_empty() && code != "0x"
        }
        _ => false,
    }
}

pub fn contract_identifier(resolved: &target::ResolvedTarget) -> AppResult<String> {
    let artifact = target::artifact_path(resolved)?;
    let file = artifact
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            AppError::user(
                "artifact_path_invalid",
                format!("Invalid artifact path: {}", artifact.display()),
                None,
            )
        })?;
    Ok(format!("src/{file}:{}", resolved.contract_name))
}

fn parse_line_value(output: &str, prefix: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix(prefix)
            .map(|value| value.trim().to_string())
    })
}
