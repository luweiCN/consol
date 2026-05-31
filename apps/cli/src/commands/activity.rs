use crate::cli::{ActivityArgs, Cli};
use crate::commands::{cache, detect, interact, target, tx};
use crate::error::{AppError, AppResult};
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use serde::Serialize;
use serde_json::Value;
use std::fs;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ActivityData {
    pub(crate) target: String,
    pub(crate) contract: String,
    pub(crate) project_root: String,
    pub(crate) network: NetworkMeta,
    pub(crate) account: AccountMeta,
    pub(crate) deployment: ActivityDeployment,
    pub(crate) state: ActivityState,
    pub(crate) logs: ActivityLogs,
    pub(crate) transactions: Vec<tx::TransactionRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ActivityDeployment {
    pub(crate) status: ActivityStatus,
    pub(crate) address: Option<String>,
    pub(crate) entry: Option<cache::DeploymentEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ActivityState {
    pub(crate) status: ActivityStatus,
    pub(crate) address: Option<String>,
    pub(crate) values: Vec<interact::StateValue>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ActivityLogs {
    pub(crate) status: ActivityStatus,
    pub(crate) address: Option<String>,
    pub(crate) events: Vec<interact::DecodedLog>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ActivityStatus {
    pub(crate) status: String,
    pub(crate) message: Option<String>,
    pub(crate) hint: Option<String>,
}

pub fn run(cli: &Cli, args: &ActivityArgs) -> AppResult<()> {
    let data = snapshot(cli, &args.target, args.limit)?;
    if cli.json {
        let mut meta = Meta::new("activity");
        meta.project_root = Some(data.project_root.clone());
        meta.network = Some(data.network.clone());
        meta.account = Some(data.account.clone());
        output::print_json(data, meta)
    } else {
        print_human(&data);
        Ok(())
    }
}

pub(crate) fn snapshot(cli: &Cli, target_value: &str, limit: usize) -> AppResult<ActivityData> {
    let resolved = target::resolve(cli, Some(target_value))?;
    let network = detect::active_network(cli)?;
    let account = detect::active_account(cli)?;
    let transactions = tx::recent(&resolved.project_root, limit, Some(&resolved.contract_name))?;
    let deployments = cache::load(&resolved.project_root)?;
    let deployment_entry = cache::latest_for_contract(&deployments, &resolved, &network, &account);

    let project_root = resolved.project_root.display().to_string();
    let contract = resolved.contract_name.clone();
    let target = target_value.to_string();

    let Some(entry) = deployment_entry else {
        let status = ActivityStatus::info(
            "deployment_not_found",
            format!("No deployment found for {} on {}.", contract, network.name),
            Some("Run `consol deploy <target>` first.".to_string()),
        );
        return Ok(ActivityData {
            target,
            contract,
            project_root,
            network,
            account,
            deployment: ActivityDeployment {
                status: status.clone(),
                address: None,
                entry: None,
            },
            state: ActivityState::empty(status.clone()),
            logs: ActivityLogs::empty(status),
            transactions,
        });
    };

    let artifact = match read_artifact(&resolved) {
        Ok(artifact) => artifact,
        Err(err) => {
            let status = ActivityStatus::from_error(&err);
            return Ok(ActivityData {
                target,
                contract,
                project_root,
                network,
                account,
                deployment: ActivityDeployment {
                    status: ActivityStatus::ready(format!("{} is deployed.", entry.address)),
                    address: Some(entry.address.clone()),
                    entry: Some(entry),
                },
                state: ActivityState::empty(status.clone()),
                logs: ActivityLogs::empty(status),
                transactions,
            });
        }
    };

    let context = interact::Context {
        resolved,
        artifact,
        address: entry.address.clone(),
        network: network.clone(),
        account: account.clone(),
    };
    let state = match interact::state_snapshot(&context) {
        Ok(data) => ActivityState::from_data(data),
        Err(err) => ActivityState::empty(ActivityStatus::from_error(&err)),
    };
    let logs = match interact::logs_snapshot(&context) {
        Ok(data) => ActivityLogs::from_data(data),
        Err(err) => ActivityLogs::empty(ActivityStatus::from_error(&err)),
    };

    Ok(ActivityData {
        target,
        contract,
        project_root,
        network,
        account,
        deployment: ActivityDeployment {
            status: ActivityStatus::ready(format!("{} is deployed.", context.address)),
            address: Some(context.address),
            entry: Some(entry),
        },
        state,
        logs,
        transactions,
    })
}

fn read_artifact(resolved: &target::ResolvedTarget) -> AppResult<Value> {
    target::with_scratch_lock(&resolved.project_root, || {
        let artifact_path = target::artifact_path(resolved)?;
        let content = fs::read_to_string(&artifact_path).map_err(|err| {
            AppError::user(
                "artifact_missing",
                format!("No artifact found at {}.", artifact_path.display()),
                Some(format!("Run `consol build <target>` first. ({err})")),
            )
        })?;
        Ok(serde_json::from_str(&content)?)
    })
}

fn print_human(data: &ActivityData) {
    println!("Activity {}", data.contract);
    println!("  target: {}", data.target);
    println!("  project: {}", data.project_root);
    println!(
        "  network: {} chain={}",
        data.network.name,
        data.network
            .chain_id
            .map_or("unknown".to_string(), |chain| chain.to_string())
    );
    println!("  account: {}", data.account.name);
    println!();
    print_status("Deployment", &data.deployment.status);
    if let Some(address) = &data.deployment.address {
        println!("  address: {address}");
    }
    println!();
    print_status("State", &data.state.status);
    if data.state.values.is_empty() {
        println!("  no state values");
    } else {
        for value in &data.state.values {
            let readable = value.readable.as_deref().unwrap_or(&value.raw);
            let types = if value.output_types.is_empty() {
                "unknown".to_string()
            } else {
                value.output_types.join(",")
            };
            println!("  {:<24} {} ({})", value.name, readable, types);
            if value.readable.is_some() {
                println!("  {:<24} raw {}", "", value.raw);
            }
        }
    }
    println!();
    print_status("Logs", &data.logs.status);
    if data.logs.events.is_empty() {
        println!("  no decoded events");
    } else {
        for event in data.logs.events.iter().take(20) {
            let label = event
                .signature
                .as_deref()
                .or(event.event.as_deref())
                .unwrap_or("unknown");
            println!(
                "  {} block={} tx={}",
                label,
                event
                    .block_number
                    .map_or("unknown".to_string(), |block| block.to_string()),
                event.transaction_hash.as_deref().unwrap_or("unknown")
            );
        }
    }
    println!();
    println!("Transactions");
    if data.transactions.is_empty() {
        println!("  no transactions recorded");
    } else {
        for transaction in &data.transactions {
            let hash = transaction.tx_hash.as_deref().unwrap_or("tx unknown");
            println!(
                "  {} {} {} {}",
                transaction.created_at_unix, transaction.action, transaction.contract, hash
            );
        }
    }
}

fn print_status(label: &str, status: &ActivityStatus) {
    println!(
        "{label}: {}{}",
        status.status,
        status
            .message
            .as_deref()
            .map_or(String::new(), |message| format!(" - {message}"))
    );
    if let Some(hint) = &status.hint {
        println!("  next: {hint}");
    }
}

impl ActivityState {
    fn empty(status: ActivityStatus) -> Self {
        Self {
            status,
            address: None,
            values: Vec::new(),
        }
    }

    fn from_data(data: interact::StateData) -> Self {
        let status = if data.values.is_empty() {
            ActivityStatus::ready("No zero-argument read functions found.")
        } else {
            ActivityStatus::ready(format!("{} reader value(s) loaded.", data.values.len()))
        };
        Self {
            status,
            address: Some(data.address),
            values: data.values,
        }
    }
}

impl ActivityLogs {
    fn empty(status: ActivityStatus) -> Self {
        Self {
            status,
            address: None,
            events: Vec::new(),
        }
    }

    fn from_data(data: interact::LogsData) -> Self {
        let status = if data.events.is_empty() {
            ActivityStatus::ready("No logs found for this deployment.")
        } else {
            ActivityStatus::ready(format!("{} decoded event(s) loaded.", data.events.len()))
        };
        Self {
            status,
            address: Some(data.address),
            events: data.events,
        }
    }
}

impl ActivityStatus {
    fn ready(message: impl Into<String>) -> Self {
        Self {
            status: "ready".to_string(),
            message: Some(message.into()),
            hint: None,
        }
    }

    fn info(
        status: impl Into<String>,
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
    ) -> Self {
        Self {
            status: status.into(),
            message: Some(message.into()),
            hint: hint.into(),
        }
    }

    fn from_error(err: &AppError) -> Self {
        Self::info(err.code(), err.message(), err.hint())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_deployment_activity_keeps_transactions_section_available() {
        let status = ActivityStatus::info(
            "deployment_not_found",
            "No deployment found.",
            Some("Run `consol deploy <target>` first.".to_string()),
        );
        let state = ActivityState::empty(status.clone());
        let logs = ActivityLogs::empty(status.clone());

        assert_eq!(state.status.status, "deployment_not_found");
        assert_eq!(logs.status.status, "deployment_not_found");
        assert!(state.values.is_empty());
        assert!(logs.events.is_empty());
    }
}
