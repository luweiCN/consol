mod cli;
mod commands;
mod config;
mod error;
mod fs_util;
mod i18n;
mod output;

use clap::Parser;
use cli::Cli;
use error::AppResult;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .without_time()
        .with_target(false)
        .init();

    let cli = Cli::parse();
    let machine_output = cli.json || cli.ndjson;
    let exit_code = match run(cli) {
        Ok(()) => 0,
        Err(err) => {
            if !machine_output {
                eprintln!("error: {err}");
            }
            1
        }
    };
    std::process::exit(exit_code);
}

fn run(cli: Cli) -> AppResult<()> {
    commands::run(cli)
}
