use crate::cli::Cli;
use crate::config;
use crate::error::{AppError, AppResult};
use crate::output::{AccountMeta, NetworkMeta};
use serde::Serialize;
use std::io::{self, Write};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GasSignal {
    pub(crate) estimate: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct WritePreview {
    pub(crate) action: &'static str,
    pub(crate) contract: String,
    pub(crate) target: Option<String>,
    pub(crate) address: Option<String>,
    pub(crate) function: Option<String>,
    pub(crate) value: Option<String>,
    pub(crate) gas: GasSignal,
    pub(crate) details: WritePreviewDetails,
}

#[derive(Debug, Clone, Default, Serialize)]
pub(crate) struct WritePreviewDetails {
    pub(crate) signer_address: Option<String>,
    pub(crate) nonce: Option<String>,
    pub(crate) gas_price: Option<String>,
    pub(crate) calldata_hash: Option<String>,
    pub(crate) calldata_prefix: Option<String>,
}

pub(crate) fn private_key_for_write(
    cli: &Cli,
    network: &NetworkMeta,
    account: &AccountMeta,
) -> AppResult<(String, String)> {
    let private_key = config::private_key_for_write(cli, network)?;
    let signer_address = validate_signer_address(&private_key, account)?;
    Ok((private_key, signer_address))
}

pub(crate) fn preview_details(
    network: &NetworkMeta,
    signer_address: Option<&str>,
    calldata: Option<&str>,
) -> WritePreviewDetails {
    WritePreviewDetails {
        signer_address: signer_address.map(ToOwned::to_owned),
        nonce: signer_address.and_then(|address| nonce(address, &network.rpc_url)),
        gas_price: gas_price(&network.rpc_url),
        calldata_hash: calldata.and_then(keccak_calldata_hash),
        calldata_prefix: calldata.map(calldata_prefix),
    }
}

pub(crate) fn confirm_write(
    cli: &Cli,
    network: &NetworkMeta,
    account: &AccountMeta,
    preview: &WritePreview,
) -> AppResult<()> {
    if network.write_policy == "read-only" {
        return Err(read_only_error(network));
    }
    let machine_confirmed = confirm_network_token(cli, network)?;
    match network.write_policy.as_str() {
        "local" => Ok(()),
        "confirm" | "typed-confirm" if machine_confirmed => Ok(()),
        "confirm" | "typed-confirm" => confirm_remote_write(cli, network, account, preview),
        other => Err(AppError::user(
            "write_policy_unknown",
            format!(
                "Network `{}` has unsupported write_policy `{other}`.",
                network.name
            ),
            Some("Use `local`, `confirm`, `typed-confirm`, or `read-only`.".to_string()),
        )),
    }
}

pub(crate) fn preflight_write_policy(cli: &Cli, network: &NetworkMeta) -> AppResult<()> {
    if network.write_policy == "read-only" {
        return Err(read_only_error(network));
    }
    let machine_confirmed = confirm_network_token(cli, network)?;
    match network.write_policy.as_str() {
        "local" => Ok(()),
        "confirm" | "typed-confirm" if machine_confirmed => Ok(()),
        "confirm" | "typed-confirm" if cli.yes => Err(AppError::user(
            "remote_confirmation_required",
            format!(
                "`--yes` cannot approve writes on network `{}`.",
                network.name
            ),
            Some(format!(
                "Run without `--yes` and confirm interactively, or pass `--confirm-network {}` to approve this exact network for machine output.",
                network.name
            )),
        )),
        "confirm" | "typed-confirm" if cli.json || cli.ndjson => Err(AppError::user(
            "remote_confirmation_required",
            format!("Write on network `{}` requires confirmation.", network.name),
            Some(format!(
                "Use human output for interactive confirmation, or pass `--confirm-network {}` to approve this exact network for machine output.",
                network.name
            )),
        )),
        "confirm" | "typed-confirm" => Ok(()),
        other => Err(AppError::user(
            "write_policy_unknown",
            format!(
                "Network `{}` has unsupported write_policy `{other}`.",
                network.name
            ),
            Some("Use `local`, `confirm`, `typed-confirm`, or `read-only`.".to_string()),
        )),
    }
}

fn read_only_error(network: &NetworkMeta) -> AppError {
    AppError::user(
        "write_policy_read_only",
        format!("Network `{}` is read-only.", network.name),
        Some(
            "Select another network profile before deploying or sending transactions.".to_string(),
        ),
    )
}

fn confirm_network_token(cli: &Cli, network: &NetworkMeta) -> AppResult<bool> {
    let Some(confirmed) = cli.confirm_network.as_deref() else {
        return Ok(false);
    };
    if confirmed != network.name {
        return Err(AppError::user(
            "remote_confirmation_mismatch",
            format!(
                "`--confirm-network {confirmed}` does not match active network `{}`.",
                network.name
            ),
            Some(format!(
                "Remove `--confirm-network` or pass `--confirm-network {}` after verifying the active RPC and chain id.",
                network.name
            )),
        ));
    }
    if network.write_policy != "local" && cli.yes {
        return Err(AppError::user(
            "confirmation_mode_conflict",
            format!(
                "`--yes` cannot be combined with `--confirm-network {confirmed}` on network `{}`.",
                network.name
            ),
            Some(format!(
                "Remove `--yes`; `--confirm-network {}` is the non-interactive confirmation for this remote write.",
                network.name
            )),
        ));
    }
    if network.write_policy != "local" && cli.rpc_url.is_some() {
        return Err(named_network_required_error());
    }
    if network.write_policy != "local" && std::env::var("ETH_RPC_URL").is_ok() {
        return Err(named_network_required_error());
    }
    Ok(true)
}

fn named_network_required_error() -> AppError {
    AppError::user(
        "machine_confirmation_named_network_required",
        "`--confirm-network` requires a named network profile for non-local writes.",
        Some(
            "Create a profile with `consol network add <name> --rpc-url-env <ENV> --chain-id <ID>`, then run with `--network <name> --confirm-network <name>`."
                .to_string(),
        ),
    )
}

fn confirm_remote_write(
    cli: &Cli,
    network: &NetworkMeta,
    account: &AccountMeta,
    preview: &WritePreview,
) -> AppResult<()> {
    if cli.yes {
        return Err(AppError::user(
            "remote_confirmation_required",
            format!(
                "`--yes` cannot approve writes on network `{}`.",
                network.name
            ),
            Some(format!(
                "Run without `--yes` and confirm interactively, or pass `--confirm-network {}` to approve this exact network for machine output.",
                network.name
            )),
        ));
    }

    if cli.json || cli.ndjson {
        return Err(AppError::user(
            "remote_confirmation_required",
            format!("Write on network `{}` requires confirmation.", network.name),
            Some(format!(
                "Use human output for interactive confirmation, or pass `--confirm-network {}` to approve this exact network for machine output.",
                network.name
            )),
        ));
    }

    print_preview(network, account, preview);
    let expected = if network.write_policy == "typed-confirm" {
        network.name.as_str()
    } else {
        "yes"
    };
    print!("Type `{expected}` to continue: ");
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    if input.trim() == expected {
        Ok(())
    } else {
        Err(AppError::user(
            "confirmation_aborted",
            "Transaction was not confirmed.",
            Some("No transaction was sent.".to_string()),
        ))
    }
}

fn print_preview(network: &NetworkMeta, account: &AccountMeta, preview: &WritePreview) {
    println!("ConSol transaction preview");
    println!("  action: {}", preview.action);
    println!("  network: {}", network.name);
    println!(
        "  chain id: {}",
        network
            .chain_id
            .map_or("unknown".to_string(), |id| id.to_string())
    );
    println!("  write policy: {}", network.write_policy);
    println!("  account: {}", account.name);
    println!(
        "  from: {}",
        account.address.as_deref().unwrap_or("address unknown")
    );
    if let Some(signer) = &preview.details.signer_address {
        println!("  signer: {signer}");
    }
    if let Some(nonce) = &preview.details.nonce {
        println!("  nonce: {nonce}");
    }
    if let Some(gas_price) = &preview.details.gas_price {
        println!("  gas price: {gas_price}");
    }
    println!("  contract: {}", preview.contract);
    if let Some(target) = &preview.target {
        println!("  target: {target}");
    }
    if let Some(address) = &preview.address {
        println!("  to: {address}");
    }
    if let Some(function) = &preview.function {
        println!("  function: {function}");
    }
    if let Some(value) = &preview.value {
        println!("  value: {value}");
    }
    if let Some(calldata_prefix) = &preview.details.calldata_prefix {
        println!("  calldata: {calldata_prefix}");
    }
    if let Some(calldata_hash) = &preview.details.calldata_hash {
        println!("  calldata hash: {calldata_hash}");
    }
    if let Some(gas) = &preview.gas.estimate {
        println!("  estimated gas: {gas}");
    }
    if let Some(error) = &preview.gas.error {
        println!("  gas estimate: failed");
        println!("  gas error: {error}");
    }
}

fn validate_signer_address(private_key: &str, account: &AccountMeta) -> AppResult<String> {
    let actual = config::private_key_address(private_key).ok_or_else(|| {
        AppError::user(
            "signer_address_unavailable",
            "Could not derive the signer address from the selected private key.",
            Some(
                "Check that the selected signer environment variable contains a valid private key."
                    .to_string(),
            ),
        )
    })?;
    if let Some(expected) = &account.address {
        if !same_address(expected, &actual) {
            return Err(AppError::user(
                "signer_address_mismatch",
                format!(
                    "Selected account `{}` resolves to {expected}, but the signer key resolves to {actual}.",
                    account.name
                ),
                Some("Update the account profile or select the account that matches the signer key.".to_string()),
            ));
        }
    }
    Ok(actual)
}

fn same_address(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn nonce(address: &str, rpc_url: &str) -> Option<String> {
    let output = Command::new("cast")
        .args(["nonce", address, "--rpc-url", rpc_url])
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn gas_price(rpc_url: &str) -> Option<String> {
    let output = Command::new("cast")
        .args(["gas-price", "--rpc-url", rpc_url])
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn calldata_prefix(calldata: &str) -> String {
    if calldata.len() <= 42 {
        calldata.to_string()
    } else {
        format!("{}...", &calldata[..42])
    }
}

fn keccak_calldata_hash(calldata: &str) -> Option<String> {
    let output = Command::new("cast")
        .args(["keccak", calldata])
        .output()
        .ok()?;
    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    } else {
        None
    }
}

impl GasSignal {
    pub(crate) fn unavailable() -> Self {
        Self {
            estimate: None,
            error: None,
        }
    }

    pub(crate) fn from_result(result: AppResult<String>) -> Self {
        match result {
            Ok(estimate) => Self {
                estimate: Some(estimate),
                error: None,
            },
            Err(err) => Self {
                estimate: None,
                error: Some(err.message()),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::Command as CliCommand;

    #[test]
    fn gas_signal_keeps_estimate_failures_visible() {
        let signal = GasSignal::from_result(Err(AppError::user(
            "gas_estimate_failed",
            "cast estimate failed.",
            Some("execution reverted".to_string()),
        )));

        assert_eq!(signal.estimate, None);
        assert_eq!(signal.error, Some("cast estimate failed.".to_string()));
    }

    #[test]
    fn signer_address_mismatch_is_rejected() {
        let account = AccountMeta {
            name: "wrong".to_string(),
            address: Some("0x0000000000000000000000000000000000000001".to_string()),
            signer: "env-private-key".to_string(),
        };
        let err = validate_signer_address(
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            &account,
        )
        .unwrap_err();

        assert_eq!(err.code(), "signer_address_mismatch");
    }

    #[test]
    fn calldata_prefix_keeps_short_values_and_truncates_long_values() {
        assert_eq!(calldata_prefix("0x1234"), "0x1234");
        assert_eq!(
            calldata_prefix("0x1234567890abcdef1234567890abcdef1234567890"),
            "0x1234567890abcdef1234567890abcdef12345678..."
        );
    }

    #[test]
    fn remote_yes_conflicts_with_confirm_network_token() {
        let mut cli = cli_with_confirm_network("remote");
        cli.yes = true;
        let err = preflight_write_policy(&cli, &remote_network("confirm")).unwrap_err();

        assert_eq!(err.code(), "confirmation_mode_conflict");
    }

    #[test]
    fn confirm_network_requires_named_profile_for_remote_overrides() {
        let mut cli = cli_with_confirm_network("remote");
        cli.rpc_url = Some("https://rpc.example".to_string());
        let err = preflight_write_policy(&cli, &remote_network("confirm")).unwrap_err();

        assert_eq!(err.code(), "machine_confirmation_named_network_required");
    }

    #[test]
    fn read_only_policy_wins_over_confirm_network_token() {
        let cli = cli_with_confirm_network("wrong");
        let err = preflight_write_policy(&cli, &remote_network("read-only")).unwrap_err();

        assert_eq!(err.code(), "write_policy_read_only");
    }

    fn cli_with_confirm_network(name: &str) -> Cli {
        Cli {
            json: true,
            ndjson: false,
            profile: None,
            network: None,
            rpc_url: None,
            chain_id: None,
            account: None,
            signer: None,
            project: None,
            yes: false,
            confirm_network: Some(name.to_string()),
            no_color: false,
            verbose: 0,
            command: CliCommand::Snapshot,
        }
    }

    fn remote_network(write_policy: &str) -> NetworkMeta {
        NetworkMeta {
            name: "remote".to_string(),
            kind: "remote".to_string(),
            chain_id: Some(31337),
            rpc_url: "http://127.0.0.1:9".to_string(),
            fingerprint: None,
            write_policy: write_policy.to_string(),
        }
    }
}
