use super::detect;
use crate::cli::Cli;
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta, NetworkMeta};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8545;

#[derive(Debug, Serialize)]
struct ChainStatusData {
    running: bool,
    managed: bool,
    pid: Option<u32>,
    rpc_url: String,
    chain_id: Option<u64>,
    block_number: Option<u64>,
    log_file: String,
}

#[derive(Debug, Serialize)]
struct ChainActionData {
    action: String,
    status: ChainStatusData,
}

#[derive(Debug)]
struct SpawnedAnvil {
    pid: u32,
}

pub fn start(cli: &Cli) -> AppResult<()> {
    let (data, network) = start_data(cli)?;
    print_action(cli, data, network)
}

pub fn stop(cli: &Cli) -> AppResult<()> {
    let (data, network) = stop_data(cli)?;
    print_action(cli, data, network)
}

pub fn restart(cli: &Cli) -> AppResult<()> {
    let (stop_result, _) = stop_data(cli)?;
    thread::sleep(Duration::from_millis(250));
    let (start_result, network) = start_data(cli)?;
    let data = ChainActionData {
        action: "restarted".to_string(),
        status: start_result.status,
    };

    if cli.json {
        let mut meta = Meta::new("chain restart");
        meta.network = Some(network);
        output::print_json(
            serde_json::json!({
                "action": data.action,
                "stop_action": stop_result.action,
                "status": data.status
            }),
            meta,
        )
    } else {
        println!("chain restarted");
        println!("  previous: {}", stop_result.action);
        println!("  running: {}", data.status.running);
        println!("  rpc: {}", data.status.rpc_url);
        println!(
            "  chain id: {}",
            data.status
                .chain_id
                .map_or("unknown".to_string(), |id| id.to_string())
        );
        println!("  log: {}", data.status.log_file);
        Ok(())
    }
}

pub fn status(cli: &Cli) -> AppResult<()> {
    let network = detect::active_network(cli)?;
    let data = status_data(&network);

    if cli.json {
        let mut meta = Meta::new("chain status");
        meta.network = Some(network);
        output::print_json(data, meta)
    } else {
        println!("Chain running: {}", data.running);
        println!("  managed: {}", data.managed);
        println!("  rpc: {}", data.rpc_url);
        println!(
            "  chain id: {}",
            data.chain_id
                .map_or("unknown".to_string(), |id| id.to_string())
        );
        println!(
            "  block: {}",
            data.block_number
                .map_or("unknown".to_string(), |id| id.to_string())
        );
        println!(
            "  pid: {}",
            data.pid.map_or("unknown".to_string(), |id| id.to_string())
        );
        println!("  log: {}", data.log_file);
        Ok(())
    }
}

pub fn ensure_local_chain_running(cli: &Cli) -> AppResult<()> {
    let network = detect::active_network(cli)?;
    if network.kind != "anvil" || is_reachable(&network.rpc_url) {
        return Ok(());
    }

    let _ = start_data(cli)?;
    Ok(())
}

fn start_data(cli: &Cli) -> AppResult<(ChainActionData, NetworkMeta)> {
    let network = detect::active_network(cli)?;
    ensure_local_network(&network)?;

    if is_reachable(&network.rpc_url) {
        let network = detect::active_network(cli)?;
        let data = ChainActionData {
            action: "already_running".to_string(),
            status: status_data(&network),
        };
        return Ok((data, network));
    }

    let state = state_dir()?;
    let log_file = state.join("anvil-8545.log");
    let spawned = spawn_anvil(&log_file)?;
    fs::write(pid_file()?, spawned.pid.to_string())?;

    for _ in 0..20 {
        if is_reachable(&network.rpc_url) {
            let network = detect::active_network(cli)?;
            let data = ChainActionData {
                action: "started".to_string(),
                status: status_data(&network),
            };
            return Ok((data, network));
        }
        thread::sleep(Duration::from_millis(150));
    }

    Err(AppError::user(
        "anvil_start_timeout",
        "Anvil process started but RPC did not become reachable.",
        Some(format!("Check the log file at {}", log_file.display())),
    ))
}

fn stop_data(cli: &Cli) -> AppResult<(ChainActionData, NetworkMeta)> {
    let network = detect::active_network(cli)?;
    ensure_local_network(&network)?;
    let mut stopped = false;

    if let Some(pid) = read_pid(pid_file()?)? {
        stopped = terminate_pid(pid)?;
        let _ = fs::remove_file(pid_file()?);
    }

    if !stopped {
        stopped = terminate_process_on_port(DEFAULT_PORT)?;
    }

    thread::sleep(Duration::from_millis(250));
    let network = detect::active_network(cli)?;
    let data = ChainActionData {
        action: if stopped { "stopped" } else { "not_running" }.to_string(),
        status: status_data(&network),
    };
    Ok((data, network))
}

