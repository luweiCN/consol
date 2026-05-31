use crate::cli::Cli;
use crate::commands::{inspect, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
struct AbiData {
    target: String,
    contract: String,
    source_mode: String,
    project_root: String,
    artifact_path: String,
    abi: Value,
}

pub fn run(cli: &Cli, target_value: &str) -> AppResult<()> {
    let resolved = target::resolve(cli, Some(target_value))?;
    let (artifact_path, artifact) = target::with_scratch_lock(&resolved.project_root, || {
        let artifact_path = target::artifact_path(&resolved)?;
        let artifact = inspect::read_artifact(&artifact_path)?;
        Ok((artifact_path, artifact))
    })?;
    let abi = artifact.get("abi").cloned().ok_or_else(|| {
        AppError::user(
            "artifact_missing_abi",
            format!("Artifact has no ABI: {}", artifact_path.display()),
            Some("Run `consol build` and check that the target is deployable.".to_string()),
        )
    })?;
    let data = AbiData {
        target: target_value.to_string(),
        contract: resolved.contract_name,
        source_mode: resolved.source_mode.to_string(),
        project_root: resolved.project_root.display().to_string(),
        artifact_path: artifact_path.display().to_string(),
        abi,
    };

    if cli.json {
        let mut meta = Meta::new("abi");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else {
        println!("{}", serde_json::to_string_pretty(&data.abi)?);
        Ok(())
    }
}

pub(crate) fn item_signature(item: &Value) -> String {
    let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
    let inputs = item_param_types(item, "inputs").join(",");
    format!("{name}({inputs})")
}

pub(crate) fn item_param_types(item: &Value, field: &str) -> Vec<String> {
    item.get(field)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(param_type)
        .collect()
}

pub(crate) fn param_type(param: &Value) -> String {
    let raw = param
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let Some(tuple_suffix) = raw.strip_prefix("tuple") else {
        return raw.to_string();
    };
    let Some(components) = param.get("components").and_then(Value::as_array) else {
        return raw.to_string();
    };
    if components.is_empty() {
        return raw.to_string();
    }
    let inner = components
        .iter()
        .map(param_type)
        .collect::<Vec<_>>()
        .join(",");
    format!("({inner}){tuple_suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tuple_params_are_rendered_as_canonical_abi_types() {
        let item = serde_json::json!({
            "type": "function",
            "name": "add",
            "inputs": [{
                "name": "profile",
                "type": "tuple",
                "components": [
                    {"name": "name", "type": "string"},
                    {"name": "score", "type": "uint256"}
                ]
            }]
        });

        assert_eq!(item_signature(&item), "add((string,uint256))");
    }

    #[test]
    fn tuple_array_params_keep_array_suffixes() {
        let item = serde_json::json!({
            "type": "function",
            "name": "addMany",
            "inputs": [{
                "name": "profiles",
                "type": "tuple[]",
                "components": [
                    {"name": "owner", "type": "address"},
                    {"name": "scores", "type": "uint256[]"}
                ]
            }]
        });

        assert_eq!(item_signature(&item), "addMany((address,uint256[])[])");
    }
}
