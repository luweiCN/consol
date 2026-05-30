use crate::cli::{Cli, DeployArgs};
use crate::commands::{cache, chain, detect, target, tx, write};
use crate::error::{AppError, AppResult};
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize)]
pub(crate) struct DeployData {
    pub(crate) contract: String,
    pub(crate) address: String,
    pub(crate) tx_hash: Option<String>,
    pub(crate) receipt: Option<tx::ReceiptSummary>,
    pub(crate) history_path: Option<String>,
    pub(crate) history_error: Option<String>,
    pub(crate) signer_address: Option<String>,
    pub(crate) nonce: Option<String>,
    pub(crate) gas_price: Option<String>,
    pub(crate) cached: bool,
    pub(crate) bytecode_hash: String,
    pub(crate) constructor_args_hash: String,
    pub(crate) network: String,
    pub(crate) chain_id: Option<u64>,
}

#[derive(Debug, Serialize)]
struct DeployAllData {
    project_root: String,
    network: String,
    chain_id: Option<u64>,
    plan: Vec<DeployPlanItem>,
    results: Vec<DeployAllResult>,
}

#[derive(Debug, Clone, Serialize)]
struct DeployPlanItem {
    target: String,
    contract: String,
    source: Option<String>,
    artifact_path: String,
    bytecode_hash: String,
    constructor_inputs: usize,
    deployable: bool,
    reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct DeployAllResult {
    target: String,
    contract: String,
    status: String,
    deployment: Option<DeployData>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct DeployListData {
    project_root: String,
    deployments: Vec<DeployListItem>,
}

#[derive(Debug, Serialize)]
struct DeployListItem {
    contract: String,
    address: String,
    network: String,
    chain_id: Option<u64>,
    deployer: Option<String>,
    deploy_tx: Option<String>,
    deployed_at_unix: u64,
    bytecode_hash: String,
    constructor_args_hash: String,
}

#[derive(Debug, Serialize)]
struct DeployForgetData {
    project_root: String,
    target: String,
    removed: usize,
}

pub fn run(cli: &Cli, args: &DeployArgs) -> AppResult<()> {
    if args.all {
        return run_all(cli);
    }
    if args.list {
        return list(cli);
    }
    if let Some(target) = &args.forget {
        return forget(cli, target);
    }

    let (data, network, account) = execute(cli, args)?;
    print(cli, data, Some(network), Some(account))
}

pub(crate) fn execute(
    cli: &Cli,
    args: &DeployArgs,
) -> AppResult<(DeployData, NetworkMeta, AccountMeta)> {
    let target = args.target.as_deref().ok_or_else(|| {
        AppError::user(
            "deploy_target_required",
            "Deploy requires a target unless `--all`, `--list`, or `--forget` is used.",
            Some("Example: `consol deploy Counter` or `consol deploy --all`.".to_string()),
        )
    })?;
    execute_target(cli, target, &args.constructor_args, true)
}

fn execute_target(
    cli: &Cli,
    target: &str,
    constructor_args: &[String],
    build: bool,
) -> AppResult<(DeployData, NetworkMeta, AccountMeta)> {
    let resolved = target::resolve(cli, Some(target))?;
    execute_resolved(cli, target, constructor_args, resolved, None, build)
}

fn execute_resolved(
    cli: &Cli,
    target_label: &str,
    constructor_args: &[String],
    resolved: target::ResolvedTarget,
    artifact_path: Option<PathBuf>,
    build: bool,
) -> AppResult<(DeployData, NetworkMeta, AccountMeta)> {
    ensure_local_chain(cli)?;
    let (artifact_path, artifact) = target::with_scratch_lock(&resolved.project_root, || {
        if build {
            run_forge_build(&resolved.project_root)?;
        }
        let artifact_path = match artifact_path {
            Some(path) => path,
            None => target::artifact_path(&resolved)?,
        };
        let artifact = serde_json::from_str(&fs::read_to_string(&artifact_path)?)?;
        Ok((artifact_path, artifact))
    })?;
    let bytecode_hash = bytecode_hash(&artifact);

    let network = detect::active_network(cli)?;
    let account = detect::active_account(cli)?;
    let mut deployments = cache::load(&resolved.project_root)?;
    let cache_key = cache::key(
        &resolved,
        &bytecode_hash,
        constructor_args,
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
                signer_address: None,
                nonce: None,
                gas_price: None,
                cached: true,
                bytecode_hash,
                constructor_args_hash: cache::args_hash(constructor_args),
                network: network.name.clone(),
                chain_id: network.chain_id,
            };
            if cli.ndjson {
                output::print_ndjson_event(
                    "tx.cached",
                    0,
                    &data,
                    tx_meta("deploy", &network, &account),
                )?;
            }
            return Ok((data, network, account));
        }
    }

