use super::detect;
use crate::cli::Cli;
use crate::error::AppResult;
use crate::output::{self, Meta, NetworkMeta};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct NetworkList {
    active: String,
    networks: Vec<NetworkMeta>,
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
