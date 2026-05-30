use super::detect;
use crate::cli::Cli;
use crate::error::AppResult;
use crate::output::{self, Meta, NetworkMeta};
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct NetworkList {
    active: String,
    networks: Vec<NetworkMeta>,
}

#[derive(Debug, Serialize)]
struct ChainStatus {
    running: bool,
    network: NetworkMeta,
    block_number: Option<u64>,
}

pub fn list(cli: &Cli) -> AppResult<()> {
    let network = detect::active_network(cli);
    let data = NetworkList {
        active: network.name.clone(),
        networks: vec![network.clone()],
    };

    if cli.json {
        let mut meta = Meta::new("network list");
        meta.network = Some(network);
        output::print_json(data, meta)
    } else {
        println!("Active network: {}", data.active);
        for network in data.networks {
            println!(
                "  {} {} chain={} policy={}",
                network.name,
                network.rpc_url,
                network
                    .chain_id
                    .map_or("unknown".to_string(), |id| id.to_string()),
                network.write_policy
            );
        }
        Ok(())
    }
}

pub fn status(cli: &Cli, _name: Option<&str>) -> AppResult<()> {
    let network = detect::active_network(cli);
    if cli.json {
        let mut meta = Meta::new("network status");
        meta.network = Some(network.clone());
        output::print_json(network, meta)
    } else {
        println!("Network: {}", network.name);
        println!("  kind: {}", network.kind);
        println!("  rpc: {}", network.rpc_url);
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

pub fn chain_status(cli: &Cli) -> AppResult<()> {
    let network = detect::active_network(cli);
    let block_number = block_number(&network.rpc_url);
    let data = ChainStatus {
        running: network.chain_id.is_some(),
        network: network.clone(),
        block_number,
    };

    if cli.json {
        let mut meta = Meta::new("chain status");
        meta.network = Some(network);
        output::print_json(data, meta)
    } else {
        println!("Chain running: {}", data.running);
        println!("  network: {}", data.network.name);
        println!("  rpc: {}", data.network.rpc_url);
        println!(
            "  chain id: {}",
            data.network
                .chain_id
                .map_or("unknown".to_string(), |id| id.to_string())
        );
        println!(
            "  block: {}",
            data.block_number
                .map_or("unknown".to_string(), |id| id.to_string())
        );
        Ok(())
    }
}

fn block_number(rpc_url: &str) -> Option<u64> {
    let output = Command::new("cast")
        .args(["block-number", "--rpc-url", rpc_url])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}
