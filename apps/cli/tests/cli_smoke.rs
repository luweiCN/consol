use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
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
fn test_command_is_wired_to_execution_path() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "test"])
        .assert()
        .success()
        .stdout(predicate::str::contains("foundry_project_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn analyze_command_is_wired_to_execution_path() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "analyze"])
        .assert()
        .success()
        .stdout(predicate::str::contains("foundry_project_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn hints_command_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-hints-target.sol");
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "hints", "--file", missing.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("source_file_not_found"));
}

#[test]
fn verify_command_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-verify-target.sol");
    let target = format!("{}:Counter", missing.display());
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args([
        "--json",
        "verify",
        &target,
        "--address",
        "0x0000000000000000000000000000000000000000",
        "--show-standard-json-input",
    ])
    .assert()
    .success()
    .stdout(predicate::str::contains("source_file_not_found"))
    .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn dev_json_reports_tui_cockpit_state() {
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "dev", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"command\": \"dev\""))
        .stdout(predicate::str::contains("\"contract\": \"Counter\""))
        .stdout(predicate::str::contains("\"deployment\""))
        .stdout(predicate::str::contains("\"functions\""))
        .stdout(predicate::str::contains("\"diagnostics\""))
        .stdout(predicate::str::contains("\"commands\""))
        .stdout(predicate::str::contains("\"feed\""))
        .stdout(predicate::str::contains("consol build"))
        .stdout(predicate::str::contains("consol --network"))
        .stdout(predicate::str::contains("\"State\""))
        .stdout(predicate::str::contains("\"Diagnostics\""))
        .stdout(predicate::str::contains("\"key\": \"n\""))
        .stdout(predicate::str::contains("\"action\": \"network\""))
        .stdout(predicate::str::contains("\"key\": \"a\""))
        .stdout(predicate::str::contains("\"action\": \"account\""))
        .stdout(predicate::str::contains("\"Feed\""))
        .stdout(predicate::str::contains("\"key\": \"y\""))
        .stdout(predicate::str::contains("\"action\": \"copy command\""))
        .stdout(predicate::str::contains("\"Panels\"").not());
}

#[test]
fn dev_json_without_target_selects_discovered_project_contract() {
    let project = workspace_root().join("examples/counter-foundry");

    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "--project", project.to_str().unwrap(), "dev"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"command\": \"dev\""))
        .stdout(predicate::str::contains("\"target\": \"Counter\""))
        .stdout(predicate::str::contains("\"contract\": \"Counter\""))
        .stdout(predicate::str::contains("\"contracts\""))
        .stdout(predicate::str::contains("\"artifact_path\""));
}

#[test]
fn console_json_reports_repl_context() {
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "console", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"command\": \"console\""))
        .stdout(predicate::str::contains("\"contract\": \"Counter\""))
        .stdout(predicate::str::contains("\"commands\""));
}

#[test]
fn state_watch_json_requires_ndjson() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "state", "Counter", "--watch"])
        .assert()
        .success()
        .stdout(predicate::str::contains("ndjson_required"));
}

#[test]
fn logs_watch_json_requires_ndjson() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "logs", "Counter", "--watch"])
        .assert()
        .success()
        .stdout(predicate::str::contains("ndjson_required"));
}