    write::preflight_write_policy(cli, &network)?;
    let (private_key, signer_address) = write::private_key_for_write(cli, &network, &account)?;
    let details = write::preview_details(&network, Some(&signer_address), None);
    let preview = write::WritePreview {
        action: "deploy",
        contract: resolved.contract_name.clone(),
        target: Some(target_label.to_string()),
        address: None,
        function: None,
        value: None,
        gas: write::GasSignal::unavailable_with_context(write::GasContext {
            target: Some(target_label.to_string()),
            contract: Some(resolved.contract_name.clone()),
            network: Some(network.name.clone()),
            chain_id: network.chain_id,
            from: Some(signer_address.clone()),
            ..Default::default()
        }),
        details: details.clone(),
    };
    write::confirm_write(cli, &network, &account, &preview)?;
    if cli.ndjson {
        output::print_ndjson_event(
            "tx.preview",
            0,
            &preview,
            tx_meta("deploy", &network, &account),
        )?;
    }

    let contract_id = contract_identifier_from_artifact(&resolved, &artifact_path)?;
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
    if !constructor_args.is_empty() {
        command.arg("--constructor-args");
        command.args(constructor_args);
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
    if cli.ndjson {
        if let Some(hash) = &tx_hash {
            output::print_ndjson_event(
                "tx.sent",
                1,
                serde_json::json!({
                    "action": "deploy",
                    "contract": &resolved.contract_name,
                    "target": target_label,
                    "address": &address,
                    "tx_hash": hash,
                }),
                tx_meta("deploy", &network, &account),
            )?;
        }
        if let (Some(hash), Some(receipt)) = (&tx_hash, &receipt) {
            output::print_ndjson_event(
                "tx.mined",
                2,
                serde_json::json!({
                    "action": "deploy",
                    "contract": &resolved.contract_name,
                    "address": &address,
                    "tx_hash": hash,
                    "receipt": receipt,
                }),
                tx_meta("deploy", &network, &account),
            )?;
        }
    }
    let entry = cache::entry(
        &resolved,
        address.clone(),
        bytecode_hash.clone(),
        constructor_args,
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
            target: Some(target_label),
            address: &address,
            tx_hash: Some(hash),
            receipt: receipt.clone(),
            network: &network,
            account: &account,
            signer_address: Some(&signer_address),
            nonce: details.nonce.as_deref(),
            gas_price: details.gas_price.as_deref(),
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
        signer_address: Some(signer_address),
        nonce: details.nonce,
        gas_price: details.gas_price,
        cached: false,
        bytecode_hash,
        constructor_args_hash: cache::args_hash(constructor_args),
        network: network.name.clone(),
        chain_id: network.chain_id,
    };
    Ok((data, network, account))
}

fn run_all(cli: &Cli) -> AppResult<()> {
    let root_target = target::resolve(cli, None)?;
    let project_root = root_target.project_root;
    ensure_local_chain(cli)?;
    run_forge_build(&project_root)?;
    let network = detect::active_network(cli)?;
    let account = detect::active_account(cli)?;
    let plan = discover_deploy_plan(&project_root)?;
    let mut results = Vec::new();

    for item in &plan {
        if !item.deployable {
            results.push(DeployAllResult {
                target: item.target.clone(),
                contract: item.contract.clone(),
                status: "skipped".to_string(),
                deployment: None,
                error: item.reason.clone(),
            });
            continue;
        }

        let resolved = target::ResolvedTarget {
            source_mode: target::SourceMode::Project,
            project_root: project_root.clone(),
            source_file: None,
            contract_name: item.contract.clone(),
        };
        match execute_resolved(
            cli,
            &item.target,
            &[],
            resolved,
            Some(PathBuf::from(&item.artifact_path)),
            false,
        ) {
            Ok((deployment, _, _)) => {
                let status = if deployment.cached {
                    "cached"
                } else {
                    "deployed"
                };
                results.push(DeployAllResult {
                    target: item.target.clone(),
                    contract: item.contract.clone(),
                    status: status.to_string(),
                    deployment: Some(deployment),
                    error: None,
                });
            }
            Err(err) => results.push(DeployAllResult {
                target: item.target.clone(),
                contract: item.contract.clone(),
                status: "failed".to_string(),
                deployment: None,
                error: Some(format!("{}: {}", err.code(), err.message())),
            }),
        }
    }

    let data = DeployAllData {
        project_root: project_root.display().to_string(),
        network: network.name.clone(),
        chain_id: network.chain_id,
        plan,
        results,
    };
    if cli.ndjson {
        Ok(())
    } else if cli.json {
        let mut meta = Meta::new("deploy --all");
        meta.network = Some(network);
        meta.account = Some(account);
        output::print_json(data, meta)
    } else {
        println!("deploy --all");
        println!("  project: {}", data.project_root);
        println!("  network: {}", data.network);
        for result in data.results {
            println!("  {} {}: {}", result.status, result.target, result.contract);
            if let Some(deployment) = result.deployment {
                println!("    address: {}", deployment.address);
            }
            if let Some(error) = result.error {
                println!("    reason: {error}");
            }
        }
        Ok(())
    }
}

fn list(cli: &Cli) -> AppResult<()> {
    let resolved = target::resolve(cli, None)?;
    let cache = cache::load(&resolved.project_root)?;
    let mut deployments = cache
        .entries
        .values()
        .map(|entry| DeployListItem {
            contract: entry.contract.clone(),
            address: entry.address.clone(),
            network: entry.network.clone(),
            chain_id: entry.chain_id,
            deployer: entry.deployer.clone(),
            deploy_tx: entry.deploy_tx.clone(),
            deployed_at_unix: entry.deployed_at_unix,
            bytecode_hash: entry.bytecode_hash.clone(),
            constructor_args_hash: entry.constructor_args_hash.clone(),
        })
        .collect::<Vec<_>>();
    deployments.sort_by(|left, right| {
        right
            .deployed_at_unix
            .cmp(&left.deployed_at_unix)
            .then_with(|| left.contract.cmp(&right.contract))
    });
    let data = DeployListData {
        project_root: resolved.project_root.display().to_string(),
        deployments,
    };
    if cli.json {
        output::print_json(data, Meta::new("deploy --list"))
    } else {
        println!("deployments");
        println!("  project: {}", data.project_root);
        for entry in data.deployments {
            println!(
                "  {} {} network={} deployer={}",
                entry.contract,
                entry.address,
                entry.network,
                entry.deployer.as_deref().unwrap_or("unknown")
            );
        }
        Ok(())
    }
}

fn forget(cli: &Cli, target_value: &str) -> AppResult<()> {
    let resolved = target::resolve(cli, None)?;
    let contract = contract_name_from_target(target_value);
    let mut cache = cache::load(&resolved.project_root)?;
    let before = cache.entries.len();
    cache.entries.retain(|_, entry| entry.contract != contract);
    let removed = before.saturating_sub(cache.entries.len());
    cache::save(&resolved.project_root, &cache)?;
    let data = DeployForgetData {
        project_root: resolved.project_root.display().to_string(),
        target: target_value.to_string(),
        removed,
    };
    if cli.json {
        output::print_json(data, Meta::new("deploy --forget"))
    } else {
        println!("forgot {removed} deployment entries for {target_value}");
        Ok(())
    }
}

fn print(
    cli: &Cli,
    data: DeployData,
    network: Option<NetworkMeta>,
    account: Option<AccountMeta>,
) -> AppResult<()> {
    if cli.ndjson {
        Ok(())
    } else if cli.json {
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
        if let Some(signer_address) = &data.signer_address {
            println!("  signer: {signer_address}");
        }
        if let Some(nonce) = &data.nonce {
            println!("  nonce: {nonce}");
        }
        if let Some(gas_price) = &data.gas_price {
            println!("  gas price: {gas_price}");
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

fn tx_meta(command: &str, network: &NetworkMeta, account: &AccountMeta) -> Meta {
    let mut meta = Meta::new(command);
    meta.network = Some(network.clone());
    meta.account = Some(account.clone());
    meta
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
    target::with_scratch_lock(&resolved.project_root, || {
        let artifact = target::artifact_path(resolved)?;
        contract_identifier_from_artifact(resolved, &artifact)
    })
}

fn contract_identifier_from_artifact(
    resolved: &target::ResolvedTarget,
    artifact: &Path,
) -> AppResult<String> {
    if let Ok(contents) = fs::read_to_string(artifact) {
        if let Ok(value) = serde_json::from_str::<Value>(&contents) {
            if let Some(source) = artifact_source(&value) {
                return Ok(format!("{source}:{}", resolved.contract_name));
            }
        }
    }

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

fn discover_deploy_plan(project_root: &Path) -> AppResult<Vec<DeployPlanItem>> {
    let mut items = Vec::new();
    let out_dir = project_root.join("out");
    visit_json_files(&out_dir, &mut |path| {
        if artifact_is_build_info(path) {
            return Ok(());
        }
        let artifact: Value = serde_json::from_str(&fs::read_to_string(path)?)?;
        let Some(contract) = path.file_stem().and_then(|name| name.to_str()) else {
            return Ok(());
        };
        let source = artifact_source(&artifact);
        if source
            .as_deref()
            .is_some_and(|source| !source.starts_with("src/"))
        {
            return Ok(());
        }
        let bytecode = bytecode_object(&artifact);
        let constructor_inputs = constructor_input_count(&artifact);
        let deployable = bytecode.as_deref().is_some_and(is_deployable_bytecode);
        let reason = if !deployable {
            Some("artifact has no deployable bytecode".to_string())
        } else if constructor_inputs > 0 {
            Some(format!(
                "constructor requires {constructor_inputs} argument(s); deploy --all only handles zero-argument constructors"
            ))
        } else {
            None
        };
        items.push(DeployPlanItem {
            target: contract.to_string(),
            contract: contract.to_string(),
            source,
            artifact_path: path.display().to_string(),
            bytecode_hash: bytecode_hash(&artifact),
            constructor_inputs,
            deployable: deployable && constructor_inputs == 0,
            reason,
        });
        Ok(())
    })?;

    let mut counts = BTreeMap::<String, usize>::new();
    for item in &items {
        *counts.entry(item.contract.clone()).or_default() += 1;
    }
    for item in &mut items {
        if counts.get(&item.contract).copied().unwrap_or_default() > 1 {
            item.deployable = false;
            item.reason = Some(
                "duplicate contract names require file-qualified cache keys before deploy --all can deploy them"
                    .to_string(),
            );
        }
    }
    items.sort_by(|left, right| {
        left.source
            .cmp(&right.source)
            .then_with(|| left.contract.cmp(&right.contract))
            .then_with(|| left.artifact_path.cmp(&right.artifact_path))
    });
    Ok(items)
}

fn visit_json_files(dir: &Path, visitor: &mut impl FnMut(&Path) -> AppResult<()>) -> AppResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            visit_json_files(&path, visitor)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            visitor(&path)?;
        }
    }
    Ok(())
}

fn artifact_is_build_info(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name == "build-info")
    })
}

