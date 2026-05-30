use crate::cli::Cli;
use crate::config;
use crate::error::{AppError, AppResult};
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const ANVIL0_ADDRESS: &str = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

#[derive(Debug, Serialize)]
pub struct DetectData {
    pub source_mode: SourceMode,
    pub target: Option<String>,
    pub project_root: Option<String>,
    pub foundry_toml: Option<String>,
    pub artifact_dir: Option<String>,
    pub scratch_project: Option<String>,
    pub tools: Toolchain,
    pub network: NetworkMeta,
    pub account: AccountMeta,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceMode {
    Project,
    SingleFile,
}

#[derive(Debug, Serialize)]
pub struct Toolchain {
    pub forge: ToolStatus,
    pub cast: ToolStatus,
    pub anvil: ToolStatus,
}

#[derive(Debug, Serialize)]
pub struct ToolStatus {
    pub available: bool,
    pub version: Option<String>,
}

pub fn run(cli: &Cli, target: Option<&str>) -> AppResult<()> {
    let data = detect(cli, target)?;
    if cli.json {
        let mut meta = Meta::new("detect");
        meta.project_root = data.project_root.clone();
        meta.network = Some(data.network.clone());
        meta.account = Some(data.account.clone());
        output::print_json(data, meta)
    } else {
        print_human(&data);
        Ok(())
    }
}

pub fn detect(cli: &Cli, target: Option<&str>) -> AppResult<DetectData> {
    let cwd = std::env::current_dir()?;
    let source_mode = source_mode(target);
    let search_start = search_start(cli, target, &cwd);
    let foundry_toml = find_upward(&search_start, "foundry.toml");
    let project_root = cli.project.clone().or_else(|| {
        foundry_toml
            .as_ref()
            .and_then(|path| path.parent().map(Path::to_path_buf))
    });

    let scratch_project = match source_mode {
        SourceMode::SingleFile => Some(scratch_project_path(target.unwrap_or_default())),
        _ => None,
    };

    let artifact_dir = project_root.as_ref().map(|root| root.join("out"));
    let network = active_network(cli)?;
    let account = active_account(cli);

    Ok(DetectData {
        source_mode,
        target: target.map(ToOwned::to_owned),
        project_root: project_root.as_deref().map(display_path),
        foundry_toml: foundry_toml.as_deref().map(display_path),
        artifact_dir: artifact_dir.as_deref().map(display_path),
        scratch_project: scratch_project.as_deref().map(display_path),
        tools: Toolchain {
            forge: tool_status("forge"),
            cast: tool_status("cast"),
            anvil: tool_status("anvil"),
        },
        network,
        account,
    })
}

pub fn active_network(cli: &Cli) -> AppResult<NetworkMeta> {
    config::active_network(cli)
}

pub fn active_account(cli: &Cli) -> AccountMeta {
    if let Some(account) = &cli.account {
        return AccountMeta {
            name: account.clone(),
            address: None,
            signer: cli.signer.clone().unwrap_or_else(|| "selected".to_string()),
        };
    }

    if std::env::var("ETH_PRIVATE_KEY").is_ok() {
        AccountMeta {
            name: "env".to_string(),
            address: None,
            signer: "env-private-key".to_string(),
        }
    } else {
        AccountMeta {
            name: "anvil0".to_string(),
            address: Some(ANVIL0_ADDRESS.to_string()),
            signer: "anvil-index".to_string(),
        }
    }
}

fn print_human(data: &DetectData) {
    println!("ConSol project detection");
    println!("  source mode: {:?}", data.source_mode);
    println!(
        "  project root: {}",
        data.project_root.as_deref().unwrap_or("not found")
    );
    println!(
        "  foundry.toml: {}",
        data.foundry_toml.as_deref().unwrap_or("not found")
    );
    println!(
        "  artifact dir: {}",
        data.artifact_dir.as_deref().unwrap_or("not found")
    );
    if let Some(scratch) = &data.scratch_project {
        println!("  scratch project: {scratch}");
    }
    println!(
        "  network: {} ({})",
        data.network.name, data.network.rpc_url
    );
    println!(
        "  chain id: {}",
        data.network
            .chain_id
            .map_or("unknown".to_string(), |id| id.to_string())
    );
    println!(
        "  account: {} via {}",
        data.account.name, data.account.signer
    );
    println!("  forge: {}", tool_label(&data.tools.forge));
    println!("  cast: {}", tool_label(&data.tools.cast));
    println!("  anvil: {}", tool_label(&data.tools.anvil));
}

fn source_mode(target: Option<&str>) -> SourceMode {
    match target {
        Some(value) if value.contains(".sol") => SourceMode::SingleFile,
        Some(_) => SourceMode::Project,
        None => SourceMode::Project,
    }
}

fn search_start(cli: &Cli, target: Option<&str>, cwd: &Path) -> PathBuf {
    if let Some(project) = &cli.project {
        return project.clone();
    }

    if let Some(target) = target {
        let file = target.split_once(':').map_or(target, |(file, _)| file);
        let path = PathBuf::from(file);
        if path.exists() {
            return if path.is_dir() {
                path
            } else {
                path.parent().unwrap_or(cwd).to_path_buf()
            };
        }
    }

    cwd.to_path_buf()
}

fn find_upward(start: &Path, filename: &str) -> Option<PathBuf> {
    let mut current = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };

    loop {
        let candidate = current.join(filename);
        if candidate.exists() {
            return Some(candidate);
        }
        if !current.pop() {
            return None;
        }
    }
}

fn tool_status(name: &str) -> ToolStatus {
    let output = Command::new(name).arg("--version").output();
    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            ToolStatus {
                available: true,
                version: Some(if stdout.is_empty() { stderr } else { stdout }),
            }
        }
        _ => ToolStatus {
            available: false,
            version: None,
        },
    }
}

fn scratch_project_path(target: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let hash = stable_hash(target);
    PathBuf::from(home)
        .join(".cache")
        .join("consol")
        .join("scratch")
        .join(hash)
}

fn stable_hash(value: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}

fn tool_label(status: &ToolStatus) -> String {
    if status.available {
        status.version.as_deref().unwrap_or("available").to_string()
    } else {
        "missing".to_string()
    }
}

#[allow(dead_code)]
fn missing_tool(name: &'static str) -> AppError {
    AppError::user(
        "tool_missing",
        format!("Required tool `{name}` is not installed or not on PATH."),
        Some("Install Foundry and make sure forge/cast/anvil are available.".to_string()),
    )
}
