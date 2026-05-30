use super::detect;
use crate::cli::{Cli, NetworkAddArgs};
use crate::config::{self, Config, NetworkProfile};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta, NetworkMeta};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct NetworkList {
    active: String,
    config_path: String,
    networks: Vec<NetworkListItem>,
}

#[derive(Debug, Serialize)]
struct NetworkListItem {
    name: String,
    active: bool,
    rpc_url: Option<String>,
    rpc_url_env: Option<String>,
    expected_chain_id: Option<u64>,
    chain_id: Option<u64>,
    kind: String,
    fingerprint: Option<String>,
    write_policy: String,
}

#[derive(Debug, Serialize)]
struct NetworkAction {
    action: String,
    name: String,
    active: String,
    config_path: String,
    network: Option<NetworkMeta>,
}

pub fn list(cli: &Cli) -> AppResult<()> {
    let raw_config = config::load()?;
    let runtime_config = config::with_builtin_profiles(raw_config.clone());
    let active = active_name(cli, &runtime_config);
    let network = config::network_by_name_with_config(&runtime_config, &active, cli.chain_id).ok();
    let data = NetworkList {
        active: active.clone(),
        config_path: config::config_path().display().to_string(),
        networks: runtime_config
            .networks
            .iter()
            .map(|(name, profile)| profile_item(&runtime_config, &active, name, profile))
            .collect(),
    };

    if cli.json {
        let mut meta = Meta::new("network list");
        meta.network = network;
        output::print_json(data, meta)
    } else {
        println!("Active network: {}", data.active);
        for network in data.networks {
            let rpc = network
                .rpc_url
                .as_deref()
                .or(network.rpc_url_env.as_deref())
                .unwrap_or("rpc unknown");
            println!(
                "  {}{} {} chain={} policy={}",
                if network.active { "*" } else { " " },
                network.name,
                rpc,
                network
                    .chain_id
                    .or(network.expected_chain_id)
                    .map_or("unknown".to_string(), |id| id.to_string()),
                network.write_policy
            );
        }
        Ok(())
    }
}

pub fn add(cli: &Cli, args: &NetworkAddArgs) -> AppResult<()> {
    if args.name == "local" {
        return Err(AppError::user(
            "network_reserved",
            "`local` is a built-in network profile.",
            Some("Use a different profile name.".to_string()),
        ));
    }
    if args.rpc_url.is_none() && args.rpc_url_env.is_none() {
        return Err(AppError::user(
            "network_rpc_missing",
            "Network add requires `--rpc-url` or `--rpc-url-env`.",
            Some("Example: `consol network add sepolia --rpc-url-env SEPOLIA_RPC_URL --chain-id 11155111`.".to_string()),
        ));
    }

    let mut raw_config = config::load()?;
    let profile = NetworkProfile::new(
        args.rpc_url.clone(),
        args.rpc_url_env.clone(),
        Some(args.chain_id),
        args.write_policy.clone(),
    );
    raw_config
        .networks
        .insert(args.name.clone(), profile.clone());

    let runtime_config = config::with_builtin_profiles(raw_config.clone());
    let network =
        match config::network_by_name_with_config(&runtime_config, &args.name, cli.chain_id) {
            Ok(network) => Some(network),
            Err(_) if env_profile_is_unset(args) => None,
            Err(err) => return Err(err),
        };
    config::save(&raw_config)?;
    print_action(
        cli,
        NetworkAction {
            action: "added".to_string(),
            name: args.name.clone(),
            active: active_name(cli, &runtime_config),
            config_path: config::config_path().display().to_string(),
            network,
        },
    )
}

pub fn use_profile(cli: &Cli, name: &str) -> AppResult<()> {
    let mut raw_config = config::load()?;
    let runtime_config = config::with_builtin_profiles(raw_config.clone());
    let network = config::network_by_name_with_config(&runtime_config, name, cli.chain_id)?;
    raw_config.active_network = Some(name.to_string());
    config::save(&raw_config)?;
    print_action(
        cli,
        NetworkAction {
            action: "selected".to_string(),
            name: name.to_string(),
            active: name.to_string(),
            config_path: config::config_path().display().to_string(),
            network: Some(network),
        },
    )
}

