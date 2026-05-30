use crate::cli::{Cli, DemoArgs, DeployArgs};
use crate::commands::{deploy, target};
use crate::error::AppResult;
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct DemoData {
    target: String,
    source_mode: String,
    project_root: String,
    constructor_args: Vec<String>,
    contract: String,
    address: String,
    cached: bool,
    network: String,
    chain_id: Option<u64>,
    next_commands: Vec<String>,
}

pub fn run(cli: &Cli, args: &DemoArgs) -> AppResult<()> {
    let resolved = target::resolve(cli, Some(&args.target))?;
    let source_mode = resolved.source_mode.to_string();
    let project_root = resolved.project_root.display().to_string();
    let deploy_args = DeployArgs {
        target: Some(args.target.clone()),
        all: false,
        list: false,
        forget: None,
        constructor_args: args.constructor_args.clone(),
    };
    let (deployment, network, account) = deploy::execute(cli, &deploy_args)?;
    let data = DemoData {
        target: args.target.clone(),
        source_mode,
        project_root,
        constructor_args: args.constructor_args.clone(),
        contract: deployment.contract,
        address: deployment.address,
        cached: deployment.cached,
        network: deployment.network,
        chain_id: deployment.chain_id,
        next_commands: next_commands(&args.target),
    };
    print(cli, data, network, account)
}

fn print(cli: &Cli, data: DemoData, network: NetworkMeta, account: AccountMeta) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new("demo");
        meta.project_root = Some(data.project_root.clone());
        meta.network = Some(network);
        meta.account = Some(account);
        output::print_json(data, meta)
    } else {
        println!("Demo ready: {} at {}", data.contract, data.address);
        println!("  source mode: {}", data.source_mode);
        println!("  network: {}", data.network);
        println!("  project: {}", data.project_root);
        println!("  next:");
        for command in data.next_commands {
            println!("    {command}");
        }
        Ok(())
    }
}

fn next_commands(target: &str) -> Vec<String> {
    vec![
        format!("consol inspect {target}"),
        format!("consol state {target}"),
        format!("consol call {target} <viewFunction>"),
        format!("consol send {target} <function> <args...> --yes"),
    ]
}
