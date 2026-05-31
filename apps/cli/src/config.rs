use crate::cli::Cli;
use crate::error::{AppError, AppResult};
use crate::fs_util;
use crate::output::{AccountMeta, NetworkMeta};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_LOCAL_RPC: &str = "http://localhost:8545";
pub const ANVIL0_ADDRESS: &str = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
pub const ANVIL0_PRIVATE_KEY: &str =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub ui: UiConfig,

    pub active_network: Option<String>,

    #[serde(default)]
    pub networks: BTreeMap<String, NetworkProfile>,

    pub active_account: Option<String>,

    #[serde(default)]
    pub accounts: BTreeMap<String, AccountProfile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkProfile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_url_env: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub fork_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub fork_url_env: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub fork_block_number: Option<u64>,

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

    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_env: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub keystore: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub keystore_dir: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_env: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub signer: Option<String>,
}

impl NetworkProfile {
    pub fn new(
        rpc_url: Option<String>,
        rpc_url_env: Option<String>,
        chain_id: Option<u64>,
        write_policy: Option<String>,
        fork_url: Option<String>,
        fork_url_env: Option<String>,
        fork_block_number: Option<u64>,
    ) -> Self {
        let resolved_url = rpc_url.clone().or_else(|| {
            rpc_url_env
                .as_ref()
                .and_then(|name| std::env::var(name).ok())
        });
        let is_fork = fork_url.is_some() || fork_url_env.is_some();
        let kind = if is_fork {
            Some("anvil-fork".to_string())
        } else {
            resolved_url.as_deref().map(detect_kind)
        };
        let write_policy = write_policy.or_else(|| default_write_policy(kind.as_deref(), chain_id));

        Self {
            rpc_url,
            rpc_url_env,
            fork_url,
            fork_url_env,
            fork_block_number,
            chain_id,
            kind,
            write_policy,
        }
    }

