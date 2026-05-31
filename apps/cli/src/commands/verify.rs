use crate::cli::{Cli, VerifyArgs};
use crate::commands::{deploy, detect, interact, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct VerifyData {
    target: String,
    contract: String,
    contract_id: String,
    project_root: String,
    address: String,
    chain: Option<String>,
    verifier: Option<String>,
    show_standard_json_input: bool,
    status: String,
    stdout: String,
    stderr: String,
}

pub fn run(cli: &Cli, args: &VerifyArgs) -> AppResult<()> {
    let data = verify_data(cli, args)?;
    if cli.json {
        let mut meta = Meta::new("verify");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else if data.status == "success" {
        if !data.stdout.trim().is_empty() {
            print!("{}", data.stdout);
        }
        if !data.stderr.trim().is_empty() {
            eprint!("{}", data.stderr);
        }
        Ok(())
    } else {
        Err(AppError::user(
            "verify_failed",
            "forge verify-contract failed.",
            Some(if data.stderr.trim().is_empty() {
                data.stdout
            } else {
                data.stderr
            }),
        ))
    }
}

fn verify_data(cli: &Cli, args: &VerifyArgs) -> AppResult<VerifyData> {
    if args.constructor_args.is_some() && args.constructor_args_path.is_some() {
        return Err(AppError::user(
            "verify_constructor_args_conflict",
            "`verify` accepts only one of `--constructor-args` or `--constructor-args-path`.",
            Some(
                "Pass raw constructor args directly, or pass a file path, but not both."
                    .to_string(),
            ),
        ));
    }

    let resolved = target::resolve(cli, Some(&args.target))?;
    deploy::run_forge_build(&resolved.project_root)?;
    let contract_id = deploy::contract_identifier(&resolved)?;
    let network = detect::active_network(cli)?;
    let address = verify_address(cli, args)?;
    let chain = args
        .chain
        .clone()
        .or_else(|| network.chain_id.map(|chain_id| chain_id.to_string()));

    let mut command = Command::new("forge");
    command
        .arg("verify-contract")
        .arg(&address)
        .arg(&contract_id)
        .arg("--root")
        .arg(&resolved.project_root)
        .arg("--rpc-url")
        .arg(&network.rpc_url)
        .arg("--color")
        .arg("never");

    if let Some(chain) = &chain {
        command.arg("--chain").arg(chain);
    }
    if let Some(verifier) = &args.verifier {
        command.arg("--verifier").arg(verifier);
    }
    if let Some(verifier_url) = &args.verifier_url {
        command.arg("--verifier-url").arg(verifier_url);
    }
    if let Some(verifier_api_key) = &args.verifier_api_key {
        command.arg("--verifier-api-key").arg(verifier_api_key);
    }
    if let Some(etherscan_api_key) = &args.etherscan_api_key {
        command.arg("--etherscan-api-key").arg(etherscan_api_key);
    }
    if let Some(constructor_args) = &args.constructor_args {
        command.arg("--constructor-args").arg(constructor_args);
    }
    if let Some(constructor_args_path) = &args.constructor_args_path {
        command
            .arg("--constructor-args-path")
            .arg(constructor_args_path);
    }
    if args.guess_constructor_args {
        command.arg("--guess-constructor-args");
    }
    if args.watch {
        command.arg("--watch");
    }
    if args.show_standard_json_input {
        command.arg("--show-standard-json-input");
    }

    let output = command.output().map_err(|err| {
        AppError::user(
            "verify_failed",
            format!("Failed to run forge verify-contract: {err}"),
            Some("Install Foundry and make sure `forge` is on PATH.".to_string()),
        )
    })?;

    Ok(VerifyData {
        target: args.target.clone(),
        contract: resolved.contract_name,
        contract_id,
        project_root: resolved.project_root.display().to_string(),
        address,
        chain,
        verifier: args.verifier.clone(),
        show_standard_json_input: args.show_standard_json_input,
        status: if output.status.success() {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn verify_address(cli: &Cli, args: &VerifyArgs) -> AppResult<String> {
    if let Some(address) = &args.address {
        return Ok(address.clone());
    }

    interact::context(cli, &args.target)
        .map(|context| context.address)
        .map_err(|err| {
            AppError::user(
                "verify_address_required",
                "No verification address was provided.",
                Some(format!(
                    "Pass `--address <address>` or deploy the target first. Last lookup error: {}",
                    err.message()
                )),
            )
        })
}
