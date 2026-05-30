use crate::cli::{Cli, InvokeArgs, SendArgs, StateArgs};
use crate::commands::{cache, deploy, detect, target, tx, write};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    tx_hash: Option<String>,
    receipt: Option<tx::ReceiptSummary>,
    history_path: Option<String>,
    history_error: Option<String>,
    signer_address: Option<String>,
    nonce: Option<String>,
    gas_price: Option<String>,
    calldata_hash: Option<String>,
    calldata_prefix: Option<String>,
    gas: write::GasSignal,
    gas_estimate: Option<String>,
    gas_estimate_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct StateData {
    pub(crate) contract: String,
    pub(crate) address: String,
    pub(crate) values: Vec<StateValue>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct StateValue {
    pub(crate) name: String,
    pub(crate) signature: String,
    pub(crate) raw: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct LogsData {
    pub(crate) contract: String,
    pub(crate) address: String,
    pub(crate) events: Vec<DecodedLog>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DecodedLog {
    pub(crate) address: Option<String>,
    pub(crate) block_number: Option<u64>,
    pub(crate) transaction_hash: Option<String>,
    pub(crate) log_index: Option<u64>,
    pub(crate) event: Option<String>,
    pub(crate) signature: Option<String>,
    pub(crate) args: Vec<DecodedLogArg>,
    pub(crate) raw: Value,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DecodedLogArg {
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) indexed: bool,
    pub(crate) value: String,
}

#[derive(Debug, Clone)]
struct EventAbi {
    name: String,
    signature: String,
    topic0: String,
    inputs: Vec<EventInput>,
}

#[derive(Debug, Clone)]
struct EventInput {
    name: String,
    kind: String,
    indexed: bool,
}

pub fn call(cli: &Cli, args: &InvokeArgs) -> AppResult<()> {
    let context = context(cli, &args.target)?;
    let signature = resolve_function_signature(&context.artifact, &args.function, false)?;
    let raw = call_raw(&context, &signature, &args.args)?;
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
    write::preflight_write_policy(cli, &context.network)?;
    let (private_key, signer_address) =
        write::private_key_for_write(cli, &context.network, &context.account)?;
    let gas_context = write::GasContext {
        target: Some(args.target.clone()),
        contract: Some(context.resolved.contract_name.clone()),
        address: Some(context.address.clone()),
        function: Some(signature.clone()),
        network: Some(context.network.name.clone()),
        chain_id: context.network.chain_id,
        from: Some(signer_address.clone()),
        value: args.value.clone(),
    };
    let gas = write::GasSignal::from_result_with_context(
        estimate_gas(
            &context.address,
            &signature,
            &args.args,
            args.value.as_deref(),
            &context.network.rpc_url,
            Some(&signer_address),
        ),
        gas_context,
    );
    let calldata = encode_calldata(&signature, &args.args);
    let details =
        write::preview_details(&context.network, Some(&signer_address), calldata.as_deref());
    let preview = write::WritePreview {
        action: "send",
        contract: context.resolved.contract_name.clone(),
        target: Some(args.target.clone()),
        address: Some(context.address.clone()),
        function: Some(signature.clone()),
        value: args.value.clone(),
        gas: gas.clone(),
        details: details.clone(),
    };
    write::confirm_write(cli, &context.network, &context.account, &preview)?;
    if cli.ndjson {
        output::print_ndjson_event(
            "tx.preview",
            0,
            &preview,
            tx_meta("send", &context.network, &context.account),
        )?;
    }
    let submitted = send_raw(
        &context,
        &signature,
        &args.args,
        args.value.as_deref(),
        &private_key,
    )?;
    if cli.ndjson {
        if let Some(hash) = &submitted.tx_hash {
            output::print_ndjson_event(
                "tx.sent",
                1,
                serde_json::json!({
                    "action": "send",
                    "contract": &context.resolved.contract_name,
                    "target": &args.target,
                    "address": &context.address,
                    "function": &args.function,
                    "signature": &signature,
                    "tx_hash": hash,
                }),
                tx_meta("send", &context.network, &context.account),
            )?;
        }
        if let (Some(hash), Some(receipt)) = (&submitted.tx_hash, &submitted.receipt) {
            output::print_ndjson_event(
                "tx.mined",
                2,
                serde_json::json!({
                    "action": "send",
                    "contract": &context.resolved.contract_name,
                    "address": &context.address,
                    "function": &args.function,
                    "signature": &signature,
                    "tx_hash": hash,
                    "receipt": receipt,
                }),
                tx_meta("send", &context.network, &context.account),
            )?;
        }
    }
    let (history_path, history_error) = if submitted.tx_hash.is_some() {
        match tx::record_send(tx::SendRecordInput {
            project_root: &context.resolved.project_root,
            contract: &context.resolved.contract_name,
            target: Some(&args.target),
            address: &context.address,
            function: &args.function,
            signature: &signature,
            args: &args.args,
            value: args.value.as_deref(),
            gas_estimate: gas.estimate.as_deref(),
            gas_estimate_error: gas.error.as_deref(),
            signer_address: Some(&signer_address),
            nonce: details.nonce.as_deref(),
            gas_price: details.gas_price.as_deref(),
            calldata_hash: details.calldata_hash.as_deref(),
            calldata_prefix: details.calldata_prefix.as_deref(),
            submitted: &submitted,
            network: &context.network,
            account: &context.account,
        }) {
            Ok(path) => (Some(path.display().to_string()), None),
            Err(err) => (None, Some(err.message())),
        }
    } else {
        (None, None)
    };
    let data = SendData {
        contract: context.resolved.contract_name,
        address: context.address,
        function: args.function.clone(),
        signature,
        tx_output: submitted.tx_output,
        tx_hash: submitted.tx_hash,
        receipt: submitted.receipt,
        history_path,
        history_error,
        signer_address: Some(signer_address),
        nonce: details.nonce,
        gas_price: details.gas_price,
        calldata_hash: details.calldata_hash,
        calldata_prefix: details.calldata_prefix,
        gas: gas.clone(),
        gas_estimate: gas.estimate,
        gas_estimate_error: gas.error,
    };
    if cli.ndjson {
        Ok(())
    } else if cli.json {
        let mut meta = Meta::new("send");
        meta.network = Some(context.network);
        meta.account = Some(context.account);
        output::print_json(data, meta)
    } else {
        if let Some(gas) = &data.gas_estimate {
            println!("estimated gas: {gas}");
        }
        if let Some(error) = &data.gas_estimate_error {
            println!("gas estimate failed: {error}");
        }
        print_send_human(&data);
        Ok(())
    }
}

fn tx_meta(command: &str, network: &output::NetworkMeta, account: &output::AccountMeta) -> Meta {
    let mut meta = Meta::new(command);
    meta.network = Some(network.clone());
    meta.account = Some(account.clone());
    meta
}

fn print_send_human(data: &SendData) {
    if let Some(tx_hash) = &data.tx_hash {
        println!("tx: {tx_hash}");
    }
    if let Some(signer_address) = &data.signer_address {
        println!("signer: {signer_address}");
    }
    if let Some(nonce) = &data.nonce {
        println!("nonce: {nonce}");
    }
    if let Some(gas_price) = &data.gas_price {
        println!("gas price: {gas_price}");
    }
    if let Some(calldata_prefix) = &data.calldata_prefix {
        println!("calldata: {calldata_prefix}");
    }
    if let Some(calldata_hash) = &data.calldata_hash {
        println!("calldata hash: {calldata_hash}");
    }
    if let Some(receipt) = &data.receipt {
        if let Some(status) = &receipt.status {
            println!("status: {status}");
        }
        if let Some(block) = &receipt.block_number {
            println!("block: {block}");
        }
        if let Some(gas) = &receipt.gas_used {
            println!("gas used: {gas}");
        }
    }
    if data.tx_hash.is_none() && !data.tx_output.is_empty() {
        println!("{}", data.tx_output);
    }
    if let Some(path) = &data.history_path {
        println!("history: {path}");
    }
    if let Some(error) = &data.history_error {
        println!("history failed: {error}");
    }
}

pub(crate) fn encode_calldata(signature: &str, args: &[String]) -> Option<String> {
    let output = Command::new("cast")
        .arg("calldata")
        .arg(signature)
        .args(args)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

pub fn state(cli: &Cli, args: &StateArgs) -> AppResult<()> {
    if args.watch && cli.json && !cli.ndjson {
        return Err(AppError::user(
            "ndjson_required",
            "`consol state --watch` is a stream.",
            Some(
                "Use `--ndjson` for watch output, or omit `--watch` for one JSON snapshot."
                    .to_string(),
            ),
        ));
    }

    let context = context(cli, &args.target)?;
    if args.watch {
        return watch_state(cli, &context);
    }

    let data = state_snapshot(&context)?;
    print_state(cli, data, &context)
}

pub fn logs(cli: &Cli, args: &StateArgs) -> AppResult<()> {
    if args.watch && cli.json && !cli.ndjson {
        return Err(AppError::user(
            "ndjson_required",
            "`consol logs --watch` is a stream.",
            Some(
                "Use `--ndjson` for watch output, or omit `--watch` for one JSON snapshot."
                    .to_string(),
            ),
        ));
    }

    let context = context(cli, &args.target)?;
    if args.watch {
        return watch_logs(cli, &context);
    }

    let data = logs_snapshot(&context)?;
    print_logs(cli, data, &context)
}

pub(crate) fn state_snapshot(context: &Context) -> AppResult<StateData> {
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

    Ok(StateData {
        contract: context.resolved.contract_name.clone(),
        address: context.address.clone(),
        values,
    })
}

fn print_state(cli: &Cli, data: StateData, context: &Context) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new("state");
        meta.network = Some(context.network.clone());
        meta.account = Some(context.account.clone());
        output::print_json(data, meta)
    } else {
        print_state_human(&data, None)
    }
}

fn watch_state(cli: &Cli, context: &Context) -> AppResult<()> {
    let mut sequence = 0_u64;
    let limit = watch_tick_limit();
    let interval = watch_interval();

    loop {
        let data = state_snapshot(context)?;
        if cli.ndjson {
            print_state_event(sequence, &data, context)?;
        } else {
            print_state_human(&data, Some(sequence))?;
        }

        sequence += 1;
        if limit.is_some_and(|limit| sequence >= limit) {
            return Ok(());
        }
        thread::sleep(interval);
    }
}

fn print_state_event(sequence: u64, data: &StateData, context: &Context) -> AppResult<()> {
    let event = serde_json::json!({
        "type": "state",
        "sequence": sequence,
        "timestamp_ms": unix_timestamp_ms(),
        "data": data,
        "meta": {
            "version": env!("CARGO_PKG_VERSION"),
            "command": "state --watch",
            "network": &context.network,
            "account": &context.account,
        }
    });
    let mut stdout = io::stdout();
    serde_json::to_writer(&mut stdout, &event)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

fn print_state_human(data: &StateData, sequence: Option<u64>) -> AppResult<()> {
    if let Some(sequence) = sequence {
        println!("state tick #{sequence}");
    }
    println!("{} {}", data.contract, data.address);
    for value in &data.values {
        println!("  {:<32} {}", value.name, value.raw);
    }
    Ok(())
}

pub(crate) fn logs_snapshot(context: &Context) -> AppResult<LogsData> {
    let raw_logs = cast_logs(&context.address, &context.network.rpc_url)?;
    let event_index = event_index(&context.artifact);
    let events = raw_logs
        .into_iter()
        .map(|log| decode_log(log, &event_index))
        .collect::<Vec<_>>();

    Ok(LogsData {
        contract: context.resolved.contract_name.clone(),
        address: context.address.clone(),
        events,
    })
}

fn print_logs(cli: &Cli, data: LogsData, context: &Context) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new("logs");
        meta.network = Some(context.network.clone());
        meta.account = Some(context.account.clone());
        output::print_json(data, meta)
    } else {
        print_logs_human(&data, None)
    }
}

fn watch_logs(cli: &Cli, context: &Context) -> AppResult<()> {
    let mut ticks = 0_u64;
    let mut sequence = 0_u64;
    let mut seen = HashSet::new();
    let limit = watch_tick_limit();
    let interval = watch_interval();

    loop {
        let data = logs_snapshot(context)?;
        for event in data.events {
            let id = log_id(&event);
            if !seen.insert(id) {
                continue;
            }
            if cli.ndjson {
                print_log_event(sequence, &event, context)?;
            } else {
                print_log_human(&event, Some(sequence))?;
            }
            sequence += 1;
        }

        ticks += 1;
        if limit.is_some_and(|limit| ticks >= limit) {
            return Ok(());
        }
        thread::sleep(interval);
    }
}

fn print_log_event(sequence: u64, event: &DecodedLog, context: &Context) -> AppResult<()> {
    let output = serde_json::json!({
        "type": "log",
        "sequence": sequence,
        "timestamp_ms": unix_timestamp_ms(),
        "data": event,
        "meta": {
            "version": env!("CARGO_PKG_VERSION"),
            "command": "logs --watch",
            "network": &context.network,
            "account": &context.account,
        }
    });
    let mut stdout = io::stdout();
    serde_json::to_writer(&mut stdout, &output)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

fn print_logs_human(data: &LogsData, sequence: Option<u64>) -> AppResult<()> {
    println!("{} {}", data.contract, data.address);
    for event in &data.events {
        print_log_human(event, sequence)?;
    }
    Ok(())
}

fn print_log_human(event: &DecodedLog, sequence: Option<u64>) -> AppResult<()> {
    if let Some(sequence) = sequence {
        println!("log event #{sequence}");
    }
    let label = event
        .signature
        .as_deref()
        .or(event.event.as_deref())
        .unwrap_or("unknown");
    println!(
        "  {} block={} tx={}",
        label,
        event
            .block_number
            .map_or("unknown".to_string(), |block| block.to_string()),
        event.transaction_hash.as_deref().unwrap_or("unknown")
    );
    for arg in &event.args {
        println!(
            "    {} {}{} = {}",
            arg.kind,
            arg.name,
            if arg.indexed { " indexed" } else { "" },
            arg.value
        );
    }
    Ok(())
}

pub(crate) struct Context {
    pub(crate) resolved: target::ResolvedTarget,
    pub(crate) artifact: Value,
    pub(crate) address: String,
    pub(crate) network: crate::output::NetworkMeta,
    pub(crate) account: crate::output::AccountMeta,
}

pub(crate) fn context(cli: &Cli, target_value: &str) -> AppResult<Context> {
    let resolved = target::resolve(cli, Some(target_value))?;
    let artifact_path = target::artifact_path(&resolved)?;
    let artifact: Value = serde_json::from_str(&fs::read_to_string(artifact_path)?)?;
    let network = detect::active_network(cli)?;
    let account = detect::active_account(cli)?;
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

pub(crate) fn resolve_function_signature(
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

fn watch_tick_limit() -> Option<u64> {
    std::env::var("CONSOL_WATCH_TICKS")
        .ok()
        .and_then(|value| value.parse().ok())
}

fn watch_interval() -> Duration {
    std::env::var("CONSOL_WATCH_INTERVAL_MS")
        .ok()
        .and_then(|value| value.parse().ok())
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_secs(2))
}

fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn cast_logs(address: &str, rpc_url: &str) -> AppResult<Vec<Value>> {
    let output = Command::new("cast")
        .args([
            "logs",
            "--json",
            "--address",
            address,
            "--from-block",
            "0",
            "--to-block",
            "latest",
            "--rpc-url",
            rpc_url,
        ])
        .output()?;
    if !output.status.success() {
        return Err(AppError::user(
            "logs_failed",
            "cast logs failed.",
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|err| {
        AppError::user(
            "logs_parse_failed",
            format!("Failed to parse cast logs JSON: {err}"),
            Some(String::from_utf8_lossy(&output.stdout).to_string()),
        )
    })
}

fn event_index(artifact: &Value) -> BTreeMap<String, EventAbi> {
    abi_items(artifact)
        .into_iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("event"))
        .filter_map(event_abi)
        .map(|event| (event.topic0.clone(), event))
        .collect()
}

fn event_abi(item: &Value) -> Option<EventAbi> {
    let name = item.get("name").and_then(Value::as_str)?.to_string();
    let signature = signature(item);
    let topic0 = event_topic0(&signature)?;
    let inputs = item
        .get("inputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|input| EventInput {
            name: input
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            kind: input
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            indexed: input
                .get("indexed")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
        .collect();
    Some(EventAbi {
        name,
        signature,
        topic0,
        inputs,
    })
}

fn event_topic0(signature: &str) -> Option<String> {
    let output = Command::new("cast")
        .args(["sig-event", signature])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn decode_log(log: Value, event_index: &BTreeMap<String, EventAbi>) -> DecodedLog {
    let topics = log
        .get("topics")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let event = topics.first().and_then(|topic| event_index.get(topic));
    let args = event
        .map(|event| decode_event_args(event, &topics, log.get("data").and_then(Value::as_str)))
        .unwrap_or_default();

    DecodedLog {
        address: log
            .get("address")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        block_number: log
            .get("blockNumber")
            .and_then(Value::as_str)
            .and_then(hex_u64),
        transaction_hash: log
            .get("transactionHash")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        log_index: log
            .get("logIndex")
            .and_then(Value::as_str)
            .and_then(hex_u64),
        event: event.map(|event| event.name.clone()),
        signature: event.map(|event| event.signature.clone()),
        args,
        raw: log,
    }
}

fn decode_event_args(
    event: &EventAbi,
    topics: &[String],
    data: Option<&str>,
) -> Vec<DecodedLogArg> {
    let non_indexed_types = event
        .inputs
        .iter()
        .filter(|input| !input.indexed)
        .map(|input| input.kind.as_str())
        .collect::<Vec<_>>();
    let decoded_values = if non_indexed_types.is_empty() {
        Vec::new()
    } else {
        data.and_then(|data| decode_abi_values(&non_indexed_types, data))
            .unwrap_or_default()
    };
    let mut indexed_topic = 1_usize;
    let mut decoded_value = 0_usize;

    event
        .inputs
        .iter()
        .map(|input| {
            let value = if input.indexed {
                let value = topics.get(indexed_topic).cloned().unwrap_or_default();
                indexed_topic += 1;
                value
            } else {
                let value = decoded_values
                    .get(decoded_value)
                    .cloned()
                    .unwrap_or_default();
                decoded_value += 1;
                value
            };
            DecodedLogArg {
                name: input.name.clone(),
                kind: input.kind.clone(),
                indexed: input.indexed,
                value,
            }
        })
        .collect()
}

fn decode_abi_values(types: &[&str], data: &str) -> Option<Vec<String>> {
    let signature = format!("__consol_decode()({})", types.join(","));
    let output = Command::new("cast")
        .args(["decode-abi", &signature, data])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
    )
}

fn hex_u64(value: &str) -> Option<u64> {
    u64::from_str_radix(value.trim_start_matches("0x"), 16).ok()
}

fn log_id(event: &DecodedLog) -> String {
    format!(
        "{}:{}:{}",
        event.transaction_hash.as_deref().unwrap_or("unknown"),
        event
            .block_number
            .map_or("unknown".to_string(), |block| block.to_string()),
        event
            .log_index
            .map_or("unknown".to_string(), |index| index.to_string())
    )
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

pub(crate) fn estimate_gas(
    address: &str,
    signature: &str,
    args: &[String],
    value: Option<&str>,
    rpc_url: &str,
    from: Option<&str>,
) -> AppResult<String> {
    let mut command = Command::new("cast");
    command
        .arg("estimate")
        .arg(address)
        .arg(signature)
        .args(args)
        .arg("--rpc-url")
        .arg(rpc_url);
    if let Some(from) = from {
        command.arg("--from").arg(from);
    }
    if let Some(value) = value {
        command.arg("--value").arg(value);
    }
    let output = command.output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(AppError::user(
            "gas_estimate_failed",
            format!("cast estimate failed for {signature}."),
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ))
    }
}

pub(crate) fn call_raw(context: &Context, signature: &str, args: &[String]) -> AppResult<String> {
    cast_call(&context.address, signature, args, &context.network.rpc_url)
}

fn cast_send_output(
    address: &str,
    signature: &str,
    args: &[String],
    value: Option<&str>,
    rpc_url: &str,
    private_key: &str,
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
        .arg(private_key);
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

pub(crate) fn send_raw(
    context: &Context,
    signature: &str,
    args: &[String],
    value: Option<&str>,
    private_key: &str,
) -> AppResult<tx::SubmittedTransaction> {
    let tx_output = cast_send_output(
        &context.address,
        signature,
        args,
        value,
        &context.network.rpc_url,
        private_key,
    )?;
    Ok(tx::submitted_from_cast_output(
        tx_output,
        &context.network.rpc_url,
    ))
}