    fn local() -> Self {
        Self {
            rpc_url: Some(DEFAULT_LOCAL_RPC.to_string()),
            rpc_url_env: None,
            fork_url: None,
            fork_url_env: None,
            fork_block_number: None,
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

    config_dir().join("config.toml")
}

pub fn config_dir() -> PathBuf {
    config_dir_from_parts(
        std::env::var("CONSOL_CONFIG_DIR").ok().as_deref(),
        std::env::var("CONSOL_CONFIG").ok().as_deref(),
        std::env::var("HOME").ok().as_deref(),
    )
}

pub fn log_dir() -> PathBuf {
    if let Ok(path) = std::env::var("CONSOL_LOG_DIR") {
        return PathBuf::from(path);
    }
    config_dir().join("logs")
}

pub fn dev_log_path() -> PathBuf {
    log_dir().join("consol-dev.log")
}

fn config_dir_from_parts(
    config_dir: Option<&str>,
    config_path: Option<&str>,
    home: Option<&str>,
) -> PathBuf {
    if let Some(path) = config_dir.filter(|path| !path.trim().is_empty()) {
        return PathBuf::from(path);
    }
    if let Some(parent) = config_path
        .filter(|path| !path.trim().is_empty())
        .and_then(|path| Path::new(path).parent())
    {
        return parent.to_path_buf();
    }
    PathBuf::from(home.unwrap_or("."))
        .join(".config")
        .join("consol")
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
    let contents = toml::to_string_pretty(config).map_err(|err| {
        AppError::user(
            "config_serialize_failed",
            format!("Failed to serialize ConSol config: {err}"),
            None,
        )
    })?;
    fs_util::write_private_file(&path, contents)?;
    Ok(())
}

pub fn with_builtin_profiles(mut config: Config) -> Config {
    config
        .networks
        .entry("local".to_string())
        .or_insert_with(NetworkProfile::local);
    config
}

pub fn configured_ui_language() -> Option<String> {
    load()
        .ok()
        .and_then(|config| ui_language_from_config(&config))
}

pub fn ui_language_from_config(config: &Config) -> Option<String> {
    config
        .ui
        .language
        .as_deref()
        .map(str::trim)
        .filter(|language| !language.is_empty())
        .filter(|language| !language.eq_ignore_ascii_case("system"))
        .map(ToOwned::to_owned)
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
        return network_from_parts(&name, rpc_url, cli.chain_id, None, None, None, None);
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
        let account_meta = known_account_meta_from_selector(&config, account)?;
        validate_signer_override_matches_account(cli)?;
        return Ok(account_meta);
    }
    if let Some(signer) = &cli.signer {
        return signer_meta_from_selector(&config, signer);
    }
    if let Some(account) = &config.active_account {
        return known_account_meta_from_selector(&config, account);
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
            signer: account_profile_signer(profile),
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
    if let Some(account) = &cli.account {
        known_account_meta_from_selector(&config, account)?;
        validate_signer_override_matches_account(cli)?;
    }
    let selected = cli
        .signer
        .as_ref()
        .or(cli.account.as_ref())
        .or(config.active_account.as_ref());
    if let Some(selector) = selected {
        return private_key_from_selector(&config, selector, network);
    }

    if let Ok(key) = std::env::var("ETH_PRIVATE_KEY") {
        return Ok(key);
    }

    allow_anvil_key(network)
}

fn known_account_meta_from_selector(config: &Config, selector: &str) -> AppResult<AccountMeta> {
    let account = account_meta_from_selector(config, selector)?;
    if account.signer == "selected" {
        return Err(account_not_found_error(selector));
    }
    Ok(account)
}

fn signer_meta_from_selector(config: &Config, selector: &str) -> AppResult<AccountMeta> {
    let account = account_meta_from_selector(config, selector)?;
    if account.signer == "selected" {
        return Err(signer_not_found_error(selector));
    }
    Ok(account)
}

fn private_key_from_selector(
    config: &Config,
    selector: &str,
    network: &NetworkMeta,
) -> AppResult<String> {
    if selector == "anvil0" {
        return allow_anvil_key(network);
    }
    if selector == "env" {
        return env_private_key("ETH_PRIVATE_KEY");
    }
    if let Some(profile) = config.accounts.get(selector) {
        return private_key_from_profile(selector, profile);
    }
    Err(signer_not_found_error(selector))
}

fn validate_signer_override_matches_account(cli: &Cli) -> AppResult<()> {
    let (Some(account), Some(signer)) = (cli.account.as_deref(), cli.signer.as_deref()) else {
        return Ok(());
    };
    if account == signer {
        return Ok(());
    }
    Err(AppError::user(
        "account_signer_conflict",
        format!("`--account {account}` cannot be combined with `--signer {signer}`."),
        Some(
            "`--signer` is a temporary signer-backed account selector. Use the same profile name or omit one of the flags."
                .to_string(),
        ),
    ))
}

fn account_not_found_error(selector: &str) -> AppError {
    AppError::user(
        "account_not_found",
        format!("Account profile `{selector}` does not exist."),
        Some("Run `consol account list` or import one with `consol account import`.".to_string()),
    )
}

fn signer_not_found_error(selector: &str) -> AppError {
    AppError::user(
        "signer_not_found",
        format!("Signer profile `{selector}` does not exist."),
        Some("Run `consol signer list` or import one with `consol account import`.".to_string()),
    )
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
    let fork_url = resolve_fork_url(name, profile)?;
    network_from_parts(
        name,
        rpc_url,
        chain_id_override.or(profile.chain_id),
        profile.kind.clone(),
        profile.write_policy.clone(),
        fork_url,
        profile.fork_block_number,
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
    if profile.fork_url.is_some() || profile.fork_url_env.is_some() {
        return Ok(DEFAULT_LOCAL_RPC.to_string());
    }
    Err(AppError::user(
        "network_rpc_missing",
        format!("Network `{name}` has no rpc_url or rpc_url_env."),
        Some("Recreate the network profile with `consol network add`.".to_string()),
    ))
}

pub fn resolve_fork_url(name: &str, profile: &NetworkProfile) -> AppResult<Option<String>> {
    if let Some(fork_url) = &profile.fork_url {
        return Ok(Some(fork_url.clone()));
    }
    if let Some(env_name) = &profile.fork_url_env {
        return std::env::var(env_name).map(Some).map_err(|_| {
            AppError::user(
                "network_fork_env_missing",
                format!("Network `{name}` requires fork URL environment variable `{env_name}`."),
                Some(format!(
                    "Set `{env_name}` or update the fork network profile."
                )),
            )
        });
    }
    Ok(None)
}

fn network_from_parts(
    name: &str,
    rpc_url: String,
    expected_chain_id: Option<u64>,
    kind: Option<String>,
    write_policy: Option<String>,
    fork_url: Option<String>,
    fork_block_number: Option<u64>,
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
    let fingerprint = chain_id.map(|id| {
        let mut value = format!("{name}:{id}:{}", rpc_fingerprint(&rpc_url));
        if let Some(fork_url) = &fork_url {
            value.push_str(":fork:");
            value.push_str(&stable_hash(fork_url));
            if let Some(block_number) = fork_block_number {
                value.push(':');
                value.push_str(&block_number.to_string());
            }
        }
        value
    });

    Ok(NetworkMeta {
        name: name.to_string(),
        kind: resolved_kind,
        chain_id,
        rpc_url,
        fork_url,
        fork_block_number,
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

fn private_key_from_profile(selector: &str, profile: &AccountProfile) -> AppResult<String> {
    match account_profile_signer(profile).as_str() {
        "env-private-key" => {
            let Some(env_name) = &profile.private_key_env else {
                return Err(AppError::user(
                    "signer_profile_invalid",
                    format!("Account profile `{selector}` is missing `private_key_env`."),
                    Some("Recreate the account profile with `consol account import`.".to_string()),
                ));
            };
            env_private_key(env_name)
        }
        "keystore" => {
            let keystore = profile.keystore.as_deref().unwrap_or(selector);
            let Some(password_env) = &profile.password_env else {
                return Err(AppError::user(
                    "keystore_password_env_missing",
                    format!("Keystore signer `{selector}` has no password environment variable."),
                    Some("Recreate the account profile with `--password-env <ENV>`.".to_string()),
                ));
            };
            keystore_private_key(keystore, profile.keystore_dir.as_deref(), password_env)
        }
        signer => Err(AppError::user(
            "signer_profile_invalid",
            format!("Account profile `{selector}` uses unsupported signer `{signer}`."),
            Some("Select another account or recreate the account profile.".to_string()),
        )),
    }
}

fn account_profile_signer(profile: &AccountProfile) -> String {
    profile.signer.clone().unwrap_or_else(|| {
        if profile.keystore.is_some() {
            "keystore".to_string()
        } else {
            "env-private-key".to_string()
        }
    })
}

pub fn keystore_private_key(
    keystore: &str,
    keystore_dir: Option<&str>,
    password_env: &str,
) -> AppResult<String> {
    let password = std::env::var(password_env).map_err(|_| {
        AppError::user(
            "keystore_password_env_missing",
            format!("Keystore signer requires environment variable `{password_env}`."),
            Some(format!("Set `{password_env}` or select another account.")),
        )
    })?;
    let mut command = Command::new("cast");
    command
        .args(["wallet", "decrypt-keystore"])
        .arg(keystore)
        .env("CAST_UNSAFE_PASSWORD", password);
    if let Some(dir) = keystore_dir {
        command.args(["--keystore-dir", dir]);
    }
    let output = command.output().map_err(|err| {
        AppError::user(
            "keystore_decrypt_failed",
            format!("Failed to run `cast wallet decrypt-keystore`: {err}"),
            Some("Install Foundry and make sure `cast` is on PATH.".to_string()),
        )
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::user(
            "keystore_decrypt_failed",
            format!("Could not decrypt keystore `{keystore}`."),
            (!stderr.is_empty()).then_some(stderr),
        ));
    }
    parse_private_key_from_text(&String::from_utf8_lossy(&output.stdout)).ok_or_else(|| {
        AppError::user(
            "keystore_decrypt_failed",
            format!("Could not read private key from decrypted keystore `{keystore}`."),
            Some("Check the Foundry keystore output and password.".to_string()),
        )
    })
}

fn parse_private_key_from_text(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|part| part.starts_with("0x") && part.len() == 66)
        .map(|part| part.trim_end_matches('.').to_string())
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
        (Some("anvil-fork"), _) => Some("local".to_string()),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_dir_defaults_to_home_config_consol() {
        assert_eq!(
            config_dir_from_parts(None, None, Some("/Users/tester")),
            PathBuf::from("/Users/tester/.config/consol")
        );
    }

    #[test]
    fn config_dir_prefers_explicit_config_dir() {
        assert_eq!(
            config_dir_from_parts(
                Some("/tmp/consol-config"),
                Some("/other/config.toml"),
                Some("/Users/tester"),
            ),
            PathBuf::from("/tmp/consol-config")
        );
    }

    #[test]
    fn config_dir_follows_config_file_override_parent() {
        assert_eq!(
            config_dir_from_parts(None, Some("/tmp/consol/config.toml"), Some("/Users/tester")),
            PathBuf::from("/tmp/consol")
        );
    }

    #[test]
    fn ui_language_uses_config_value() {
        let config = Config {
            ui: UiConfig {
                language: Some("zh-CN".to_string()),
                theme: None,
            },
            ..Config::default()
        };

        assert_eq!(ui_language_from_config(&config).as_deref(), Some("zh-CN"));
    }

    #[test]
    fn ui_language_system_means_environment_fallback() {
        let config = Config {
            ui: UiConfig {
                language: Some("system".to_string()),
                theme: None,
            },
            ..Config::default()
        };

        assert_eq!(ui_language_from_config(&config), None);
    }
}
