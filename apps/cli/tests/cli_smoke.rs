use assert_cmd::Command;
use predicates::prelude::*;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn help_prints_product_name() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("ConSol"));
}

#[test]
fn detect_json_uses_envelope() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"ok\": true"))
        .stdout(predicate::str::contains("\"source_mode\""));
}

#[test]
fn planned_commands_have_structured_json() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "analyze"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"status\": \"planned\""))
        .stdout(predicate::str::contains("\"command\": \"analyze\""));
}

#[test]
fn network_profiles_persist_to_isolated_config() {
    let config_path = isolated_config_path("network_profiles");

    let mut add = Command::cargo_bin("consol").unwrap();
    add.env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args([
            "--json",
            "network",
            "add",
            "demo",
            "--rpc-url",
            "http://127.0.0.1:9",
            "--chain-id",
            "31337",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"added\""));

    let mut use_network = Command::cargo_bin("consol").unwrap();
    use_network
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "network", "use", "demo"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"selected\""));

    let mut detect = Command::cargo_bin("consol").unwrap();
    detect
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"demo\""))
        .stdout(predicate::str::contains("\"chain_id\": 31337"));

    let mut remove = Command::cargo_bin("consol").unwrap();
    remove
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "network", "remove", "demo"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"removed\""));
}

#[test]
fn network_add_allows_unset_rpc_env_profile() {
    let config_path = isolated_config_path("network_env_profile");

    let mut add = Command::cargo_bin("consol").unwrap();
    add.env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("CONSOL_TEST_RPC_URL_NOT_SET")
        .args([
            "--json",
            "network",
            "add",
            "envdemo",
            "--rpc-url-env",
            "CONSOL_TEST_RPC_URL_NOT_SET",
            "--chain-id",
            "1",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"added\""));

    let mut use_network = Command::cargo_bin("consol").unwrap();
    use_network
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("CONSOL_TEST_RPC_URL_NOT_SET")
        .args(["--json", "network", "use", "envdemo"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"ok\": false"))
        .stdout(predicate::str::contains("network_rpc_env_missing"));
}

#[test]
fn eth_rpc_url_is_a_temporary_network_override() {
    let config_path = isolated_config_path("eth_rpc_url_override");

    let mut detect = Command::cargo_bin("consol").unwrap();
    detect
        .env("CONSOL_CONFIG", &config_path)
        .env("ETH_RPC_URL", "http://127.0.0.1:9")
        .args(["--json", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "\"rpc_url\": \"http://127.0.0.1:9\"",
        ));
}

fn isolated_config_path(name: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join("consol-tests")
        .join(format!("{name}-{}-{nanos}.toml", std::process::id()))
}
