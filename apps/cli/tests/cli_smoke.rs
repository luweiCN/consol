use assert_cmd::Command;
use predicates::prelude::*;

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
    cmd.args(["--json", "deploy", "Counter"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"status\": \"planned\""))
        .stdout(predicate::str::contains("\"command\": \"deploy\""));
}