fn artifact_source(artifact: &Value) -> Option<String> {
    artifact
        .pointer("/metadata/settings/compilationTarget")
        .and_then(Value::as_object)
        .and_then(|targets| targets.keys().next().cloned())
}

fn constructor_input_count(artifact: &Value) -> usize {
    artifact
        .get("abi")
        .and_then(Value::as_array)
        .and_then(|abi| {
            abi.iter()
                .find(|item| item.get("type").and_then(Value::as_str) == Some("constructor"))
        })
        .and_then(|constructor| constructor.get("inputs"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn bytecode_hash(artifact: &Value) -> String {
    bytecode_object(artifact)
        .map(|bytecode| target::stable_hash(&bytecode))
        .unwrap_or_else(|| "0".to_string())
}

fn bytecode_object(artifact: &Value) -> Option<String> {
    artifact.get("bytecode").and_then(|bytecode| {
        bytecode
            .get("object")
            .and_then(Value::as_str)
            .or_else(|| bytecode.as_str())
            .map(ToOwned::to_owned)
    })
}

fn is_deployable_bytecode(bytecode: &str) -> bool {
    let value = bytecode.trim();
    !value.is_empty() && value != "0x"
}

fn contract_name_from_target(target: &str) -> &str {
    target
        .rsplit_once(':')
        .map_or(target, |(_, contract)| contract)
}

fn parse_line_value(output: &str, prefix: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix(prefix)
            .map(|value| value.trim().to_string())
    })
}
