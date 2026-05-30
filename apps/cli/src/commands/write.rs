use crate::cli::Cli;
use crate::error::{AppError, AppResult};
use crate::output::{AccountMeta, NetworkMeta};
use std::io::{self, Write};

#[derive(Debug, Clone)]
pub(crate) struct GasSignal {
    pub(crate) estimate: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug)]
pub(crate) struct WritePreview {
    pub(crate) action: &'static str,
    pub(crate) contract: String,
    pub(crate) target: Option<String>,
    pub(crate) address: Option<String>,
    pub(crate) function: Option<String>,
    pub(crate) value: Option<String>,
    pub(crate) gas: GasSignal,
}

pub(crate) fn confirm_write(
    cli: &Cli,
    network: &NetworkMeta,
    account: &AccountMeta,
    preview: &WritePreview,
) -> AppResult<()> {
    match network.write_policy.as_str() {
        "local" => Ok(()),
        "read-only" => Err(AppError::user(
            "write_policy_read_only",
            format!("Network `{}` is read-only.", network.name),
            Some(
                "Select another network profile before deploying or sending transactions."
                    .to_string(),
            ),
        )),
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
            Some("Run without `--yes` and confirm the transaction interactively.".to_string()),
        ));
    }

    if cli.json || cli.ndjson {
        return Err(AppError::user(
            "remote_confirmation_required",
            format!("Write on network `{}` requires confirmation.", network.name),
            Some("Use human output for interactive confirmation. Machine confirmation policy is planned.".to_string()),
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
    if let Some(gas) = &preview.gas.estimate {
        println!("  estimated gas: {gas}");
    }
    if let Some(error) = &preview.gas.error {
        println!("  gas estimate: failed");
        println!("  gas error: {error}");
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
}
