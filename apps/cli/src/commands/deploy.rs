use crate::cli::{Cli, DeployArgs};
use crate::commands::{cache, chain, detect, target, tx, write};
use crate::error::{AppError, AppResult};
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::process::Command;

#[derive(Debug, Serialize)]
pub(crate) struct DeployData {
    pub(crate) contract: String,
    pub(crate) address: String,
    pub(crate) tx_hash: Option<String>,
    pub(crate) receipt: Option<tx::ReceiptSummary>,
    pub(crate) history_path: Option<String>,
    pub(crate) history_error: Option<String>,
    pub(crate) cached: bool,
    pub(crate) bytecode_hash: String,
    pub(crate) constructor_args_hash: String,
    pub(crate) network: String,
    pub(crate) chain_id: Option<u64>,
}

pub fn run(cli: &Cli, args: &DeployArgs) -> AppResult<()> {
    let (data, network, account) = execute(cli, args)?;
    print(cli, data, Some(network), Some(account))
}

pub(crate) fn execute(
    cli: &Cli,
    args: &DeployArgs,
) -> AppResult<(DeployData, NetworkMeta, AccountMeta)> {
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
                receipt: None,
                history_path: None,
                history_error: None,
                cached: true,
                bytecode_hash,
                constructor_args_hash: cache::args_hash(&args.constructor_args),
                network: network.name.clone(),
                chain_id: network.chain_id,
            };
            return Ok((data, network, account));
        }
    }

    write::confirm_write(
        cli,
        &network,
        &account,
        &write::WritePreview {
            action: "deploy",
            contract: resolved.contract_name.clone(),
            target: Some(args.target.clone()),
            address: None,
            function: None,
            value: None,
            gas: write::GasSignal::unavailable(),
        },
    )?;

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
    let receipt = tx_hash
        .as_deref()
        .and_then(|hash| tx::fetch_receipt_summary(hash, &network.rpc_url).ok());
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
    let (history_path, history_error) = match tx_hash.as_deref() {
        Some(hash) => match tx::record_deploy(tx::DeployRecordInput {
            project_root: &resolved.project_root,
            contract: &resolved.contract_name,
            target: Some(&args.target),
            address: &address,
            tx_hash: Some(hash),
            receipt: receipt.clone(),
            network: &network,
            account: &account,
        }) {
            Ok(path) => (Some(path.display().to_string()), None),
            Err(err) => (None, Some(err.message())),
        },
        None => (None, None),
    };

    let data = DeployData {
        contract: resolved.contract_name,
        address,
        tx_hash,
        receipt,
        history_path,
        history_error,
        cached: false,
        bytecode_hash,
        constructor_args_hash: cache::args_hash(&args.constructor_args),
        network: network.name.clone(),
        chain_id: network.chain_id,
    };
    Ok((data, network, account))
}

fn print(
    cli: &Cli,
    data: DeployData,
    network: Option<NetworkMeta>,
    account: Option<AccountMeta>,
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
        if let Some(tx_hash) = &data.tx_hash {
            println!("  tx: {tx_hash}");
        }
        if let Some(receipt) = &data.receipt {
            print_receipt_summary(receipt);
        }
        if let Some(path) = &data.history_path {
            println!("  history: {path}");
        }
        if let Some(error) = &data.history_error {
            println!("  history failed: {error}");
        }
        Ok(())
    }
}

fn print_receipt_summary(receipt: &tx::ReceiptSummary) {
    if let Some(status) = &receipt.status {
        println!("  status: {status}");
    }
    if let Some(block) = &receipt.block_number {
        println!("  block: {block}");
    }
    if let Some(gas) = &receipt.gas_used {
        println!("  gas used: {gas}");
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
