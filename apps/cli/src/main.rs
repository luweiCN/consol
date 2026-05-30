mod cli;
mod commands;
mod config;
mod error;
mod fs_util;
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
    let json = cli.json;
    let exit_code = match run(cli) {
        Ok(()) => 0,
        Err(err) => {
            if !json {
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