#[test]
fn gas_estimate_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-estimate-target.sol");
    let target = format!("{}:Counter", missing.display());
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "gas", "estimate", &target, "setNumber", "1"])
        .assert()
        .success()
        .stdout(predicate::str::contains("source_file_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn gas_report_is_wired_to_execution_path() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "gas", "report"])
        .assert()
        .success()
        .stdout(predicate::str::contains("foundry_project_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn gas_snapshot_is_wired_to_execution_path() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "gas", "snapshot"])
        .assert()
        .success()
        .stdout(predicate::str::contains("foundry_project_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn abi_command_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-abi-target.sol");
    let target = format!("{}:Counter", missing.display());
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "abi", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("source_file_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn storage_command_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-storage-target.sol");
    let target = format!("{}:Counter", missing.display());
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args(["--json", "storage", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("source_file_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn trace_command_is_wired_to_execution_path() {
    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args([
        "--json",
        "trace",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
    ])
    .assert()
    .success()
    .stdout(predicate::str::contains("\"command\": \"trace\""))
    .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn init_from_file_creates_foundry_project() {
    let output_dir = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("init-from-file-{}", unique_suffix()));
    let source = workspace_root().join("examples/counter-single-file/Counter.sol");

    let mut cmd = Command::cargo_bin("consol").unwrap();
    cmd.args([
        "--json",
        "init",
        "--from-file",
        source.to_str().unwrap(),
        "--to",
        output_dir.to_str().unwrap(),
    ])
    .assert()
    .success()
    .stdout(predicate::str::contains("\"command\": \"init\""))
    .stdout(predicate::str::contains("\"copied_source\""))
    .stdout(predicate::str::contains("\"status\": \"planned\"").not());

    assert!(output_dir.join("foundry.toml").exists());
    assert!(output_dir.join("src/Counter.sol").exists());
}

#[test]
fn remote_deploy_cannot_be_approved_with_yes() {
    let config_path = isolated_config_path("remote_deploy_yes");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        &config_path,
        r#"
active_network = "remote"

[networks.remote]
rpc_url = "http://127.0.0.1:9"
chain_id = 31337
kind = "remote"
write_policy = "confirm"
"#,
    )
    .unwrap();
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );

    let mut deploy = Command::cargo_bin("consol").unwrap();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "--network", "remote", "deploy", &target, "--yes"])
        .assert()
        .success()
        .stdout(predicate::str::contains("remote_confirmation_required"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn unknown_selected_account_does_not_fallback_to_eth_private_key_for_writes() {
    let config_path = isolated_config_path("unknown_account_write");
    let private_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );

    let mut deploy = Command::cargo_bin("consol").unwrap();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env("ETH_PRIVATE_KEY", private_key)
        .args(["--json", "--account", "ghost", "deploy", &target, "--yes"])
        .assert()
        .success()
        .stdout(predicate::str::contains("signer_not_found"))
        .stdout(predicate::str::contains("ghost"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
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
fn network_add_sets_mainnet_default_and_accepts_write_policy_override() {
    let config_path = isolated_config_path("network_write_policy");

    let mut add_mainnet = Command::cargo_bin("consol").unwrap();
    add_mainnet
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("CONSOL_TEST_MAINNET_RPC_URL_NOT_SET")
        .args([
            "--json",
            "network",
            "add",
            "mainnet",
            "--rpc-url-env",
            "CONSOL_TEST_MAINNET_RPC_URL_NOT_SET",
            "--chain-id",
            "1",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"added\""));

    let mut add_read_only = Command::cargo_bin("consol").unwrap();
    add_read_only
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("CONSOL_TEST_RPC_URL_NOT_SET")
        .args([
            "--json",
            "network",
            "add",
            "readonly",
            "--rpc-url-env",
            "CONSOL_TEST_RPC_URL_NOT_SET",
            "--chain-id",
            "11155111",
            "--write-policy",
            "read-only",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"added\""));

    let mut list = Command::cargo_bin("consol").unwrap();
    list.env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "network", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"mainnet\""))
        .stdout(predicate::str::contains(
            "\"write_policy\": \"typed-confirm\"",
        ))
        .stdout(predicate::str::contains("\"name\": \"readonly\""))
        .stdout(predicate::str::contains("\"write_policy\": \"read-only\""));
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

#[test]
fn remote_rpc_urls_are_redacted_in_json_output() {
    let config_path = isolated_config_path("rpc_redaction");

    let mut detect = Command::cargo_bin("consol").unwrap();
    detect
        .env("CONSOL_CONFIG", &config_path)
        .env(
            "ETH_RPC_URL",
            "https://eth-mainnet.g.alchemy.com/v2/super-secret-key",
        )
        .args(["--json", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "\"rpc_url\": \"https://eth-mainnet.g.alchemy.com/<redacted>\"",
        ))
        .stdout(predicate::str::contains("super-secret-key").not());
}

#[test]
fn account_profiles_persist_to_isolated_config() {
    let config_path = isolated_config_path("account_profiles");
    let private_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    let mut import = Command::cargo_bin("consol").unwrap();
    import
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env("CONSOL_TEST_PRIVATE_KEY", private_key)
        .args([
            "--json",
            "account",
            "import",
            "localdev",
            "--private-key-env",
            "CONSOL_TEST_PRIVATE_KEY",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"imported\""))
        .stdout(predicate::str::contains("\"signer\": \"env-private-key\""));

    let mut use_account = Command::cargo_bin("consol").unwrap();
    use_account
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "account", "use", "localdev"])
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
        .stdout(predicate::str::contains("\"name\": \"localdev\""))
        .stdout(predicate::str::contains("\"signer\": \"env-private-key\""));
}

fn isolated_config_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir()
        .join("consol-tests")
        .join(format!("{name}-{}.toml", unique_suffix()))
}

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{}-{nanos}", std::process::id())
}

fn workspace_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}
