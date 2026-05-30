use crate::cli::{Cli, TxListArgs};
use crate::commands::target;
use crate::error::{AppError, AppResult};
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Reverse;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct TransactionHistory {
    pub(crate) version: u64,
    pub(crate) entries: Vec<TransactionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TransactionRecord {
    pub(crate) id: String,
    pub(crate) action: String,
    pub(crate) contract: String,
    pub(crate) target: Option<String>,
    pub(crate) address: Option<String>,
    pub(crate) function: Option<String>,
    pub(crate) signature: Option<String>,
    pub(crate) args: Vec<String>,
    pub(crate) value: Option<String>,
    pub(crate) gas_estimate: Option<String>,
    pub(crate) gas_estimate_error: Option<String>,
    pub(crate) tx_hash: Option<String>,
    pub(crate) receipt: Option<ReceiptSummary>,
    pub(crate) network: String,
    pub(crate) chain_id: Option<u64>,
    pub(crate) network_fingerprint: Option<String>,
    pub(crate) account: String,
    pub(crate) from: Option<String>,
    pub(crate) to: Option<String>,
    pub(crate) created_at_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ReceiptSummary {
    pub(crate) status: Option<String>,
    pub(crate) block_number: Option<String>,
    pub(crate) gas_used: Option<String>,
    pub(crate) effective_gas_price: Option<String>,
    pub(crate) contract_address: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SubmittedTransaction {
    pub(crate) tx_output: String,
    pub(crate) tx_hash: Option<String>,
    pub(crate) receipt: Option<ReceiptSummary>,
}

#[derive(Debug, Serialize)]
struct TxListData {
    project_root: String,
    history_path: String,
    entries: Vec<TransactionRecord>,
}

pub fn list(cli: &Cli, args: &TxListArgs) -> AppResult<()> {
    let resolved = target::resolve(cli, args.target.as_deref())?;
    let contract = args
        .target
        .as_ref()
        .and_then(|_| (!resolved.contract_name.is_empty()).then_some(resolved.contract_name));
    let entries = recent(&resolved.project_root, args.limit, contract.as_deref())?;
    let data = TxListData {
        project_root: resolved.project_root.display().to_string(),
        history_path: path(&resolved.project_root).display().to_string(),
        entries,
    };

    if cli.json {
        let mut meta = Meta::new("tx list");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else {
        print_human(&data);
        Ok(())
    }
}

pub(crate) fn path(project_root: &Path) -> PathBuf {
    project_root.join(".consol").join("transactions.json")
}

pub(crate) fn load(project_root: &Path) -> AppResult<TransactionHistory> {
    let path = path(project_root);
    if !path.exists() {
        return Ok(TransactionHistory {
            version: 1,
            entries: Vec::new(),
        });
    }
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

pub(crate) fn save(project_root: &Path, history: &TransactionHistory) -> AppResult<()> {
    let path = path(project_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(history)?)?;
    Ok(())
}

pub(crate) fn recent(
    project_root: &Path,
    limit: usize,
    contract: Option<&str>,
) -> AppResult<Vec<TransactionRecord>> {
    let mut entries = load(project_root)?.entries;
    if let Some(contract) = contract {
        entries.retain(|entry| entry.contract == contract);
    }
    entries.sort_by_key(|entry| Reverse(entry.created_at_unix));
    entries.truncate(limit);
    Ok(entries)
}

pub(crate) fn submitted_from_cast_output(tx_output: String, rpc_url: &str) -> SubmittedTransaction {
    let tx_hash = parse_transaction_hash(&tx_output);
    let receipt = receipt_summary_from_text(&tx_output).or_else(|| {
        tx_hash
            .as_deref()
            .and_then(|hash| fetch_receipt_summary(hash, rpc_url).ok())
    });

    SubmittedTransaction {
        tx_output,
        tx_hash,
        receipt,
    }
}

pub(crate) fn fetch_receipt_summary(tx_hash: &str, rpc_url: &str) -> AppResult<ReceiptSummary> {
    let output = Command::new("cast")
        .arg("receipt")
        .arg(tx_hash)
        .arg("--json")
        .arg("--async")
        .arg("--rpc-url")
        .arg(rpc_url)
        .output()
        .map_err(|err| {
            AppError::user(
                "receipt_fetch_failed",
                format!("Failed to run cast receipt: {err}"),
                Some(
                    "Check that Foundry is installed and the selected RPC is reachable."
                        .to_string(),
                ),
            )
        })?;

    if !output.status.success() {
        return Err(AppError::user(
            "receipt_fetch_failed",
            format!("Could not fetch receipt for {tx_hash}."),
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ));
    }

    let receipt: Value = serde_json::from_slice(&output.stdout).map_err(|err| {
        AppError::user(
            "receipt_parse_failed",
            format!("Failed to parse cast receipt JSON: {err}"),
            Some(String::from_utf8_lossy(&output.stdout).to_string()),
        )
    })?;
    Ok(receipt_summary_from_value(&receipt))
}

pub(crate) struct DeployRecordInput<'a> {
    pub(crate) project_root: &'a Path,
    pub(crate) contract: &'a str,
    pub(crate) target: Option<&'a str>,
    pub(crate) address: &'a str,
    pub(crate) tx_hash: Option<&'a str>,
    pub(crate) receipt: Option<ReceiptSummary>,
    pub(crate) network: &'a NetworkMeta,
    pub(crate) account: &'a AccountMeta,
}

pub(crate) fn record_deploy(input: DeployRecordInput<'_>) -> AppResult<PathBuf> {
    record(input.project_root, TransactionRecord::deploy(input))
}

pub(crate) struct SendRecordInput<'a> {
    pub(crate) project_root: &'a Path,
    pub(crate) contract: &'a str,
    pub(crate) target: Option<&'a str>,
    pub(crate) address: &'a str,
    pub(crate) function: &'a str,
    pub(crate) signature: &'a str,
    pub(crate) args: &'a [String],
    pub(crate) value: Option<&'a str>,
    pub(crate) gas_estimate: Option<&'a str>,
    pub(crate) gas_estimate_error: Option<&'a str>,
    pub(crate) submitted: &'a SubmittedTransaction,
    pub(crate) network: &'a NetworkMeta,
    pub(crate) account: &'a AccountMeta,
}

pub(crate) fn record_send(input: SendRecordInput<'_>) -> AppResult<PathBuf> {
    record(input.project_root, TransactionRecord::send(input))
}

fn record(project_root: &Path, record: TransactionRecord) -> AppResult<PathBuf> {
    let mut history = load(project_root)?;
    history.version = 1;
    history.entries.retain(|entry| entry.id != record.id);
    history.entries.push(record);
    save(project_root, &history)?;
    Ok(path(project_root))
}

fn print_human(data: &TxListData) {
    println!("Transaction history");
    println!("  project: {}", data.project_root);
    println!("  file: {}", data.history_path);
    if data.entries.is_empty() {
        println!("  no transactions recorded");
        return;
    }

    for entry in &data.entries {
        let hash = entry.tx_hash.as_deref().unwrap_or("tx unknown");
        let status = entry
            .receipt
            .as_ref()
            .and_then(|receipt| receipt.status.as_deref())
            .unwrap_or("status unknown");
        let gas = entry
            .receipt
            .as_ref()
            .and_then(|receipt| receipt.gas_used.as_deref())
            .unwrap_or("gas unknown");
        println!(
            "  {} {} {} {} status={} gas={}",
            entry.created_at_unix, entry.action, entry.contract, hash, status, gas
        );
    }
}

impl TransactionRecord {
    fn deploy(input: DeployRecordInput<'_>) -> Self {
        let created_at_unix = unix_timestamp();
        let tx_hash = input.tx_hash.map(ToOwned::to_owned);
        Self {
            id: record_id(
                "deploy",
                input.contract,
                tx_hash.as_deref(),
                created_at_unix,
            ),
            action: "deploy".to_string(),
            contract: input.contract.to_string(),
            target: input.target.map(ToOwned::to_owned),
            address: Some(input.address.to_string()),
            function: None,
            signature: None,
            args: Vec::new(),
            value: None,
            gas_estimate: None,
            gas_estimate_error: None,
            tx_hash,
            receipt: input.receipt,
            network: input.network.name.clone(),
            chain_id: input.network.chain_id,
            network_fingerprint: input.network.fingerprint.clone(),
            account: input.account.name.clone(),
            from: input.account.address.clone(),
            to: None,
            created_at_unix,
        }
    }

    fn send(input: SendRecordInput<'_>) -> Self {
        let created_at_unix = unix_timestamp();
        Self {
            id: record_id(
                "send",
                input.contract,
                input.submitted.tx_hash.as_deref(),
                created_at_unix,
            ),
            action: "send".to_string(),
            contract: input.contract.to_string(),
            target: input.target.map(ToOwned::to_owned),
            address: Some(input.address.to_string()),
            function: Some(input.function.to_string()),
            signature: Some(input.signature.to_string()),
            args: input.args.to_vec(),
            value: input.value.map(ToOwned::to_owned),
            gas_estimate: input.gas_estimate.map(ToOwned::to_owned),
            gas_estimate_error: input.gas_estimate_error.map(ToOwned::to_owned),
            tx_hash: input.submitted.tx_hash.clone(),
            receipt: input.submitted.receipt.clone(),
            network: input.network.name.clone(),
            chain_id: input.network.chain_id,
            network_fingerprint: input.network.fingerprint.clone(),
            account: input.account.name.clone(),
            from: input.account.address.clone(),
            to: Some(input.address.to_string()),
            created_at_unix,
        }
    }
}

fn record_id(action: &str, contract: &str, tx_hash: Option<&str>, created_at_unix: u64) -> String {
    tx_hash.map_or_else(
        || {
            format!(
                "{created_at_unix}-{}",
                target::stable_hash(&format!("{action}:{contract}"))
            )
        },
        ToOwned::to_owned,
    )
}

pub(crate) fn parse_transaction_hash(output: &str) -> Option<String> {
    ["transactionHash", "Transaction hash:"]
        .into_iter()
        .find_map(|prefix| line_value(output, prefix))
}

fn receipt_summary_from_text(output: &str) -> Option<ReceiptSummary> {
    let summary = ReceiptSummary {
        status: line_value(output, "status"),
        block_number: line_value(output, "blockNumber"),
        gas_used: line_value(output, "gasUsed"),
        effective_gas_price: line_value(output, "effectiveGasPrice"),
        contract_address: line_value(output, "contractAddress"),
    };

    summary.has_any_field().then_some(summary)
}

fn receipt_summary_from_value(receipt: &Value) -> ReceiptSummary {
    ReceiptSummary {
        status: value_field(receipt, "status"),
        block_number: value_field(receipt, "blockNumber"),
        gas_used: value_field(receipt, "gasUsed"),
        effective_gas_price: value_field(receipt, "effectiveGasPrice"),
        contract_address: value_field(receipt, "contractAddress"),
    }
}

fn line_value(output: &str, prefix: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed.strip_prefix(prefix).and_then(|value| {
            let value = value.trim().trim_start_matches(':').trim();
            (!value.is_empty()).then(|| value.to_string())
        })
    })
}

fn value_field(receipt: &Value, field: &str) -> Option<String> {
    receipt.get(field).and_then(|value| {
        value
            .as_str()
            .map(ToOwned::to_owned)
            .or_else(|| value.as_u64().map(|number| number.to_string()))
            .or_else(|| value.as_i64().map(|number| number.to_string()))
            .or_else(|| value.as_bool().map(|value| value.to_string()))
    })
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

impl ReceiptSummary {
    fn has_any_field(&self) -> bool {
        self.status.is_some()
            || self.block_number.is_some()
            || self.gas_used.is_some()
            || self.effective_gas_price.is_some()
            || self.contract_address.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cast_send_receipt_summary() {
        let output = r#"
blockNumber          12
gasUsed              43478
status               1 (success)
transactionHash      0xabc
"#;
        let submitted = submitted_from_cast_output(output.to_string(), "http://127.0.0.1:9");

        assert_eq!(submitted.tx_hash.as_deref(), Some("0xabc"));
        let receipt = submitted.receipt.unwrap();
        assert_eq!(receipt.status.as_deref(), Some("1 (success)"));
        assert_eq!(receipt.block_number.as_deref(), Some("12"));
        assert_eq!(receipt.gas_used.as_deref(), Some("43478"));
    }

    #[test]
    fn recent_returns_newest_first_and_filters_contract() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir()
            .join("consol-tests")
            .join(format!("tx-history-{unique}"));
        fs::create_dir_all(root.join(".consol")).unwrap();
        let history = TransactionHistory {
            version: 1,
            entries: vec![
                TransactionRecord {
                    id: "1".to_string(),
                    action: "send".to_string(),
                    contract: "Counter".to_string(),
                    target: None,
                    address: None,
                    function: None,
                    signature: None,
                    args: vec![],
                    value: None,
                    gas_estimate: None,
                    gas_estimate_error: None,
                    tx_hash: Some("0x1".to_string()),
                    receipt: None,
                    network: "local".to_string(),
                    chain_id: Some(31337),
                    network_fingerprint: None,
                    account: "anvil0".to_string(),
                    from: None,
                    to: None,
                    created_at_unix: 1,
                },
                TransactionRecord {
                    id: "2".to_string(),
                    action: "send".to_string(),
                    contract: "Other".to_string(),
                    target: None,
                    address: None,
                    function: None,
                    signature: None,
                    args: vec![],
                    value: None,
                    gas_estimate: None,
                    gas_estimate_error: None,
                    tx_hash: Some("0x2".to_string()),
                    receipt: None,
                    network: "local".to_string(),
                    chain_id: Some(31337),
                    network_fingerprint: None,
                    account: "anvil0".to_string(),
                    from: None,
                    to: None,
                    created_at_unix: 2,
                },
            ],
        };
        save(&root, &history).unwrap();

        let entries = recent(&root, 10, Some("Counter")).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tx_hash.as_deref(), Some("0x1"));
    }
}
