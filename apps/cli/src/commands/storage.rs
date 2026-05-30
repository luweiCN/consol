use crate::cli::{Cli, TargetRequiredArgs};
use crate::commands::{deploy, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::process::Command;

#[derive(Debug, Serialize)]
struct StorageData {
    target: String,
    contract: String,
    source_mode: String,
    project_root: String,
    storage: Vec<StorageSlot>,
    types: BTreeMap<String, Value>,
}

#[derive(Debug, Serialize)]
struct StorageSlot {
    label: String,
    slot: String,
    offset: u64,
    contract: String,
    type_id: String,
    type_label: Option<String>,
    encoding: Option<String>,
    number_of_bytes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ForgeStorageLayout {
    #[serde(default)]
    storage: Vec<ForgeStorageSlot>,

    #[serde(default)]
    types: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize)]
struct ForgeStorageSlot {
    #[serde(rename = "astId")]
    _ast_id: Option<u64>,
    contract: String,
    label: String,
    offset: u64,
    slot: String,
    #[serde(rename = "type")]
    type_id: String,
}

pub fn run(cli: &Cli, args: &TargetRequiredArgs) -> AppResult<()> {
    let data = storage_data(cli, &args.target)?;
    if cli.json {
        let mut meta = Meta::new("storage");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else {
        print_human(&data);
        Ok(())
    }
}

fn storage_data(cli: &Cli, target_value: &str) -> AppResult<StorageData> {
    let resolved = target::resolve(cli, Some(target_value))?;
    deploy::run_forge_build(&resolved.project_root)?;
    let contract_id = deploy::contract_identifier(&resolved)?;
    let layout = forge_storage_layout(&resolved.project_root, &contract_id)?;
    let storage = layout
        .storage
        .into_iter()
        .map(|slot| StorageSlot {
            type_label: type_field(&layout.types, &slot.type_id, "label"),
            encoding: type_field(&layout.types, &slot.type_id, "encoding"),
            number_of_bytes: type_field(&layout.types, &slot.type_id, "numberOfBytes"),
            label: slot.label,
            slot: slot.slot,
            offset: slot.offset,
            contract: slot.contract,
            type_id: slot.type_id,
        })
        .collect();

    Ok(StorageData {
        target: target_value.to_string(),
        contract: resolved.contract_name,
        source_mode: resolved.source_mode.to_string(),
        project_root: resolved.project_root.display().to_string(),
        storage,
        types: layout.types,
    })
}

fn forge_storage_layout(
    project_root: &std::path::Path,
    contract_id: &str,
) -> AppResult<ForgeStorageLayout> {
    let output = Command::new("forge")
        .arg("inspect")
        .arg("--root")
        .arg(project_root)
        .arg(contract_id)
        .arg("storage-layout")
        .arg("--json")
        .output()
        .map_err(|err| {
            AppError::user(
                "storage_inspect_failed",
                format!("Failed to run forge inspect: {err}"),
                Some("Check that Foundry is installed and the target compiles.".to_string()),
            )
        })?;

    if !output.status.success() {
        return Err(AppError::user(
            "storage_inspect_failed",
            "forge inspect storage-layout failed.",
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ));
    }

    serde_json::from_slice(&output.stdout).map_err(|err| {
        let stdout = String::from_utf8_lossy(&output.stdout);
        AppError::user(
            "storage_layout_parse_failed",
            format!("Failed to parse storage layout JSON: {err}"),
            Some(stdout.to_string()),
        )
    })
}

fn type_field(types: &BTreeMap<String, Value>, type_id: &str, field: &str) -> Option<String> {
    types
        .get(type_id)
        .and_then(|value| value.get(field))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn print_human(data: &StorageData) {
    println!("{} storage layout", data.contract);
    if data.storage.is_empty() {
        println!("  no storage entries");
        return;
    }

    for slot in &data.storage {
        let type_label = slot.type_label.as_deref().unwrap_or(&slot.type_id);
        println!(
            "  slot {:<6} offset {:<3} {:<24} {}",
            slot.slot, slot.offset, slot.label, type_label
        );
    }
}
