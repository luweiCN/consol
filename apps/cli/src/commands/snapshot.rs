use super::detect;
use crate::cli::Cli;
use crate::error::AppResult;
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct Snapshot {
    source_mode: detect::SourceMode,
    project_root: Option<String>,
    network: NetworkMeta,
    account: AccountMeta,
    contracts: Vec<serde_json::Value>,
    deployments: Vec<serde_json::Value>,
    diagnostics: Vec<serde_json::Value>,
    recent_history: Vec<serde_json::Value>,
}

pub fn run(cli: &Cli) -> AppResult<()> {
    let detected = detect::detect(cli, None)?;
    let data = Snapshot {
        source_mode: detected.source_mode,
        project_root: detected.project_root.clone(),
        network: detected.network.clone(),
        account: detected.account.clone(),
        contracts: vec![],
        deployments: vec![],
        diagnostics: vec![],
        recent_history: vec![],
    };

    if cli.json {
        let mut meta = Meta::new("snapshot");
        meta.project_root = data.project_root.clone();
        meta.network = Some(data.network.clone());
        meta.account = Some(data.account.clone());
        output::print_json(data, meta)
    } else {
        println!("ConSol snapshot");
        println!("  source mode: {:?}", data.source_mode);
        println!(
            "  project root: {}",
            data.project_root.as_deref().unwrap_or("not found")
        );
        println!("  network: {}", data.network.name);
        println!("  account: {}", data.account.name);
        println!("  contracts: {}", data.contracts.len());
        println!("  deployments: {}", data.deployments.len());
        println!("  diagnostics: {}", data.diagnostics.len());
        Ok(())
    }
}
