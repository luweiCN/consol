use crate::cli::{Cli, InvokeArgs, SendArgs, StateArgs};
use crate::commands::{cache, deploy, detect, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::process::Command;

#[derive(Debug, Serialize)]
struct CallData {
    contract: String,
    address: String,
    function: String,
    signature: String,
    raw: String,
}

#[derive(Debug, Serialize)]
struct SendData {
    contract: String,
    address: String,
    function: String,
    signature: String,
    tx_output: String,
    gas_estimate: Option<String>,
}

#[derive(Debug, Serialize)]
struct StateData {
    contract: String,
    address: String,
    values: Vec<StateValue>,
}

#[derive(Debug, Serialize)]
struct StateValue {
    name: String,
    signature: String,
    raw: String,
}

pub fn call(cli: &Cli, args: &InvokeArgs) -> AppResult<()> {
    let context = context(cli, &args.target)?;
    let signature = resolve_function_signature(&context.artifact, &args.function, false)?;
    let raw = cast_call(
        &context.address,
        &signature,
        &args.args,
        &context.network.rpc_url,
    )?;
    let data = CallData {
        contract: context.resolved.contract_name,
        address: context.address,
        function: args.function.clone(),
        signature,
        raw,
    };
    if cli.json {
        let mut meta = Meta::new("call");
        meta.network = Some(context.network);
        meta.account = Some(context.account);
        output::print_json(data, meta)
    } else {
        println!("{} {} -> {}", data.contract, data.signature, data.raw);
        Ok(())
    }
}

pub fn send(cli: &Cli, args: &SendArgs) -> AppResult<()> {
    let context = context(cli, &args.target)?;
    let signature = resolve_function_signature(&context.artifact, &args.function, true)?;
    let gas_estimate = cast_estimate(
        &context.address,
        &signature,
        &args.args,
        args.value.as_deref(),
        &context.network.rpc_url,
    );
    let tx_output = cast_send(
        &context.address,
        &signature,
        &args.args,
        args.value.as_deref(),
        &context.network.rpc_url,
    )?;
    let data = SendData {
        contract: context.resolved.contract_name,
        address: context.address,
        function: args.function.clone(),
        signature,
        tx_output,
        gas_estimate,
    };
    if cli.json {
        let mut meta = Meta::new("send");
        meta.network = Some(context.network);
        meta.account = Some(context.account);
        output::print_json(data, meta)
    } else {
        if let Some(gas) = &data.gas_estimate {
            println!("estimated gas: {gas}");
        }
        println!("{}", data.tx_output);
        Ok(())
    }
}

pub fn state(cli: &Cli, args: &StateArgs) -> AppResult<()> {
    if args.watch {
        return Err(AppError::not_implemented("state --watch"));
    }

    let context = context(cli, &args.target)?;
    let readers = no_arg_readers(&context.artifact);
    let mut values = Vec::new();
    for signature in readers {
        let raw = cast_call(&context.address, &signature, &[], &context.network.rpc_url)?;
        let name = signature
            .split_once('(')
            .map_or(signature.as_str(), |(name, _)| name)
            .to_string();
        values.push(StateValue {
            name,
            signature,
            raw,
        });
    }

    let data = StateData {
        contract: context.resolved.contract_name,
        address: context.address,
        values,
    };
    if cli.json {
        let mut meta = Meta::new("state");
        meta.network = Some(context.network);
        meta.account = Some(context.account);
        output::print_json(data, meta)
    } else {
        println!("{} {}", data.contract, data.address);
        for value in data.values {
            println!("  {:<32} {}", value.name, value.raw);
        }
        Ok(())
    }
}

struct Context {
    resolved: target::ResolvedTarget,
    artifact: Value,
    address: String,
    network: crate::output::NetworkMeta,
    account: crate::output::AccountMeta,
}

fn context(cli: &Cli, target_value: &str) -> AppResult<Context> {
    let resolved = target::resolve(cli, Some(target_value))?;
    let artifact_path = target::artifact_path(&resolved)?;
    let artifact: Value = serde_json::from_str(&fs::read_to_string(artifact_path)?)?;
    let network = detect::active_network(cli)?;
    let account = detect::active_account(cli);
    let deployments = cache::load(&resolved.project_root)?;
    let entry = cache::latest_for_contract(&deployments, &resolved, &network, &account)
        .ok_or_else(|| {
            AppError::user(
                "deployment_not_found",
                format!(
                    "No deployment found for {} on {}.",
                    resolved.contract_name, network.name
                ),
                Some("Run `consol deploy <target>` first.".to_string()),
            )
        })?;
    if !deploy::has_code(&entry.address, &network.rpc_url) {
        return Err(AppError::user(
            "deployment_stale",
            format!(
                "Cached address {} has no code on {}.",
                entry.address, network.name
            ),
            Some("Redeploy the contract for the active network.".to_string()),
        ));
    }
    Ok(Context {
        resolved,
        artifact,
        address: entry.address,
        network,
        account,
    })
}

fn resolve_function_signature(
    artifact: &Value,
    function: &str,
    allow_write: bool,
) -> AppResult<String> {
    if function.contains('(') {
        return Ok(function.to_string());
    }

    let mut matches = Vec::new();
    for item in abi_items(artifact) {
        if item.get("type").and_then(Value::as_str) != Some("function") {
            continue;
        }
        if item.get("name").and_then(Value::as_str) != Some(function) {
            continue;
        }
        let mutability = item
            .get("stateMutability")
            .and_then(Value::as_str)
            .unwrap_or("nonpayable");
        let is_read = mutability == "view" || mutability == "pure";
        if !allow_write && !is_read {
            return Err(AppError::user(
                "function_requires_send",
                format!("Function `{function}` is not view/pure."),
                Some("Use `consol send` for write functions.".to_string()),
            ));
        }
        matches.push(signature(item));
    }

    match matches.as_slice() {
        [signature] => Ok(signature.clone()),
        [] => Err(AppError::user(
            "function_not_found",
            format!("Function `{function}` was not found in the ABI."),
            Some("Run `consol inspect <target>` to list functions.".to_string()),
        )),
        _ => Err(AppError::user(
            "function_ambiguous",
            format!("Function `{function}` is overloaded."),
            Some(format!(
                "Use a full signature. Candidates: {}",
                matches.join(", ")
            )),
        )),
    }
}

fn no_arg_readers(artifact: &Value) -> Vec<String> {
    abi_items(artifact)
        .into_iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function"))
        .filter(|item| {
            matches!(
                item.get("stateMutability").and_then(Value::as_str),
                Some("view" | "pure")
            )
        })
        .filter(|item| {
            item.get("inputs")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
        })
        .map(signature)
        .collect()
}

fn abi_items(artifact: &Value) -> Vec<&Value> {
    artifact
        .get("abi")
        .and_then(Value::as_array)
        .map_or_else(Vec::new, |items| items.iter().collect())
}

fn signature(item: &Value) -> String {
    let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
    let inputs = item
        .get("inputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|input| input.get("type").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(",");
    format!("{name}({inputs})")
}

fn cast_call(address: &str, signature: &str, args: &[String], rpc_url: &str) -> AppResult<String> {
    let mut command = Command::new("cast");
    command
        .arg("call")
        .arg(address)
        .arg(signature)
        .args(args)
        .arg("--rpc-url")
        .arg(rpc_url);
    let output = command.output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(AppError::user(
            "call_failed",
            format!("cast call failed for {signature}."),
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ))
    }
}

fn cast_estimate(
    address: &str,
    signature: &str,
    args: &[String],
    value: Option<&str>,
    rpc_url: &str,
) -> Option<String> {
    let mut command = Command::new("cast");
    command
        .arg("estimate")
        .arg(address)
        .arg(signature)
        .args(args)
        .arg("--rpc-url")
        .arg(rpc_url)
        .arg("--private-key")
        .arg(private_key());
    if let Some(value) = value {
        command.arg("--value").arg(value);
    }
    let output = command.output().ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn cast_send(
    address: &str,
    signature: &str,
    args: &[String],
    value: Option<&str>,
    rpc_url: &str,
) -> AppResult<String> {
    let mut command = Command::new("cast");
    command
        .arg("send")
        .arg(address)
        .arg(signature)
        .args(args)
        .arg("--rpc-url")
        .arg(rpc_url)
        .arg("--private-key")
        .arg(private_key());
    if let Some(value) = value {
        command.arg("--value").arg(value);
    }
    let output = command.output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(AppError::user(
            "send_failed",
            format!("cast send failed for {signature}."),
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ))
    }
}

fn private_key() -> String {
    std::env::var("ETH_PRIVATE_KEY").unwrap_or_else(|_| {
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80".to_string()
    })
}
