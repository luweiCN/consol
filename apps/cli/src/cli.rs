use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "consol")]
#[command(bin_name = "consol")]
#[command(version)]
#[command(about = "ConSol — the smart contract console.")]
#[command(
    long_about = "ConSol is a terminal-first Solidity/EVM development console built on Foundry."
)]
pub struct Cli {
    #[arg(long, global = true, help = "Output a JSON envelope")]
    pub json: bool,

    #[arg(long, global = true, help = "Output watch/stream events as NDJSON")]
    pub ndjson: bool,

    #[arg(long, global = true, help = "Select a consol.toml profile")]
    pub profile: Option<String>,

    #[arg(long, global = true, help = "Select a named network profile")]
    pub network: Option<String>,

    #[arg(long, global = true, help = "Temporarily override RPC URL")]
    pub rpc_url: Option<String>,

    #[arg(long, global = true, help = "Expected chain-id guard")]
    pub chain_id: Option<u64>,

    #[arg(long, global = true, help = "Select an account")]
    pub account: Option<String>,

    #[arg(long, global = true, help = "Select a signer source")]
    pub signer: Option<String>,

    #[arg(long, global = true, help = "Project root")]
    pub project: Option<PathBuf>,

    #[arg(long, global = true, help = "Skip local/dev confirmation prompts")]
    pub yes: bool,

    #[arg(
        long,
        global = true,
        value_name = "NETWORK",
        help = "Machine-confirm writes only when the active network name matches"
    )]
    pub confirm_network: Option<String>,

    #[arg(long, global = true, help = "Disable colored human output")]
    pub no_color: bool,

    #[arg(short = 'v', action = clap::ArgAction::Count, global = true, help = "Increase log verbosity")]
    pub verbose: u8,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Init(InitArgs),
    Detect(TargetArgs),
    Build(TargetArgs),
    Snapshot,
    Test,
    Inspect(TargetRequiredArgs),
    Abi(TargetRequiredArgs),
    Storage(TargetRequiredArgs),
    Chain {
        #[command(subcommand)]
        command: ChainCommand,
    },
    Network {
        #[command(subcommand)]
        command: NetworkCommand,
    },
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    Signer {
        #[command(subcommand)]
        command: SignerCommand,
    },
    Deploy(DeployArgs),
    Call(InvokeArgs),
    Send(SendArgs),
    State(StateArgs),
    Logs(StateArgs),
    Tx {
        #[command(subcommand)]
        command: TxCommand,
    },
    Dev(TargetArgs),
    Console(TargetRequiredArgs),
    Demo(DeployArgs),
    Gas {
        #[command(subcommand)]
        command: GasCommand,
    },
    Analyze,
    Hints(HintsArgs),
    Trace {
        tx_hash: String,
    },
    Verify(VerifyArgs),
}

#[derive(Debug, Args)]
pub struct InitArgs {
    #[arg(long)]
    pub from_file: Option<PathBuf>,

    #[arg(long)]
    pub to: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct TargetArgs {
    pub target: Option<String>,
}

#[derive(Debug, Args)]
pub struct TargetRequiredArgs {
    pub target: String,
}

#[derive(Debug, Args)]
pub struct DeployArgs {
    pub target: String,
    pub constructor_args: Vec<String>,
}

#[derive(Debug, Args)]
pub struct InvokeArgs {
    pub target: String,
    pub function: String,
    pub args: Vec<String>,
}

#[derive(Debug, Args)]
pub struct SendArgs {
    pub target: String,
    pub function: String,
    pub args: Vec<String>,

    #[arg(long)]
    pub value: Option<String>,
}

#[derive(Debug, Args)]
pub struct StateArgs {
    pub target: String,

    #[arg(long)]
    pub watch: bool,
}

#[derive(Debug, Subcommand)]
pub enum TxCommand {
    List(TxListArgs),
}

#[derive(Debug, Args)]
pub struct TxListArgs {
    pub target: Option<String>,

    #[arg(long, default_value_t = 20)]
    pub limit: usize,
}

#[derive(Debug, Args)]
pub struct VerifyArgs {
    pub target: String,

    #[arg(long)]
    pub address: Option<String>,

    #[arg(long)]
    pub chain: Option<String>,

    #[arg(long)]
    pub verifier: Option<String>,

    #[arg(long)]
    pub verifier_url: Option<String>,

    #[arg(long)]
    pub verifier_api_key: Option<String>,

    #[arg(long)]
    pub etherscan_api_key: Option<String>,

    #[arg(long)]
    pub constructor_args: Option<String>,

    #[arg(long)]
    pub constructor_args_path: Option<PathBuf>,

    #[arg(long)]
    pub guess_constructor_args: bool,

    #[arg(long)]
    pub watch: bool,

    #[arg(long)]
    pub show_standard_json_input: bool,
}

#[derive(Debug, Args)]
pub struct HintsArgs {
    #[arg(long)]
    pub file: PathBuf,

    #[arg(long)]
    pub contract: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum ChainCommand {
    Start,
    Stop,
    Restart,
    Status,
}

#[derive(Debug, Subcommand)]
pub enum NetworkCommand {
    List,
    Add(NetworkAddArgs),
    Use { name: String },
    Status { name: Option<String> },
    Remove { name: String },
}

#[derive(Debug, Args)]
pub struct NetworkAddArgs {
    pub name: String,

    #[arg(long, conflicts_with = "rpc_url_env")]
    pub rpc_url: Option<String>,

    #[arg(long)]
    pub rpc_url_env: Option<String>,

    #[arg(long, conflicts_with = "fork_url_env")]
    pub fork_url: Option<String>,

    #[arg(long)]
    pub fork_url_env: Option<String>,

    #[arg(long)]
    pub fork_block_number: Option<u64>,

    #[arg(long)]
    pub chain_id: Option<u64>,

    #[arg(long, value_parser = ["confirm", "typed-confirm", "read-only"])]
    pub write_policy: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum AccountCommand {
    List,
    Use { selector: String },
    Import(AccountImportArgs),
    Balance { selector: Option<String> },
}

#[derive(Debug, Args)]
pub struct AccountImportArgs {
    pub name: String,

    #[arg(long)]
    pub private_key_env: Option<String>,

    #[arg(long, conflicts_with = "private_key_env")]
    pub keystore: Option<String>,

    #[arg(long)]
    pub keystore_dir: Option<String>,

    #[arg(long)]
    pub password_env: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum SignerCommand {
    List,
    Status { name: Option<String> },
}

#[derive(Debug, Subcommand)]
pub enum GasCommand {
    Compile(TargetRequiredArgs),
    Estimate(SendArgs),
    Report {
        #[arg(long)]
        match_contract: Option<String>,
    },
    Snapshot {
        #[arg(long)]
        diff: bool,

        #[arg(long)]
        check: bool,
    },
}