pub fn remove(cli: &Cli, name: &str) -> AppResult<()> {
    if name == "local" {
        return Err(AppError::user(
            "network_reserved",
            "`local` is a built-in network profile and cannot be removed.",
            None,
        ));
    }

    let mut raw_config = config::load()?;
    if raw_config.networks.remove(name).is_none() {
        return Err(AppError::user(
            "network_not_found",
            format!("Network profile `{name}` does not exist."),
            Some("Run `consol network list` to see configured profiles.".to_string()),
        ));
    }
    if raw_config.active_network.as_deref() == Some(name) {
        raw_config.active_network = None;
    }
    config::save(&raw_config)?;
    let runtime_config = config::with_builtin_profiles(raw_config);
    print_action(
        cli,
        NetworkAction {
            action: "removed".to_string(),
            name: name.to_string(),
            active: active_name(cli, &runtime_config),
            config_path: config::config_path().display().to_string(),
            network: None,
        },
    )
}

pub fn status(cli: &Cli, name: Option<&str>) -> AppResult<()> {
    let network = match name {
        Some(name) => config::network_by_name(name, cli.chain_id)?,
        None => detect::active_network(cli)?,
    };
    if cli.json {
        let mut meta = Meta::new("network status");
        meta.network = Some(network.clone());
        output::print_json(network, meta)
    } else {
        println!("Network: {}", network.name);
        println!("  kind: {}", network.kind);
        println!("  rpc: {}", output::redact_rpc_url(&network.rpc_url));
        println!(
            "  chain id: {}",
            network
                .chain_id
                .map_or("unknown".to_string(), |id| id.to_string())
        );
        println!(
            "  fingerprint: {}",
            network.fingerprint.as_deref().unwrap_or("unknown")
        );
        println!("  write policy: {}", network.write_policy);
        Ok(())
    }
}

fn print_action(cli: &Cli, data: NetworkAction) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new(format!("network {}", data.action));
        meta.network = data.network.clone();
        output::print_json(data, meta)
    } else {
        println!("network {}: {}", data.action, data.name);
        println!("  active: {}", data.active);
        println!("  config: {}", data.config_path);
        if let Some(network) = data.network {
            println!("  rpc: {}", output::redact_rpc_url(&network.rpc_url));
            println!(
                "  chain id: {}",
                network
                    .chain_id
                    .map_or("unknown".to_string(), |id| id.to_string())
            );
        }
        Ok(())
    }
}

fn active_name(cli: &Cli, config: &Config) -> String {
    cli.network
        .clone()
        .or_else(|| config.active_network.clone())
        .unwrap_or_else(|| "local".to_string())
}

fn profile_item(
    config: &Config,
    active: &str,
    name: &str,
    profile: &NetworkProfile,
) -> NetworkListItem {
    let resolved = config::network_by_name_with_config(config, name, None).ok();
    NetworkListItem {
        name: name.to_string(),
        active: name == active,
        rpc_url: profile.rpc_url.as_deref().map(output::redact_rpc_url),
        rpc_url_env: profile.rpc_url_env.clone(),
        expected_chain_id: profile.chain_id,
        chain_id: resolved.as_ref().and_then(|network| network.chain_id),
        kind: resolved
            .as_ref()
            .map(|network| network.kind.clone())
            .or_else(|| profile.kind.clone())
            .unwrap_or_else(|| "unknown".to_string()),
        fingerprint: resolved.and_then(|network| network.fingerprint),
        write_policy: profile
            .write_policy
            .clone()
            .unwrap_or_else(|| "confirm".to_string()),
    }
}

fn env_profile_is_unset(args: &NetworkAddArgs) -> bool {
    args.rpc_url.is_none()
        && args
            .rpc_url_env
            .as_ref()
            .is_some_and(|name| std::env::var(name).is_err())
}
