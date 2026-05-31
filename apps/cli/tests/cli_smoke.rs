use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn help_prints_product_name() {
    let mut cmd = consol_cmd();
    cmd.arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("ConSol"));
}

#[test]
fn detect_json_uses_envelope() {
    let mut cmd = consol_cmd();
    cmd.args(["--json", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"ok\": true"))
        .stdout(predicate::str::contains("\"source_mode\""));
}

#[test]
fn test_command_is_wired_to_execution_path() {
    let mut cmd = consol_cmd();
    cmd.args(["--json", "test"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("foundry_project_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not())
        .stderr(predicate::str::is_empty());
}

#[test]
fn analyze_command_is_wired_to_execution_path() {
    let mut cmd = consol_cmd();
    cmd.args(["--json", "analyze"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("foundry_project_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn hints_command_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-hints-target.sol");
    let mut cmd = consol_cmd();
    cmd.args(["--json", "hints", "--file", missing.to_str().unwrap()])
        .assert()
        .failure()
        .stdout(predicate::str::contains("source_file_not_found"));
}

#[test]
fn verify_command_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-verify-target.sol");
    let target = format!("{}:Counter", missing.display());
    let mut cmd = consol_cmd();
    cmd.args([
        "--json",
        "verify",
        &target,
        "--address",
        "0x0000000000000000000000000000000000000000",
        "--show-standard-json-input",
    ])
    .assert()
    .failure()
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
    let mut cmd = consol_cmd();
    cmd.args(["--json", "dev", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"command\": \"dev\""))
        .stdout(predicate::str::contains("\"contract\": \"Counter\""))
        .stdout(predicate::str::contains("\"current_file\""))
        .stdout(predicate::str::contains("\"source_explorer\""))
        .stdout(predicate::str::contains("\"files\""))
        .stdout(predicate::str::contains("\"deployment\""))
        .stdout(predicate::str::contains("\"functions\""))
        .stdout(predicate::str::contains("\"diagnostics\""))
        .stdout(predicate::str::contains("\"commands\""))
        .stdout(predicate::str::contains("\"activity\""))
        .stdout(predicate::str::contains("\"feed\""))
        .stdout(predicate::str::contains("\"transactions\""))
        .stdout(predicate::str::contains("consol build"))
        .stdout(predicate::str::contains("\"label\": \"activity\""))
        .stdout(predicate::str::contains("consol tx list"))
        .stdout(predicate::str::contains("consol --network"))
        .stdout(predicate::str::contains("\"State\""))
        .stdout(predicate::str::contains("\"Contract\""))
        .stdout(predicate::str::contains("\"Build\""))
        .stdout(predicate::str::contains("\"Help\""))
        .stdout(predicate::str::contains("\"key\": \"/\""))
        .stdout(predicate::str::contains("\"action\": \"find contract\""))
        .stdout(predicate::str::contains("\"key\": \"Tab/Shift-Tab\""))
        .stdout(predicate::str::contains("\"action\": \"change focus\""))
        .stdout(predicate::str::contains("\"key\": \"[]\""))
        .stdout(predicate::str::contains("\"action\": \"workspace\""))
        .stdout(predicate::str::contains("\"key\": \"n\""))
        .stdout(predicate::str::contains("\"action\": \"network\""))
        .stdout(predicate::str::contains("\"key\": \"a\""))
        .stdout(predicate::str::contains("\"action\": \"account\""))
        .stdout(predicate::str::contains("\"key\": \"D\""))
        .stdout(predicate::str::contains("\"action\": \"fresh redeploy\""))
        .stdout(predicate::str::contains("\"key\": \"t\""))
        .stdout(predicate::str::contains("\"action\": \"trace latest tx\""))
        .stdout(predicate::str::contains("\"key\": \"Enter/c\""))
        .stdout(predicate::str::contains("\"action\": \"run selected\""))
        .stdout(predicate::str::contains("\"Panels\"").not());
}

#[test]
fn dev_json_uses_chinese_locale_keymap() {
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );
    let mut cmd = consol_cmd();
    cmd.env("CONSOL_LANG", "zh-CN")
        .args(["--json", "dev", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"key\": \"Tab/Shift-Tab\""))
        .stdout(predicate::str::contains("\"action\": \"切换焦点\""))
        .stdout(predicate::str::contains("\"action\": \"工作区\""))
        .stdout(predicate::str::contains("\"action\": \"重新部署\""));
}

#[test]
fn dev_json_prefers_configured_ui_language_over_environment() {
    let config_path = isolated_config_path("ui-language");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(&config_path, "[ui]\nlanguage = \"zh-CN\"\n").unwrap();
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );
    let mut cmd = consol_cmd();
    cmd.env("CONSOL_CONFIG", &config_path)
        .env("CONSOL_LANG", "en-US")
        .args(["--json", "dev", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"切换焦点\""))
        .stdout(predicate::str::contains("\"action\": \"change focus\"").not());
}

#[test]
fn activity_json_reports_contract_activity_snapshot() {
    let project = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("activity-snapshot-{}", unique_suffix()));
    fs::create_dir_all(&project).unwrap();
    let source = project.join("Counter.sol");
    fs::write(
        &source,
        "pragma solidity ^0.8.20; contract Counter { uint256 public number; }",
    )
    .unwrap();
    let target = format!("{}:Counter", source.display());
    let mut cmd = consol_cmd();
    cmd.args(["--json", "activity", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"command\": \"activity\""))
        .stdout(predicate::str::contains("\"contract\": \"Counter\""))
        .stdout(predicate::str::contains("\"deployment\""))
        .stdout(predicate::str::contains("\"state\""))
        .stdout(predicate::str::contains("\"logs\""))
        .stdout(predicate::str::contains("\"transactions\""))
        .stdout(predicate::str::contains("deployment_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn dev_json_without_target_selects_discovered_project_contract() {
    let project = workspace_root().join("examples/counter-foundry");

    let mut cmd = consol_cmd();
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
fn dev_json_without_target_prefers_source_contract_before_artifacts() {
    let project = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("dev-source-first-{}", unique_suffix()));
    fs::create_dir_all(project.join("src")).unwrap();
    fs::create_dir_all(project.join("out/Alpha.sol")).unwrap();
    fs::write(
        project.join("foundry.toml"),
        "[profile.default]\nsrc = \"src\"\nout = \"out\"\nlibs = [\"lib\"]\n",
    )
    .unwrap();
    fs::write(
        project.join("src/Beta.sol"),
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Beta {
    function value() external pure returns (uint256) {
        return 2;
    }
}
"#,
    )
    .unwrap();
    fs::write(
        project.join("out/Alpha.sol/Alpha.json"),
        r#"{"abi":[],"bytecode":{"object":"0x60"}}"#,
    )
    .unwrap();

    let mut cmd = consol_cmd();
    cmd.args(["--json", "--project", project.to_str().unwrap(), "dev"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"target\": \"Beta\""))
        .stdout(predicate::str::contains(
            "\"current_file\": \"src/Beta.sol\"",
        ))
        .stdout(predicate::str::contains("\"artifact_path\""));
}

#[test]
fn dev_json_without_target_scans_single_file_demo_directory() {
    let demo_dir = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("dev-single-file-scan-{}", unique_suffix()));
    fs::create_dir_all(&demo_dir).unwrap();
    fs::write(
        demo_dir.join("Counter.sol"),
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    uint256 public number;

    constructor(uint256 initial) {
        number = initial;
    }

    function setNumber(uint256 value) external {
        number = value;
    }
}
"#,
    )
    .unwrap();

    let mut cmd = consol_cmd();
    cmd.current_dir(&demo_dir)
        .args(["--json", "dev"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"source_mode\": \"single_file\""))
        .stdout(predicate::str::contains("\"target\""))
        .stdout(predicate::str::contains("Counter.sol:Counter"))
        .stdout(predicate::str::contains("\"source_explorer\""))
        .stdout(predicate::str::contains("\"category\": \"demo\""))
        .stdout(predicate::str::contains("\"contract\": \"Counter\""));
}

#[test]
fn console_json_reports_repl_context() {
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );
    let mut cmd = consol_cmd();
    cmd.args(["--json", "console", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"command\": \"console\""))
        .stdout(predicate::str::contains("\"contract\": \"Counter\""))
        .stdout(predicate::str::contains("\"commands\""));
}

