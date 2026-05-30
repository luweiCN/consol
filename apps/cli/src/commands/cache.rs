use crate::commands::target::{self, ResolvedTarget};
use crate::error::AppResult;
use crate::output::{AccountMeta, NetworkMeta};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct DeploymentCache {
    pub version: u64,
    pub entries: BTreeMap<String, DeploymentEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentEntry {
    pub contract: String,
    pub address: String,
    pub chain_id: Option<u64>,
    pub network: String,
    pub network_fingerprint: Option<String>,
    pub deployer: Option<String>,
    pub bytecode_hash: String,
    pub constructor_args_hash: String,
    pub deploy_tx: Option<String>,
    pub deployed_at_unix: u64,
}

pub fn path(project_root: &Path) -> PathBuf {
    project_root.join(".consol").join("deployments.json")
}

pub fn load(project_root: &Path) -> AppResult<DeploymentCache> {
    let path = path(project_root);
    if !path.exists() {
        return Ok(DeploymentCache {
            version: 1,
            entries: BTreeMap::new(),
        });
    }
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn save(project_root: &Path, cache: &DeploymentCache) -> AppResult<()> {
    let path = path(project_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(cache)?)?;
    Ok(())
}

pub fn key(
    resolved: &ResolvedTarget,
    bytecode_hash: &str,
    constructor_args: &[String],
    network: &NetworkMeta,
    account: &AccountMeta,
) -> String {
    let args_hash = args_hash(constructor_args);
    let network_fingerprint = network.fingerprint.as_deref().unwrap_or(&network.name);
    let deployer = account.address.as_deref().unwrap_or(&account.name);
    format!(
        "{}:{}:{}:{}:{}",
        resolved.contract_name, bytecode_hash, args_hash, network_fingerprint, deployer
    )
}

pub fn latest_for_contract(
    cache: &DeploymentCache,
    resolved: &ResolvedTarget,
    network: &NetworkMeta,
    account: &AccountMeta,
) -> Option<DeploymentEntry> {
    let network_fingerprint = network.fingerprint.as_deref().unwrap_or(&network.name);
    let deployer = account.address.as_deref().unwrap_or(&account.name);
    cache
        .entries
        .values()
        .filter(|entry| {
            entry.contract == resolved.contract_name
                && entry
                    .network_fingerprint
                    .as_deref()
                    .unwrap_or(&entry.network)
                    == network_fingerprint
                && entry.deployer.as_deref().unwrap_or_default() == deployer
        })
        .max_by_key(|entry| entry.deployed_at_unix)
        .cloned()
}

pub fn entry(
    resolved: &ResolvedTarget,
    address: String,
    bytecode_hash: String,
    constructor_args: &[String],
    network: &NetworkMeta,
    account: &AccountMeta,
    deploy_tx: Option<String>,
) -> DeploymentEntry {
    DeploymentEntry {
        contract: resolved.contract_name.clone(),
        address,
        chain_id: network.chain_id,
        network: network.name.clone(),
        network_fingerprint: network.fingerprint.clone(),
        deployer: account
            .address
            .clone()
            .or_else(|| Some(account.name.clone())),
        bytecode_hash,
        constructor_args_hash: args_hash(constructor_args),
        deploy_tx,
        deployed_at_unix: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs()),
    }
}

pub fn args_hash(args: &[String]) -> String {
    target::stable_hash(&args.join("\u{1f}"))
}
