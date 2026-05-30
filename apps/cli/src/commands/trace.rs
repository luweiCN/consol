use crate::cli::Cli;
use crate::commands::detect;
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta, NetworkMeta};
use serde::Serialize;
use serde_json::Value;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TraceData {
    pub(crate) tx_hash: String,
    pub(crate) network: String,
    pub(crate) chain_id: Option<u64>,
    pub(crate) receipt: Value,
    pub(crate) trace: String,
}

pub fn run(cli: &Cli, tx_hash: &str) -> AppResult<()> {
    let (data, network) = data(cli, tx_hash)?;
    if cli.json {
        let mut meta = Meta::new("trace");
        meta.network = Some(network);
        output::print_json(data, meta)
    } else {
        print_human(&data, &network);
        Ok(())
    }
}

pub(crate) fn data(cli: &Cli, tx_hash: &str) -> AppResult<(TraceData, NetworkMeta)> {
    let network = detect::active_network(cli)?;
    let receipt = cast_receipt(tx_hash, &network.rpc_url)?;
    let trace = cast_run(tx_hash, &network.rpc_url)?;
    let data = TraceData {
        tx_hash: tx_hash.to_string(),
        network: network.name.clone(),
        chain_id: network.chain_id,
        receipt,
        trace,
    };
    Ok((data, network))
}

fn cast_receipt(tx_hash: &str, rpc_url: &str) -> AppResult<Value> {
    let output = Command::new("cast")
        .arg("receipt")
        .arg(tx_hash)
        .arg("--json")
        .arg("--async")
        .arg("--rpc-url")
        .arg(rpc_url)
        .output()
        .map_err(|err| {
            AppError::user(
                "trace_receipt_failed",
                format!("Failed to run cast receipt: {err}"),
                Some(
                    "Check that Foundry is installed and the selected RPC is reachable."
                        .to_string(),
                ),
            )
        })?;

    if !output.status.success() {
        return Err(AppError::user(
            "trace_receipt_failed",
            format!("Could not fetch receipt for {tx_hash}."),
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ));
    }

    serde_json::from_slice(&output.stdout).map_err(|err| {
        AppError::user(
            "trace_receipt_parse_failed",
            format!("Failed to parse cast receipt JSON: {err}"),
            Some(String::from_utf8_lossy(&output.stdout).to_string()),
        )
    })
}

fn cast_run(tx_hash: &str, rpc_url: &str) -> AppResult<String> {
    let output = Command::new("cast")
        .arg("run")
        .arg(tx_hash)
        .arg("--rpc-url")
        .arg(rpc_url)
        .arg("--decode-internal")
        .arg("--with-local-artifacts")
        .arg("--trace-printer")
        .arg("--color")
        .arg("never")
        .output()
        .map_err(|err| {
            AppError::user(
                "trace_run_failed",
                format!("Failed to run cast run: {err}"),
                Some(
                    "Check that Foundry is installed and the selected RPC supports tracing."
                        .to_string(),
                ),
            )
        })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(AppError::user(
            "trace_run_failed",
            format!("cast run failed for {tx_hash}."),
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ))
    }
}

fn print_human(data: &TraceData, network: &NetworkMeta) {
    println!("trace {} on {}", data.tx_hash, network.name);
    if let Some(block) = receipt_field(&data.receipt, "blockNumber") {
        println!("  block: {block}");
    }
    if let Some(status) = receipt_field(&data.receipt, "status") {
        println!("  status: {status}");
    }
    if let Some(gas) = receipt_field(&data.receipt, "gasUsed") {
        println!("  gas used: {gas}");
    }
    if !data.trace.is_empty() {
        println!();
        println!("{}", data.trace);
    }
}

pub(crate) fn receipt_field(receipt: &Value, field: &str) -> Option<String> {
    receipt.get(field).and_then(|value| {
        value
            .as_str()
            .map(ToOwned::to_owned)
            .or_else(|| value.as_u64().map(|number| number.to_string()))
            .or_else(|| value.as_i64().map(|number| number.to_string()))
            .or_else(|| value.as_bool().map(|value| value.to_string()))
    })
}
