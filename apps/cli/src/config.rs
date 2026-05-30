use crate::cli::Cli;
use crate::error::{AppError, AppResult};
use crate::output::NetworkMeta;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const DEFAULT_LOCAL_RPC: &str = "http://localhost:8545";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    pub active_network: Option<String>,

    #[serde(default)]
    pub networks: BTreeMap<String, NetworkProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkProfile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_url_env: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_id: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_policy: Option<String>,
}

impl NetworkProfile {
    pub fn new(
        rpc_url: Option<String>,
        rpc_url_env: Option<String>,
        chain_id: Option<u64>,
    ) -> Self {
        let resolved_url = rpc_url.clone().or_else(|| {
            rpc_url_env
                .as_ref()
                .and_then(|name| std::env::var(name).ok())
        });
        let kind = resolved_url.as_deref().map(detect_kind);
        let write_policy = kind.as_deref().map(default_write_policy);

        Self {
            rpc_url,
            rpc_url_env,
            chain_id,
            kind,
            write_policy,
        }
    }

    fn local() -> Self {
        Self {
            rpc_url: Some(DEFAULT_LOCAL_RPC.to_string()),
            rpc_url_env: None,
            chain_id: None,
            kind: Some("anvil".to_string()),
            write_policy: Some("local".to_string()),
        }
    }
}

pub fn config_path() -> PathBuf {
    if let Ok(path) = std::env::var("CONSOL_CONFIG") {
        return PathBuf::from(path);
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".config")
        .join("consol")
        .join("config.toml")
}

pub fn load() -> AppResult<Config> {
    let path = config_path();
    if !path.exists() {
        return Ok(Config::default());
    }

    let contents = fs::read_to_string(&path)?;
    let config = toml::from_str(&contents).map_err(|err| {
        AppError::user(
            "config_invalid",
            format!("Invalid ConSol config: {err}"),
            Some(format!("Fix or remove {}", path.display())),
        )
    })?;
    Ok(config)
}

pub fn save(config: &Config) -> AppResult<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = toml::to_string_pretty(config).map_err(|err| {
        AppError::user(
            "config_serialize_failed",
            format!("Failed to serialize ConSol config: {err}"),
            None,
        )
    })?;
    fs::write(path, contents)?;
    Ok(())
}

pub fn with_builtin_profiles(mut config: Config) -> Config {
    config
        .networks
        .entry("local".to_string())
        .or_insert_with(NetworkProfile::local);
    config
}

pub fn active_network(cli: &Cli) -> AppResult<NetworkMeta> {
    if let Some(rpc_url) = cli
        .rpc_url
        .clone()
        .or_else(|| std::env::var("ETH_RPC_URL").ok())
    {
        let name = cli.network.clone().unwrap_or_else(|| {
            if is_local_rpc(&rpc_url) {
                "local".to_string()
            } else {
                "custom".to_string()
            }
        });
        return network_from_parts(&name, rpc_url, cli.chain_id, None, None);
    }

    let config = with_builtin_profiles(load()?);
    let name = cli
        .network
        .clone()
        .or_else(|| config.active_network.clone())
        .unwrap_or_else(|| "local".to_string());
    network_by_name_with_config(&config, &name, cli.chain_id)
}

pub fn network_by_name(name: &str, chain_id_override: Option<u64>) -> AppResult<NetworkMeta> {
    let config = with_builtin_profiles(load()?);
    network_by_name_with_config(&config, name, chain_id_override)
}

pub fn network_by_name_with_config(
    config: &Config,
    name: &str,
    chain_id_override: Option<u64>,
) -> AppResult<NetworkMeta> {
    let profile = config.networks.get(name).ok_or_else(|| {
        AppError::user(
            "network_not_found",
            format!("Network profile `{name}` does not exist."),
            Some("Run `consol network list` or add it with `consol network add`.".to_string()),
        )
    })?;
    let rpc_url = resolve_rpc_url(name, profile)?;
    network_from_parts(
        name,
        rpc_url,
        chain_id_override.or(profile.chain_id),
        profile.kind.clone(),
        profile.write_policy.clone(),
    )
}

pub fn resolve_rpc_url(name: &str, profile: &NetworkProfile) -> AppResult<String> {
    if let Some(rpc_url) = &profile.rpc_url {
        return Ok(rpc_url.clone());
    }
    if let Some(env_name) = &profile.rpc_url_env {
        return std::env::var(env_name).map_err(|_| {
            AppError::user(
                "network_rpc_env_missing",
                format!("Network `{name}` requires environment variable `{env_name}`."),
                Some(format!("Set `{env_name}` or update the network profile.")),
            )
        });
    }
    Err(AppError::user(
        "network_rpc_missing",
        format!("Network `{name}` has no rpc_url or rpc_url_env."),
        Some("Recreate the network profile with `consol network add`.".to_string()),
    ))
}

fn network_from_parts(
    name: &str,
    rpc_url: String,
    expected_chain_id: Option<u64>,
    kind: Option<String>,
    write_policy: Option<String>,
) -> AppResult<NetworkMeta> {
    let detected_chain_id = detect_chain_id(&rpc_url);
    if let (Some(expected), Some(actual)) = (expected_chain_id, detected_chain_id) {
        if expected != actual {
            return Err(AppError::user(
                "chain_id_mismatch",
                format!("Network `{name}` expected chain id {expected}, got {actual}."),
                Some("Use the correct RPC URL or update the network profile.".to_string()),
            ));
        }
    }

    let resolved_kind = kind.unwrap_or_else(|| detect_kind(&rpc_url).to_string());
    let resolved_write_policy =
        write_policy.unwrap_or_else(|| default_write_policy(&resolved_kind).to_string());
    let chain_id = detected_chain_id.or(expected_chain_id);
    let fingerprint = chain_id.map(|id| format!("{name}:{id}:{}", rpc_fingerprint(&rpc_url)));

    Ok(NetworkMeta {
        name: name.to_string(),
        kind: resolved_kind,
        chain_id,
        rpc_url,
        fingerprint,
        write_policy: resolved_write_policy,
    })
}

fn detect_chain_id(rpc_url: &str) -> Option<u64> {
    let output = Command::new("cast")
        .args(["chain-id", "--rpc-url", rpc_url])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

fn detect_kind(rpc_url: &str) -> String {
    if is_local_rpc(rpc_url) {
        "anvil".to_string()
    } else {
        "remote".to_string()
    }
}

fn default_write_policy(kind: &str) -> String {
    if kind == "anvil" {
        "local".to_string()
    } else {
        "confirm".to_string()
    }
}

fn is_local_rpc(rpc_url: &str) -> bool {
    rpc_url.contains("localhost") || rpc_url.contains("127.0.0.1")
}

fn rpc_fingerprint(rpc_url: &str) -> String {
    if is_local_rpc(rpc_url) {
        "localhost".to_string()
    } else {
        stable_hash(rpc_url)
    }
}

fn stable_hash(value: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