#[test]
fn state_watch_json_requires_ndjson() {
    let mut cmd = consol_cmd();
    cmd.args(["--json", "state", "Counter", "--watch"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("ndjson_required"));
}

#[test]
fn logs_watch_json_requires_ndjson() {
    let mut cmd = consol_cmd();
    cmd.args(["--json", "logs", "Counter", "--watch"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("ndjson_required"));
}

#[test]
fn gas_estimate_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-estimate-target.sol");
    let target = format!("{}:Counter", missing.display());
    let mut cmd = consol_cmd();
    cmd.args(["--json", "gas", "estimate", &target, "setNumber", "1"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("source_file_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn gas_compile_json_reports_provenance() {
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );

    let mut cmd = consol_cmd();
    cmd.args(["--json", "gas", "compile", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"kind\": \"compiler_estimate\""))
        .stdout(predicate::str::contains(
            "\"source\": \"forge inspect gasEstimates\"",
        ))
        .stdout(predicate::str::contains("\"confidence\": \"low\""))
        .stdout(predicate::str::contains("\"function\": \"number()\""));
}

#[test]
fn hints_json_reports_gas_provenance_for_editor_protocol() {
    let source = workspace_root().join("examples/counter-single-file/Counter.sol");

    let mut cmd = consol_cmd();
    cmd.args([
        "--json",
        "hints",
        "--file",
        source.to_str().unwrap(),
        "--contract",
        "Counter",
    ])
    .assert()
    .success()
    .stdout(predicate::str::contains("\"gas_hints\""))
    .stdout(predicate::str::contains("\"kind\": \"compiler_estimate\""))
    .stdout(predicate::str::contains(
        "\"source\": \"forge inspect gasEstimates\"",
    ))
    .stdout(predicate::str::contains("\"context\""));
}

#[test]
fn gas_report_is_wired_to_execution_path() {
    let mut cmd = consol_cmd();
    cmd.args(["--json", "gas", "report"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("foundry_project_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn gas_snapshot_is_wired_to_execution_path() {
    let mut cmd = consol_cmd();
    cmd.args(["--json", "gas", "snapshot"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("foundry_project_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn abi_command_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-abi-target.sol");
    let target = format!("{}:Counter", missing.display());
    let mut cmd = consol_cmd();
    cmd.args(["--json", "abi", &target])
        .assert()
        .failure()
        .stdout(predicate::str::contains("source_file_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn storage_command_is_wired_to_execution_path() {
    let missing = std::env::temp_dir().join("consol-missing-storage-target.sol");
    let target = format!("{}:Counter", missing.display());
    let mut cmd = consol_cmd();
    cmd.args(["--json", "storage", &target])
        .assert()
        .failure()
        .stdout(predicate::str::contains("source_file_not_found"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn trace_command_is_wired_to_execution_path() {
    let mut cmd = consol_cmd();
    cmd.args([
        "--json",
        "trace",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
    ])
    .assert()
    .failure()
    .stdout(predicate::str::contains("\"command\": \"trace\""))
    .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn tx_list_reads_recorded_history() {
    let project = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("tx-list-{}", unique_suffix()));
    fs::create_dir_all(project.join(".consol")).unwrap();
    fs::write(
        project.join("foundry.toml"),
        "[profile.default]\nsrc = \"src\"\n",
    )
    .unwrap();
    fs::write(
        project.join(".consol/transactions.json"),
        r#"
{
  "version": 1,
  "entries": [
    {
      "id": "0xabc",
      "action": "send",
      "contract": "Counter",
      "target": "Counter",
      "address": "0x0000000000000000000000000000000000000001",
      "function": "increment",
      "signature": "increment()",
      "args": [],
      "value": null,
      "tx_hash": "0xabc",
      "receipt": {
        "status": "1 (success)",
        "block_number": "7",
        "gas_used": "43478",
        "effective_gas_price": null,
        "contract_address": null
      },
      "network": "local",
      "chain_id": 31337,
      "network_fingerprint": null,
      "account": "anvil0",
      "from": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      "to": "0x0000000000000000000000000000000000000001",
      "created_at_unix": 7
    }
  ]
}
"#,
    )
    .unwrap();

    let mut cmd = consol_cmd();
    cmd.args([
        "--json",
        "--project",
        project.to_str().unwrap(),
        "tx",
        "list",
    ])
    .assert()
    .success()
    .stdout(predicate::str::contains("\"command\": \"tx list\""))
    .stdout(predicate::str::contains("\"history_path\""))
    .stdout(predicate::str::contains("\"tx_hash\": \"0xabc\""))
    .stdout(predicate::str::contains("\"gas_used\": \"43478\""))
    .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn init_from_file_creates_foundry_project() {
    let output_dir = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("init-from-file-{}", unique_suffix()));
    let source = workspace_root().join("examples/counter-single-file/Counter.sol");

    let mut cmd = consol_cmd();
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
fn single_file_mode_copies_local_import_graph() {
    let source_dir = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("single-file-imports-{}", unique_suffix()));
    fs::create_dir_all(source_dir.join("lib")).unwrap();
    fs::write(
        source_dir.join("lib/Math.sol"),
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library Math {
    function add(uint256 left, uint256 right) internal pure returns (uint256) {
        return left + right;
    }
}
"#,
    )
    .unwrap();
    fs::write(
        source_dir.join("ImportedCounter.sol"),
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./lib/Math.sol";

contract ImportedCounter {
    function answer() external pure returns (uint256) {
        return Math.add(20, 22);
    }
}
"#,
    )
    .unwrap();
    let target = format!(
        "{}:ImportedCounter",
        source_dir.join("ImportedCounter.sol").display()
    );

    let mut build = consol_cmd();
    build
        .args(["--json", "build", &target])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"source_mode\": \"single_file\""))
        .stdout(predicate::str::contains("\"status\": \"success\""))
        .stdout(predicate::str::contains("ParserError").not());
}

#[test]
fn single_file_mode_rejects_parent_directory_imports() {
    let root = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("single-file-outside-import-{}", unique_suffix()));
    fs::create_dir_all(root.join("demo")).unwrap();
    fs::create_dir_all(root.join("shared")).unwrap();
    fs::write(
        root.join("shared/Shared.sol"),
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library Shared {
    function value() internal pure returns (uint256) {
        return 7;
    }
}
"#,
    )
    .unwrap();
    fs::write(
        root.join("demo/Main.sol"),
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../shared/Shared.sol";

contract Main {
    function value() external pure returns (uint256) {
        return Shared.value();
    }
}
"#,
    )
    .unwrap();
    let target = format!("{}:Main", root.join("demo/Main.sol").display());

    let mut build = consol_cmd();
    build
        .args(["--json", "build", &target])
        .assert()
        .failure()
        .stdout(predicate::str::contains("single_file_import_outside_root"));
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

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "--network", "remote", "deploy", &target, "--yes"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("remote_confirmation_required"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn remote_deploy_json_can_use_explicit_network_confirmation_token() {
    let config_path = isolated_config_path("remote_deploy_confirm_network");
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

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args([
            "--json",
            "--network",
            "remote",
            "--confirm-network",
            "remote",
            "deploy",
            &target,
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("remote_signer_required"))
        .stdout(predicate::str::contains("remote_confirmation_required").not())
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn remote_deploy_ndjson_can_use_explicit_network_confirmation_token() {
    let config_path = isolated_config_path("remote_deploy_ndjson_confirm_network");
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

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args([
            "--ndjson",
            "--network",
            "remote",
            "--confirm-network",
            "remote",
            "deploy",
            &target,
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("\"type\":\"error\""))
        .stdout(predicate::str::contains("remote_signer_required"))
        .stdout(predicate::str::contains("ndjson_write_not_supported").not())
        .stderr(predicate::str::is_empty());
}

#[test]
fn deploy_ndjson_reports_tx_lifecycle_for_local_chain() {
    with_local_chain_lock(|| {
        let output_dir = std::env::temp_dir()
            .join("consol-tests")
            .join(format!("deploy-ndjson-{}", unique_suffix()));
        let source = workspace_root().join("examples/counter-single-file/Counter.sol");

        let mut init = consol_cmd();
        init.args([
            "--json",
            "init",
            "--from-file",
            source.to_str().unwrap(),
            "--to",
            output_dir.to_str().unwrap(),
        ])
        .assert()
        .success();

        let mut deploy = consol_cmd();
        deploy
            .env_remove("ETH_RPC_URL")
            .args([
                "--ndjson",
                "--project",
                output_dir.to_str().unwrap(),
                "deploy",
                "Counter",
                "0",
            ])
            .assert()
            .success()
            .stdout(predicate::str::contains("\"type\":\"tx.preview\""))
            .stdout(predicate::str::contains("\"kind\":\"unavailable\""))
            .stdout(predicate::str::contains("\"source\":\"not_estimated\""))
            .stdout(predicate::str::contains("\"type\":\"tx.sent\""))
            .stdout(predicate::str::contains("\"type\":\"tx.mined\""))
            .stdout(predicate::str::contains("\"command\":\"deploy\""))
            .stderr(predicate::str::is_empty());
    });
}

#[test]
fn deploy_all_deploys_zero_arg_project_contracts() {
    with_local_chain_lock(|| {
        let project_dir = std::env::temp_dir()
            .join("consol-tests")
            .join(format!("deploy-all-{}", unique_suffix()));
        let src_dir = project_dir.join("src");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(
            project_dir.join("foundry.toml"),
            "[profile.default]\nsrc = \"src\"\nout = \"out\"\nlibs = [\"lib\"]\n",
        )
        .unwrap();
        fs::write(
            src_dir.join("Alpha.sol"),
            r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Alpha {
    function value() external pure returns (uint256) {
        return 1;
    }
}
"#,
        )
        .unwrap();
        fs::write(
            src_dir.join("Beta.sol"),
            r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Beta {
    function value() external pure returns (uint256) {
        return 2;
    }
}
"#,
        )
        .unwrap();

        let mut deploy = consol_cmd();
        deploy
            .env_remove("ETH_RPC_URL")
            .args([
                "--json",
                "--project",
                project_dir.to_str().unwrap(),
                "deploy",
                "--all",
            ])
            .assert()
            .success()
            .stdout(predicate::str::contains("\"command\": \"deploy --all\""))
            .stdout(predicate::str::contains("\"contract\": \"Alpha\""))
            .stdout(predicate::str::contains("\"contract\": \"Beta\""))
            .stdout(predicate::str::contains("\"status\": \"deployed\""));

        let mut list = consol_cmd();
        list.env_remove("ETH_RPC_URL")
            .args([
                "--json",
                "--project",
                project_dir.to_str().unwrap(),
                "deploy",
                "--list",
            ])
            .assert()
            .success()
            .stdout(predicate::str::contains("\"command\": \"deploy --list\""))
            .stdout(predicate::str::contains("\"contract\": \"Alpha\""))
            .stdout(predicate::str::contains("\"contract\": \"Beta\""));
    });
}

#[test]
fn send_ndjson_reports_tx_lifecycle_for_local_chain() {
    with_local_chain_lock(|| {
        let output_dir = std::env::temp_dir()
            .join("consol-tests")
            .join(format!("send-ndjson-{}", unique_suffix()));
        let source = workspace_root().join("examples/counter-single-file/Counter.sol");

        let mut init = consol_cmd();
        init.args([
            "--json",
            "init",
            "--from-file",
            source.to_str().unwrap(),
            "--to",
            output_dir.to_str().unwrap(),
        ])
        .assert()
        .success();

        let mut deploy = consol_cmd();
        deploy
            .env_remove("ETH_RPC_URL")
            .args([
                "--json",
                "--project",
                output_dir.to_str().unwrap(),
                "deploy",
                "Counter",
                "0",
            ])
            .assert()
            .success();

        let mut send = consol_cmd();
        send.env_remove("ETH_RPC_URL")
            .args([
                "--ndjson",
                "--project",
                output_dir.to_str().unwrap(),
                "send",
                "Counter",
                "setNumber",
                "7",
            ])
            .assert()
            .success()
            .stdout(predicate::str::contains("\"type\":\"tx.preview\""))
            .stdout(predicate::str::contains("\"kind\":\"rpc_estimate\""))
            .stdout(predicate::str::contains("\"source\":\"cast estimate\""))
            .stdout(predicate::str::contains("\"confidence\":\"medium\""))
            .stdout(predicate::str::contains("\"type\":\"tx.sent\""))
            .stdout(predicate::str::contains("\"type\":\"tx.mined\""))
            .stdout(predicate::str::contains("\"command\":\"send\""))
            .stdout(predicate::str::contains("\"calldata_hash\""))
            .stderr(predicate::str::is_empty());
    });
}

#[test]
fn remote_deploy_rejects_yes_with_network_confirmation_token() {
    let config_path = isolated_config_path("remote_deploy_confirm_network_yes");
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

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args([
            "--json",
            "--network",
            "remote",
            "--confirm-network",
            "remote",
            "deploy",
            &target,
            "--yes",
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("confirmation_mode_conflict"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn remote_deploy_rejects_mismatched_network_confirmation_token() {
    let config_path = isolated_config_path("remote_deploy_confirm_network_mismatch");
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

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args([
            "--json",
            "--network",
            "remote",
            "--confirm-network",
            "sepolia",
            "deploy",
            &target,
            "--yes",
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("remote_confirmation_mismatch"))
        .stdout(predicate::str::contains("active network `remote`"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn read_only_network_rejects_network_confirmation_token() {
    let config_path = isolated_config_path("remote_deploy_read_only_confirm_network");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        &config_path,
        r#"
active_network = "archive"

[networks.archive]
rpc_url = "http://127.0.0.1:9"
chain_id = 31337
kind = "remote"
write_policy = "read-only"
"#,
    )
    .unwrap();
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args([
            "--json",
            "--network",
            "archive",
            "--confirm-network",
            "archive",
            "deploy",
            &target,
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("write_policy_read_only"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn remote_deploy_rejects_network_confirmation_without_chain_guard() {
    let config_path = isolated_config_path("remote_deploy_confirm_network_no_chain_id");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        &config_path,
        r#"
active_network = "remote"

[networks.remote]
rpc_url = "http://127.0.0.1:9"
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

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args([
            "--json",
            "--network",
            "remote",
            "--confirm-network",
            "remote",
            "deploy",
            &target,
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains(
            "machine_confirmation_chain_guard_required",
        ))
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

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env("ETH_PRIVATE_KEY", private_key)
        .args(["--json", "--account", "ghost", "deploy", &target, "--yes"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("account_not_found"))
        .stdout(predicate::str::contains("ghost"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn selected_account_must_match_selected_signer_key_for_writes() {
    let config_path = isolated_config_path("signer_address_mismatch");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        &config_path,
        r#"
active_account = "mismatch"

[accounts.mismatch]
address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
private_key_env = "CONSOL_TEST_PRIVATE_KEY"
"#,
    )
    .unwrap();
    let mismatched_private_key =
        "0x5de4111afa1a4b4c6a4ff4f94a3c7e66bdf0e8cc91abb3eb7e1b3b1d8c4d8cbb";
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env("CONSOL_TEST_PRIVATE_KEY", mismatched_private_key)
        .args(["--json", "deploy", &target, "--yes"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("signer_address_mismatch"))
        .stdout(predicate::str::contains("mismatch"))
        .stdout(predicate::str::contains("\"status\": \"planned\"").not());
}

#[test]
fn signer_override_supplies_write_key_without_active_account() {
    let config_path = isolated_config_path("signer_override_write");
    let private_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        &config_path,
        r#"
[networks.remote]
rpc_url = "http://127.0.0.1:9"
chain_id = 31337
kind = "remote"
write_policy = "confirm"

[accounts.localdev]
address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
private_key_env = "CONSOL_TEST_PRIVATE_KEY"
"#,
    )
    .unwrap();
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .env("CONSOL_TEST_PRIVATE_KEY", private_key)
        .args([
            "--ndjson",
            "--network",
            "remote",
            "--signer",
            "localdev",
            "--confirm-network",
            "remote",
            "deploy",
            &target,
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("deploy_failed"))
        .stdout(predicate::str::contains("\"type\":\"tx.preview\""))
        .stdout(predicate::str::contains("\"name\":\"localdev\""))
        .stdout(predicate::str::contains("remote_signer_required").not())
        .stdout(predicate::str::contains("signer_not_found").not());
}

#[test]
fn unknown_account_with_signer_override_is_rejected_before_write() {
    let config_path = isolated_config_path("signer_override_unknown_account");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        &config_path,
        r#"
[networks.remote]
rpc_url = "http://127.0.0.1:9"
chain_id = 31337
kind = "remote"
write_policy = "confirm"

[accounts.localdev]
address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
private_key_env = "CONSOL_MISSING_PRIVATE_KEY"
"#,
    )
    .unwrap();
    let target = format!(
        "{}:Counter",
        workspace_root()
            .join("examples/counter-single-file/Counter.sol")
            .display()
    );

    let mut deploy = consol_cmd();
    deploy
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .env_remove("CONSOL_MISSING_PRIVATE_KEY")
        .args([
            "--json",
            "--network",
            "remote",
            "--account",
            "ghost",
            "--signer",
            "localdev",
            "--confirm-network",
            "remote",
            "deploy",
            &target,
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("account_not_found"))
        .stdout(predicate::str::contains("ghost"))
        .stdout(predicate::str::contains("signer_env_missing").not())
        .stdout(predicate::str::contains("deploy_failed").not())
        .stdout(predicate::str::contains("remote_signer_required").not());
}

#[test]
fn account_and_signer_overrides_must_reference_same_profile() {
    let config_path = isolated_config_path("account_signer_conflict");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        &config_path,
        r#"
[accounts.localdev]
address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
private_key_env = "CONSOL_TEST_PRIVATE_KEY"

[accounts.other]
address = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
private_key_env = "CONSOL_TEST_OTHER_PRIVATE_KEY"
"#,
    )
    .unwrap();

    let mut conflict = consol_cmd();
    conflict
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args([
            "--json",
            "--account",
            "localdev",
            "--signer",
            "other",
            "detect",
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("account_signer_conflict"));

    let mut same_profile = consol_cmd();
    same_profile
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args([
            "--json",
            "--account",
            "localdev",
            "--signer",
            "localdev",
            "detect",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"localdev\""));
}

#[test]
fn network_profiles_persist_to_isolated_config() {
    let config_path = isolated_config_path("network_profiles");

    let mut add = consol_cmd();
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

    let mut use_network = consol_cmd();
    use_network
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "network", "use", "demo"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"selected\""));

    let mut detect = consol_cmd();
    detect
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"demo\""))
        .stdout(predicate::str::contains("\"chain_id\": 31337"));

    let mut remove = consol_cmd();
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

    let mut add = consol_cmd();
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

    let mut use_network = consol_cmd();
    use_network
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("CONSOL_TEST_RPC_URL_NOT_SET")
        .args(["--json", "network", "use", "envdemo"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("\"ok\": false"))
        .stdout(predicate::str::contains("network_rpc_env_missing"));
}

#[test]
fn network_add_requires_chain_id_for_remote_profiles() {
    let config_path = isolated_config_path("network_chain_id_required");

    let mut add = consol_cmd();
    add.env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args([
            "--json",
            "network",
            "add",
            "demo",
            "--rpc-url",
            "http://127.0.0.1:9",
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("\"ok\": false"))
        .stdout(predicate::str::contains("network_chain_id_missing"));
}

#[test]
fn network_add_allows_unset_fork_env_profile() {
    let config_path = isolated_config_path("network_fork_env_profile");

    let mut add = consol_cmd();
    add.env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("CONSOL_TEST_FORK_RPC_URL_NOT_SET")
        .args([
            "--json",
            "network",
            "add",
            "mainnet-fork",
            "--fork-url-env",
            "CONSOL_TEST_FORK_RPC_URL_NOT_SET",
            "--fork-block-number",
            "18000000",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"added\""));

    let mut list = consol_cmd();
    list.env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("CONSOL_TEST_FORK_RPC_URL_NOT_SET")
        .args(["--json", "network", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"mainnet-fork\""))
        .stdout(predicate::str::contains("\"kind\": \"anvil-fork\""))
        .stdout(predicate::str::contains(
            "\"fork_url_env\": \"CONSOL_TEST_FORK_RPC_URL_NOT_SET\"",
        ))
        .stdout(predicate::str::contains("\"fork_block_number\": 18000000"))
        .stdout(predicate::str::contains("\"expected_chain_id\": 31337"))
        .stdout(predicate::str::contains("\"write_policy\": \"local\""));

    let mut use_network = consol_cmd();
    use_network
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("CONSOL_TEST_FORK_RPC_URL_NOT_SET")
        .args(["--json", "network", "use", "mainnet-fork"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("\"ok\": false"))
        .stdout(predicate::str::contains("network_fork_env_missing"));
}

#[test]
fn network_add_sets_mainnet_default_and_accepts_write_policy_override() {
    let config_path = isolated_config_path("network_write_policy");

    let mut add_mainnet = consol_cmd();
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

    let mut add_read_only = consol_cmd();
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

    let mut list = consol_cmd();
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

    let mut detect = consol_cmd();
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

    let mut detect = consol_cmd();
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

    let mut import = consol_cmd();
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

    let mut use_account = consol_cmd();
    use_account
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "account", "use", "localdev"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"selected\""));

    let mut detect = consol_cmd();
    detect
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"localdev\""))
        .stdout(predicate::str::contains("\"signer\": \"env-private-key\""));
}

#[test]
fn keystore_account_profiles_persist_to_isolated_config() {
    let config_path = isolated_config_path("keystore_account_profiles");
    let keystore_dir = std::env::temp_dir()
        .join("consol-tests")
        .join(format!("keystore-{}", unique_suffix()));
    fs::create_dir_all(&keystore_dir).unwrap();
    let private_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    let cast_output = std::process::Command::new("cast")
        .args([
            "wallet",
            "import",
            "demo",
            "--keystore-dir",
            keystore_dir.to_str().unwrap(),
            "--private-key",
            private_key,
        ])
        .env("CAST_UNSAFE_PASSWORD", "testpass")
        .output()
        .unwrap();
    assert!(
        cast_output.status.success(),
        "cast wallet import failed: {}",
        String::from_utf8_lossy(&cast_output.stderr)
    );

    let mut import = consol_cmd();
    import
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env("CONSOL_TEST_KEYSTORE_PASSWORD", "testpass")
        .args([
            "--json",
            "account",
            "import",
            "vault",
            "--keystore",
            "demo",
            "--keystore-dir",
            keystore_dir.to_str().unwrap(),
            "--password-env",
            "CONSOL_TEST_KEYSTORE_PASSWORD",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"imported\""))
        .stdout(predicate::str::contains("\"signer\": \"keystore\""))
        .stdout(predicate::str::contains(
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        ));

    let mut use_account = consol_cmd();
    use_account
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "account", "use", "vault"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"action\": \"selected\""));

    let mut detect = consol_cmd();
    detect
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"vault\""))
        .stdout(predicate::str::contains("\"signer\": \"keystore\""));
}

#[test]
fn signer_registry_lists_and_reads_named_profiles() {
    let config_path = isolated_config_path("signer_registry");
    let private_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    let mut import = consol_cmd();
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
        .success();

    let mut use_account = consol_cmd();
    use_account
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "account", "use", "localdev"])
        .assert()
        .success();

    let mut list = consol_cmd();
    list.env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env("CONSOL_TEST_PRIVATE_KEY", private_key)
        .args(["--json", "signer", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"active\": \"localdev\""))
        .stdout(predicate::str::contains("\"name\": \"anvil0\""))
        .stdout(predicate::str::contains("\"name\": \"localdev\""))
        .stdout(predicate::str::contains("\"source\": \"env-private-key\""))
        .stdout(predicate::str::contains("\"available\": true"));

    let mut status = consol_cmd();
    status
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env("CONSOL_TEST_PRIVATE_KEY", private_key)
        .args(["--json", "signer", "status", "localdev"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"localdev\""))
        .stdout(predicate::str::contains("\"source\": \"env-private-key\""))
        .stdout(predicate::str::contains("\"active\": true"));

    let mut missing = consol_cmd();
    missing
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .args(["--json", "signer", "status", "missing"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("signer_not_found"));
}

#[test]
fn signer_override_selects_account_context_for_detect_and_status() {
    let config_path = isolated_config_path("signer_override_detect");
    let private_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        &config_path,
        r#"
[accounts.localdev]
address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
private_key_env = "CONSOL_TEST_PRIVATE_KEY"
"#,
    )
    .unwrap();

    let mut detect = consol_cmd();
    detect
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .env("CONSOL_TEST_PRIVATE_KEY", private_key)
        .args(["--json", "--signer", "localdev", "detect"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"localdev\""))
        .stdout(predicate::str::contains("\"signer\": \"env-private-key\""));

    let mut status = consol_cmd();
    status
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .env("CONSOL_TEST_PRIVATE_KEY", private_key)
        .args(["--json", "--signer", "localdev", "signer", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"localdev\""))
        .stdout(predicate::str::contains("\"active\": true"));

    let mut missing = consol_cmd();
    missing
        .env("CONSOL_CONFIG", &config_path)
        .env_remove("ETH_RPC_URL")
        .env_remove("ETH_PRIVATE_KEY")
        .args(["--json", "--signer", "missing", "detect"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("signer_not_found"));
}

fn isolated_config_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir()
        .join("consol-tests")
        .join(format!("{name}-{}.toml", unique_suffix()))
}

fn isolated_log_dir(name: &str) -> std::path::PathBuf {
    std::env::temp_dir()
        .join("consol-tests")
        .join("diagnostic-logs")
        .join(format!("{name}-{}", unique_suffix()))
}

fn consol_cmd() -> Command {
    let mut command = Command::cargo_bin("consol").unwrap();
    command.env("CONSOL_LOG_DIR", isolated_log_dir("cli-smoke"));
    command.env("CONSOL_LANG", "en-US");
    command
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

fn with_local_chain_lock(run: impl FnOnce()) {
    let lock_path = std::env::temp_dir()
        .join("consol-tests")
        .join("local-chain.lock");
    fs::create_dir_all(lock_path.parent().unwrap()).unwrap();

    loop {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(_) => {
                let _guard = LocalChainLock { path: lock_path };
                run();
                return;
            }
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => panic!("failed to create local chain test lock: {err}"),
        }
    }
}

struct LocalChainLock {
    path: PathBuf,
}

impl Drop for LocalChainLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
