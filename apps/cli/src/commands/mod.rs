mod abi;
mod account;
mod activity;
mod analyze;
mod build;
mod cache;
mod chain;
mod console;
mod demo;
mod deploy;
mod detect;
mod dev;
mod gas;
mod hints;
mod init;
mod inspect;
mod interact;
mod network;
mod snapshot;
mod storage;
mod target;
mod test;
mod trace;
mod tx;
mod verify;
mod write;

use crate::cli::{
    AccountCommand, ChainCommand, Cli, Command, GasCommand, NetworkCommand, SignerCommand,
    TxCommand,
};
use crate::error::AppResult;
use crate::output::{self, Meta};

pub fn run(cli: Cli) -> AppResult<()> {
    let result = match &cli.command {
        Command::Detect(args) => detect::run(&cli, args.target.as_deref()),
        Command::Network { command } => match command {
            NetworkCommand::List => network::list(&cli),
            NetworkCommand::Status { name } => network::status(&cli, name.as_deref()),
            NetworkCommand::Add(args) => network::add(&cli, args),
            NetworkCommand::Use { name } => network::use_profile(&cli, name),
            NetworkCommand::Remove { name } => network::remove(&cli, name),
        },
        Command::Account { command } => match command {
            AccountCommand::List => account::list(&cli),
            AccountCommand::Balance { selector } => account::balance(&cli, selector.as_deref()),
            AccountCommand::Use { selector } => account::use_account(&cli, selector),
            AccountCommand::Import(args) => account::import(&cli, args),
        },
        Command::Signer { command } => match command {
            SignerCommand::List => account::signer_list(&cli),
            SignerCommand::Status { name } => account::signer_status(&cli, name.as_deref()),
        },
        Command::Snapshot => snapshot::run(&cli),
        Command::Init(args) => init::run(&cli, args),
        Command::Build(args) => build::run(&cli, args.target.as_deref()),
        Command::Test => test::run(&cli),
        Command::Inspect(args) => inspect::run(&cli, &args.target),
        Command::Abi(args) => abi::run(&cli, &args.target),
        Command::Storage(args) => storage::run(&cli, args),
        Command::Chain { command } => match command {
            ChainCommand::Status => chain::status(&cli),
            ChainCommand::Start => chain::start(&cli),
            ChainCommand::Stop => chain::stop(&cli),
            ChainCommand::Restart => chain::restart(&cli),
        },
        Command::Deploy(args) => deploy::run(&cli, args),
        Command::Call(args) => interact::call(&cli, args),
        Command::Send(args) => interact::send(&cli, args),
        Command::State(args) => interact::state(&cli, args),
        Command::Logs(args) => interact::logs(&cli, args),
        Command::Activity(args) => activity::run(&cli, args),
        Command::Tx { command } => match command {
            TxCommand::List(args) => tx::list(&cli, args),
        },
        Command::Dev(args) => dev::run(&cli, args),
        Command::Console(args) => console::run(&cli, args),
        Command::Demo(args) => demo::run(&cli, args),
        Command::Gas { command } => match command {
            GasCommand::Compile(args) => gas::compile(&cli, args),
            GasCommand::Estimate(args) => gas::estimate(&cli, args),
            GasCommand::Report { match_contract } => gas::report(&cli, match_contract.as_deref()),
            GasCommand::Snapshot { diff, check } => gas::snapshot(&cli, *diff, *check),
        },
        Command::Analyze => analyze::run(&cli),
        Command::Hints(args) => hints::run(&cli, args),
        Command::Trace { tx_hash } => trace::run(&cli, tx_hash),
        Command::Verify(args) => verify::run(&cli, args),
    };

    if cli.json {
        if let Err(err) = result {
            output::print_json_error(&err, Meta::new(command_name(&cli.command)))?;
            return Err(err);
        }
        Ok(())
    } else if cli.ndjson {
        if let Err(err) = result {
            output::print_ndjson_error(&err, 0, Meta::new(command_name(&cli.command)))?;
            return Err(err);
        }
        Ok(())
    } else {
        result
    }
}

fn command_name(command: &Command) -> &'static str {
    match command {
        Command::Init(_) => "init",
        Command::Detect(_) => "detect",
        Command::Build(_) => "build",
        Command::Snapshot => "snapshot",
        Command::Test => "test",
        Command::Inspect(_) => "inspect",
        Command::Abi(_) => "abi",
        Command::Storage(_) => "storage",
        Command::Chain { .. } => "chain",
        Command::Network { .. } => "network",
        Command::Account { .. } => "account",
        Command::Signer { .. } => "signer",
        Command::Deploy(_) => "deploy",
        Command::Call(_) => "call",
        Command::Send(_) => "send",
        Command::State(_) => "state",
        Command::Logs(_) => "logs",
        Command::Activity(_) => "activity",
        Command::Tx { .. } => "tx",
        Command::Dev(_) => "dev",
        Command::Console(_) => "console",
        Command::Demo(_) => "demo",
        Command::Gas { .. } => "gas",
        Command::Analyze => "analyze",
        Command::Hints(_) => "hints",
        Command::Trace { .. } => "trace",
        Command::Verify(_) => "verify",
    }
}
