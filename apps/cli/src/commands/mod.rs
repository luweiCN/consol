mod account;
mod build;
mod detect;
mod inspect;
mod network;
mod snapshot;
mod target;

use crate::cli::{
    AccountCommand, ChainCommand, Cli, Command, GasCommand, NetworkCommand, SignerCommand,
};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};

pub fn run(cli: Cli) -> AppResult<()> {
    let result = match &cli.command {
        Command::Detect(args) => detect::run(&cli, args.target.as_deref()),
        Command::Network { command } => match command {
            NetworkCommand::List => network::list(&cli),
            NetworkCommand::Status { name } => network::status(&cli, name.as_deref()),
            NetworkCommand::Add(_) => planned(&cli, "network add"),
            NetworkCommand::Use { .. } => planned(&cli, "network use"),
            NetworkCommand::Remove { .. } => planned(&cli, "network remove"),
        },
        Command::Account { command } => match command {
            AccountCommand::List => account::list(&cli),
            AccountCommand::Balance { selector } => account::balance(&cli, selector.as_deref()),
            AccountCommand::Use { .. } => planned(&cli, "account use"),
            AccountCommand::Import(_) => planned(&cli, "account import"),
        },
        Command::Signer { command } => match command {
            SignerCommand::List => account::signer_list(&cli),
            SignerCommand::Status { name } => account::signer_status(&cli, name.as_deref()),
        },
        Command::Snapshot => snapshot::run(&cli),
        Command::Init(_) => planned(&cli, "init"),
        Command::Build(args) => build::run(&cli, args.target.as_deref()),
        Command::Test => planned(&cli, "test"),
        Command::Inspect(args) => inspect::run(&cli, &args.target),
        Command::Abi(_) => planned(&cli, "abi"),
        Command::Storage(_) => planned(&cli, "storage"),
        Command::Chain { command } => match command {
            ChainCommand::Status => network::chain_status(&cli),
            ChainCommand::Start => planned(&cli, "chain start"),
            ChainCommand::Stop => planned(&cli, "chain stop"),
            ChainCommand::Restart => planned(&cli, "chain restart"),
        },
        Command::Deploy(_) => planned(&cli, "deploy"),
        Command::Call(_) => planned(&cli, "call"),
        Command::Send(_) => planned(&cli, "send"),
        Command::State(_) => planned(&cli, "state"),
        Command::Logs(_) => planned(&cli, "logs"),
        Command::Dev(_) => planned(&cli, "dev"),
        Command::Console(_) => planned(&cli, "console"),
        Command::Demo(_) => planned(&cli, "demo"),
        Command::Gas { command } => match command {
            GasCommand::Compile(_) => planned(&cli, "gas compile"),
            GasCommand::Estimate(_) => planned(&cli, "gas estimate"),
            GasCommand::Report { .. } => planned(&cli, "gas report"),
            GasCommand::Snapshot { .. } => planned(&cli, "gas snapshot"),
        },
        Command::Analyze => planned(&cli, "analyze"),
        Command::Trace { .. } => planned(&cli, "trace"),
        Command::Verify(_) => planned(&cli, "verify"),
    };

    if cli.json {
        if let Err(err) = result {
            output::print_json_error(&err, Meta::new(command_name(&cli.command)))?;
        }
        Ok(())
    } else {
        result
    }
}

fn planned(cli: &Cli, command: &'static str) -> AppResult<()> {
    if cli.json {
        output::print_json(output::not_implemented_data(command), Meta::new(command))
    } else {
        Err(AppError::not_implemented(command))
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
        Command::Dev(_) => "dev",
        Command::Console(_) => "console",
        Command::Demo(_) => "demo",
        Command::Gas { .. } => "gas",
        Command::Analyze => "analyze",
        Command::Trace { .. } => "trace",
        Command::Verify(_) => "verify",
    }
}
