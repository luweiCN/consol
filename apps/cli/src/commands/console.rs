use crate::cli::{Cli, InvokeArgs, SendArgs, StateArgs, TargetRequiredArgs};
use crate::commands::{detect, interact, target};
use crate::error::AppResult;
use crate::output::{self, Meta};
use serde::Serialize;
use std::io::{self, BufRead, Write};

#[derive(Debug, Serialize)]
struct ConsoleData {
    target: String,
    contract: String,
    source_mode: String,
    project_root: String,
    network: crate::output::NetworkMeta,
    account: crate::output::AccountMeta,
    commands: Vec<&'static str>,
}

pub fn run(cli: &Cli, args: &TargetRequiredArgs) -> AppResult<()> {
    let data = console_data(cli, args)?;
    if cli.json {
        let mut meta = Meta::new("console");
        meta.project_root = Some(data.project_root.clone());
        meta.network = Some(data.network.clone());
        meta.account = Some(data.account.clone());
        return output::print_json(data, meta);
    }
    repl(cli, data)
}

fn console_data(cli: &Cli, args: &TargetRequiredArgs) -> AppResult<ConsoleData> {
    let resolved = target::resolve(cli, Some(&args.target))?;
    let network = detect::active_network(cli)?;
    let account = detect::active_account(cli)?;
    Ok(ConsoleData {
        target: args.target.clone(),
        contract: resolved.contract_name,
        source_mode: resolved.source_mode.to_string(),
        project_root: resolved.project_root.display().to_string(),
        network,
        account,
        commands: vec!["state", "logs", "call", "send", "help", "exit"],
    })
}

fn repl(cli: &Cli, data: ConsoleData) -> AppResult<()> {
    println!(
        "ConSol console: {} on {} as {}",
        data.contract, data.network.name, data.account.name
    );
    println!("Type `help` for commands, `exit` to quit.");

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let mut stdout = io::stdout();
    loop {
        print!("consol:{}> ", data.contract);
        stdout.flush()?;

        let Some(line) = lines.next() else {
            break;
        };
        let line = line?;
        let command = parse_command(&line);
        match command {
            ConsoleCommand::Empty => {}
            ConsoleCommand::Exit => break,
            ConsoleCommand::Help => print_help(),
            ConsoleCommand::State => {
                interact::state(
                    cli,
                    &StateArgs {
                        target: data.target.clone(),
                        watch: false,
                    },
                )?;
            }
            ConsoleCommand::Logs => {
                interact::logs(
                    cli,
                    &StateArgs {
                        target: data.target.clone(),
                        watch: false,
                    },
                )?;
            }
            ConsoleCommand::Call { function, args } => {
                interact::call(
                    cli,
                    &InvokeArgs {
                        target: data.target.clone(),
                        function,
                        args,
                    },
                )?;
            }
            ConsoleCommand::Send {
                function,
                args,
                value,
            } => {
                interact::send(
                    cli,
                    &SendArgs {
                        target: data.target.clone(),
                        function,
                        args,
                        value,
                    },
                )?;
            }
            ConsoleCommand::Unknown(command) => {
                println!("unknown command: {command}");
                println!("Type `help` for commands.");
            }
        }
    }

    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum ConsoleCommand {
    Empty,
    Exit,
    Help,
    State,
    Logs,
    Call {
        function: String,
        args: Vec<String>,
    },
    Send {
        function: String,
        args: Vec<String>,
        value: Option<String>,
    },
    Unknown(String),
}

fn parse_command(line: &str) -> ConsoleCommand {
    let mut parts = line
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return ConsoleCommand::Empty;
    }

    let command = parts.remove(0);
    match command.as_str() {
        "exit" | "quit" | "q" => ConsoleCommand::Exit,
        "help" | "h" | "?" => ConsoleCommand::Help,
        "state" => ConsoleCommand::State,
        "logs" => ConsoleCommand::Logs,
        "call" => parse_call(parts),
        "send" => parse_send(parts),
        _ => ConsoleCommand::Unknown(command),
    }
}

fn parse_call(mut parts: Vec<String>) -> ConsoleCommand {
    if parts.is_empty() {
        return ConsoleCommand::Unknown("call".to_string());
    }
    let function = parts.remove(0);
    ConsoleCommand::Call {
        function,
        args: parts,
    }
}

fn parse_send(mut parts: Vec<String>) -> ConsoleCommand {
    if parts.is_empty() {
        return ConsoleCommand::Unknown("send".to_string());
    }
    let function = parts.remove(0);
    let mut args = Vec::new();
    let mut value = None;
    let mut iter = parts.into_iter();
    while let Some(part) = iter.next() {
        if part == "--value" {
            let Some(amount) = iter.next() else {
                return ConsoleCommand::Unknown("send --value".to_string());
            };
            value = Some(amount);
        } else {
            args.push(part);
        }
    }
    ConsoleCommand::Send {
        function,
        args,
        value,
    }
}

fn print_help() {
    println!("Commands:");
    println!("  state");
    println!("  logs");
    println!("  call <function|signature> [args...]");
    println!("  send <function|signature> [args...] [--value <amount>]");
    println!("  help");
    println!("  exit");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_send_rejects_missing_value_amount() {
        assert_eq!(
            parse_command("send setNumber --value"),
            ConsoleCommand::Unknown("send --value".to_string())
        );
    }

    #[test]
    fn parse_send_separates_value_from_function_args() {
        assert_eq!(
            parse_command("send fund alice --value 100"),
            ConsoleCommand::Send {
                function: "fund".to_string(),
                args: vec!["alice".to_string()],
                value: Some("100".to_string()),
            }
        );
    }
}