fn print_action(cli: &Cli, data: ChainActionData, network: NetworkMeta) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new(format!("chain {}", data.action));
        meta.network = Some(network);
        output::print_json(data, meta)
    } else {
        println!("chain {}", data.action);
        println!("  running: {}", data.status.running);
        println!("  rpc: {}", data.status.rpc_url);
        println!(
            "  chain id: {}",
            data.status
                .chain_id
                .map_or("unknown".to_string(), |id| id.to_string())
        );
        println!("  log: {}", data.status.log_file);
        Ok(())
    }
}

fn status_data(network: &NetworkMeta) -> ChainStatusData {
    let chain_id = detect_chain_id(&network.rpc_url);
    let pid = managed_pid().ok().flatten();
    ChainStatusData {
        running: chain_id.is_some(),
        managed: pid.is_some(),
        pid,
        rpc_url: network.rpc_url.clone(),
        chain_id,
        block_number: block_number(&network.rpc_url),
        log_file: log_file()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| "unknown".to_string()),
    }
}

fn ensure_local_network(network: &NetworkMeta) -> AppResult<()> {
    if network.kind == "anvil" {
        Ok(())
    } else {
        Err(AppError::user(
            "remote_chain_lifecycle_unsupported",
            format!("Cannot start or stop remote network `{}`.", network.name),
            Some(
                "Use `consol network status` for remote RPCs; only local Anvil is manageable."
                    .to_string(),
            ),
        ))
    }
}

fn is_reachable(rpc_url: &str) -> bool {
    detect_chain_id(rpc_url).is_some()
}

fn detect_chain_id(rpc_url: &str) -> Option<u64> {
    let output = Command::new("cast")
        .args(["chain-id", "--rpc-url", rpc_url])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

fn block_number(rpc_url: &str) -> Option<u64> {
    let output = Command::new("cast")
        .args(["block-number", "--rpc-url", rpc_url])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

fn state_dir() -> AppResult<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let path = PathBuf::from(home)
        .join(".cache")
        .join("consol")
        .join("anvil");
    fs::create_dir_all(&path)?;
    Ok(path)
}

fn pid_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("anvil-8545.pid"))
}

fn log_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("anvil-8545.log"))
}

fn read_pid(path: PathBuf) -> AppResult<Option<u32>> {
    if !path.exists() {
        return Ok(None);
    }
    let pid = fs::read_to_string(path)?.trim().parse().ok();
    Ok(pid)
}

fn managed_pid() -> AppResult<Option<u32>> {
    let Some(pid) = read_pid(pid_file()?)? else {
        return Ok(None);
    };
    if pid_is_alive(pid)? {
        Ok(Some(pid))
    } else {
        let _ = fs::remove_file(pid_file()?);
        Ok(None)
    }
}

fn pid_is_alive(pid: u32) -> AppResult<bool> {
    #[cfg(unix)]
    {
        let status = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        Ok(status.success())
    }
    #[cfg(not(unix))]
    {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .output()?;
        Ok(String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
    }
}

fn terminate_pid(pid: u32) -> AppResult<bool> {
    #[cfg(unix)]
    {
        let group_status = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        if group_status.success() {
            return Ok(true);
        }

        let status = Command::new("kill")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        Ok(status.success())
    }
    #[cfg(not(unix))]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()?;
        Ok(status.success())
    }
}

#[cfg(unix)]
fn spawn_anvil(log_file: &std::path::Path) -> AppResult<SpawnedAnvil> {
    use std::os::unix::process::CommandExt;

    let stdout = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)?;
    let stderr = stdout.try_clone()?;
    let script = format!("tail -f /dev/null | anvil --host {DEFAULT_HOST} --port {DEFAULT_PORT}");
    let child = Command::new("bash")
        .arg("-lc")
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .process_group(0)
        .spawn()
        .map_err(|err| {
            AppError::user(
                "anvil_start_failed",
                format!("Failed to start anvil: {err}"),
                Some("Install Foundry and make sure `anvil` and `bash` are on PATH.".to_string()),
            )
        })?;
    Ok(SpawnedAnvil { pid: child.id() })
}

#[cfg(not(unix))]
fn spawn_anvil(log_file: &std::path::Path) -> AppResult<SpawnedAnvil> {
    let stdout = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)?;
    let stderr = stdout.try_clone()?;
    let child = Command::new("anvil")
        .args(["--host", DEFAULT_HOST, "--port", &DEFAULT_PORT.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|err| {
            AppError::user(
                "anvil_start_failed",
                format!("Failed to start anvil: {err}"),
                Some("Install Foundry and make sure `anvil` is on PATH.".to_string()),
            )
        })?;
    Ok(SpawnedAnvil { pid: child.id() })
}

fn terminate_process_on_port(port: u16) -> AppResult<bool> {
    #[cfg(unix)]
    {
        let output = Command::new("lsof")
            .args(["-ti", &format!("tcp:{port}")])
            .stderr(Stdio::null())
            .output();
        let Ok(output) = output else {
            return Ok(false);
        };
        if !output.status.success() {
            return Ok(false);
        }
        let pids = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
            .collect::<Vec<_>>();
        let mut stopped = false;
        for pid in pids {
            stopped |= terminate_pid(pid)?;
        }
        Ok(stopped)
    }
    #[cfg(not(unix))]
    {
        let _ = port;
        Ok(false)
    }
}
