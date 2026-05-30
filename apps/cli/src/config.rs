use crate::cli::Cli;
use crate::error::{AppError, AppResult};
use crate::output::{AccountMeta, NetworkMeta};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const DEFAULT_LOCAL_RPC: &str = "http://localhost:8545";
pub const ANVIL0_ADDRESS: &str = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
pub const ANVIL0_PRIVATE_KEY: &str =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    pub active_network: Option<String>,

    #[serde(default)]
    pub networks: BTreeMap<String, NetworkProfile>,

    pub active_account: Option<String>,

    #[serde(default)]
    pub accounts: BTreeMap<String, AccountProfile>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountProfile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,

    pub private_key_env: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub signer: Option<String>,
}

impl NetworkProfile {
    pub fn new(
        rpc_url: Option<String>,
        rpc_url_env: Option<String>,
        chain_id: Option<u64>,
        write_policy: Option<String>,
    ) -> Self {
        let resolved_url = rpc_url.clone().or_else(|| {
            rpc_url_env
                .as_ref()
                .and_then(|name| std::env::var(name).ok())
        });
        let kind = resolved_url.as_deref().map(detect_kind);
        let write_policy = write_policy.or_else(|| default_write_policy(kind.as_deref(), chain_id));

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
            chain_id: Some(31337),
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

pub fn active_account(cli: &Cli) -> AppResult<AccountMeta> {
    let config = load()?;
    if let Some(account) = &cli.account {
        return account_meta_from_selector(&config, account);
    }
    if let Some(account) = &config.active_account {
        return account_meta_from_selector(&config, account);
    }
    if std::env::var("ETH_PRIVATE_KEY").is_ok() {
        return Ok(env_account_meta());
    }
    Ok(anvil_account_meta())
}

pub fn account_meta_from_selector(config: &Config, selector: &str) -> AppResult<AccountMeta> {
    if selector == "anvil0" {
        return Ok(anvil_account_meta());
    }
    if selector == "env" {
        return Ok(env_account_meta());
    }
    if let Some(profile) = config.accounts.get(selector) {
        return Ok(AccountMeta {
            name: selector.to_string(),
            address: profile.address.clone(),
            signer: profile
                .signer
                .clone()
                .unwrap_or_else(|| "env-private-key".to_string()),
        });
    }
    Ok(AccountMeta {
        name: selector.to_string(),
        address: None,
        signer: "selected".to_string(),
    })
}

pub fn private_key_for_write(cli: &Cli, network: &NetworkMeta) -> AppResult<String> {
    let config = load()?;
    let selected = cli.account.as_ref().or(config.active_account.as_ref());
    if let Some(selector) = selected {
        if selector == "anvil0" {
            return allow_anvil_key(network);
        }
        if selector == "env" {
            return env_private_key("ETH_PRIVATE_KEY");
        }
        if let Some(profile) = config.accounts.get(selector) {
            return env_private_key(&profile.private_key_env);
        }
        return Err(AppError::user(
            "signer_not_found",
            format!("No signer profile found for account `{selector}`."),
            Some(
                "Run `consol account list` or import one with `consol account import`.".to_string(),
            ),
        ));
    }

    if let Ok(key) = std::env::var("ETH_PRIVATE_KEY") {
        return Ok(key);
    }

    allow_anvil_key(network)
}

pub fn private_key_address(private_key: &str) -> Option<String> {
    let output = Command::new("cast")
        .args(["wallet", "address", "--private-key", private_key])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
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
    let resolved_write_policy = write_policy
        .or_else(|| default_write_policy(Some(&resolved_kind), expected_chain_id))
        .unwrap_or_else(|| "confirm".to_string());
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

fn anvil_account_meta() -> AccountMeta {
    AccountMeta {
        name: "anvil0".to_string(),
        address: Some(ANVIL0_ADDRESS.to_string()),
        signer: "anvil-index".to_string(),
    }
}

fn env_account_meta() -> AccountMeta {
    AccountMeta {
        name: "env".to_string(),
        address: std::env::var("ETH_PRIVATE_KEY")
            .ok()
            .and_then(|key| private_key_address(&key)),
        signer: "env-private-key".to_string(),
    }
}

fn env_private_key(env_name: &str) -> AppResult<String> {
    std::env::var(env_name).map_err(|_| {
        AppError::user(
            "signer_env_missing",
            format!("Signer requires environment variable `{env_name}`."),
            Some(format!("Set `{env_name}` or select another account.")),
        )
    })
}

fn allow_anvil_key(network: &NetworkMeta) -> AppResult<String> {
    if network.write_policy == "local" {
        Ok(ANVIL0_PRIVATE_KEY.to_string())
    } else {
        Err(AppError::user(
            "remote_signer_required",
            format!("Network `{}` is not local; refusing to use the Anvil default key.", network.name),
            Some("Set ETH_PRIVATE_KEY or run `consol account import <name> --private-key-env <ENV>` and `consol account use <name>`.".to_string()),
        ))
    }
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

fn default_write_policy(kind: Option<&str>, chain_id: Option<u64>) -> Option<String> {
    match (kind, chain_id) {
        (Some("anvil"), _) => Some("local".to_string()),
        (_, Some(1)) => Some("typed-confirm".to_string()),
        (Some(_), _) => Some("confirm".to_string()),
        _ => None,
    }
}

fn is_local_rpc(rpc_url: &str) -> bool {
    matches!(
        rpc_host(rpc_url).as_deref(),
        Some("localhost" | "127.0.0.1" | "::1")
    )
}

fn rpc_fingerprint(rpc_url: &str) -> String {
    if is_local_rpc(rpc_url) {
        "localhost".to_string()
    } else {
        stable_hash(rpc_url)
    }
}

fn rpc_host(rpc_url: &str) -> Option<String> {
    let value = rpc_url.trim();
    let authority = value
        .split_once("://")
        .map_or(value, |(_, rest)| rest)
        .split(['/', '?', '#'])
        .next()?;
    let host_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if let Some(rest) = host_port.strip_prefix('[') {
        return rest
            .split_once(']')
            .map(|(host, _)| host.to_ascii_lowercase());
    }
    let host = host_port
        .split_once(':')
        .map_or(host_port, |(host, _)| host);
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
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
