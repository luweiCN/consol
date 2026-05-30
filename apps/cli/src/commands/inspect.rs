use crate::cli::Cli;
use crate::commands::target;
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use serde_json::Value;
use std::fs;

#[derive(Debug, Serialize)]
struct InspectData {
    target: String,
    source_mode: String,
    project_root: String,
    source_file: Option<String>,
    contract_name: String,
    artifact_path: String,
    bytecode_hash: Option<String>,
    abi_summary: AbiSummary,
    functions: Vec<FunctionItem>,
    events: Vec<EventItem>,
    errors: Vec<NamedAbiItem>,
    compiler_gas_estimates: Option<Value>,
}

#[derive(Debug, Serialize)]
struct AbiSummary {
    functions: usize,
    events: usize,
    errors: usize,
    constructor: bool,
}

#[derive(Debug, Serialize)]
struct FunctionItem {
    name: String,
    signature: String,
    state_mutability: String,
    inputs: Vec<ParamItem>,
    outputs: Vec<ParamItem>,
}

#[derive(Debug, Serialize)]
struct EventItem {
    name: String,
    inputs: Vec<ParamItem>,
    anonymous: bool,
}

#[derive(Debug, Serialize)]
struct NamedAbiItem {
    name: String,
    inputs: Vec<ParamItem>,
}

#[derive(Debug, Serialize)]
struct ParamItem {
    name: String,
    kind: String,
}

pub fn run(cli: &Cli, target: &str) -> AppResult<()> {
    let resolved = target::resolve(cli, Some(target))?;
    let artifact_path = target::artifact_path(&resolved)?;
    let artifact = read_artifact(&artifact_path)?;
    let abi = artifact
        .get("abi")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::user(
                "artifact_missing_abi",
                format!("Artifact has no ABI: {}", artifact_path.display()),
                Some("Run `consol build` and check that the target is deployable.".to_string()),
            )
        })?;

    let mut constructor = false;
    let mut functions = Vec::new();
    let mut events = Vec::new();
    let mut errors = Vec::new();

    for item in abi {
        match item.get("type").and_then(Value::as_str).unwrap_or_default() {
            "constructor" => constructor = true,
            "function" => functions.push(parse_function(item)),
            "event" => events.push(parse_event(item)),
            "error" => errors.push(parse_named_item(item)),
            _ => {}
        }
    }

    let bytecode_hash = bytecode_object(&artifact).map(target::stable_hash);
    let compiler_gas_estimates = artifact.get("gasEstimates").cloned();
    let data = InspectData {
        target: target.to_string(),
        source_mode: resolved.source_mode.to_string(),
        project_root: resolved.project_root.display().to_string(),
        source_file: resolved
            .source_file
            .as_ref()
            .map(|path| path.display().to_string()),
        contract_name: resolved.contract_name.clone(),
        artifact_path: artifact_path.display().to_string(),
        bytecode_hash,
        abi_summary: AbiSummary {
            functions: functions.len(),
            events: events.len(),
            errors: errors.len(),
            constructor,
        },
        functions,
        events,
        errors,
        compiler_gas_estimates,
    };

    if cli.json {
        let mut meta = Meta::new("inspect");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else {
        println!("{} ({})", data.contract_name, data.source_mode);
        println!("  artifact: {}", data.artifact_path);
        println!(
            "  bytecode: {}",
            data.bytecode_hash.as_deref().unwrap_or("unknown")
        );
        println!("  functions: {}", data.abi_summary.functions);
        println!("  events: {}", data.abi_summary.events);
        Ok(())
    }
}

pub(crate) fn read_artifact(path: &std::path::Path) -> AppResult<Value> {
    let content = fs::read_to_string(path).map_err(|err| {
        AppError::user(
            "artifact_not_found",
            format!("Failed to read artifact {}: {err}", path.display()),
            Some("Run `consol build` first, or check the target name.".to_string()),
        )
    })?;
    Ok(serde_json::from_str(&content)?)
}

fn parse_function(item: &Value) -> FunctionItem {
    let inputs = params(item.get("inputs"));
    let outputs = params(item.get("outputs"));
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let input_types = inputs
        .iter()
        .map(|param| param.kind.as_str())
        .collect::<Vec<_>>()
        .join(",");
    FunctionItem {
        signature: format!("{name}({input_types})"),
        name,
        state_mutability: item
            .get("stateMutability")
            .and_then(Value::as_str)
            .unwrap_or("nonpayable")
            .to_string(),
        inputs,
        outputs,
    }
}

fn parse_event(item: &Value) -> EventItem {
    EventItem {
        name: item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        inputs: params(item.get("inputs")),
        anonymous: item
            .get("anonymous")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

fn parse_named_item(item: &Value) -> NamedAbiItem {
    NamedAbiItem {
        name: item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        inputs: params(item.get("inputs")),
    }
}

fn params(value: Option<&Value>) -> Vec<ParamItem> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| ParamItem {
            name: item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            kind: item
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        })
        .collect()
}

fn bytecode_object(artifact: &Value) -> Option<&str> {
    artifact
        .get("bytecode")
        .and_then(|bytecode| {
            bytecode
                .get("object")
                .and_then(Value::as_str)
                .or_else(|| bytecode.as_str())
        })
        .filter(|value| !value.is_empty())
}
