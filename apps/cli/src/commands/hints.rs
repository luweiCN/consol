use crate::cli::{Cli, HintsArgs};
use crate::commands::{build, gas, write};
use crate::error::AppResult;
use crate::output::{self, Meta};
use serde::Serialize;
use std::fs;

#[derive(Debug, Serialize)]
struct HintsData {
    target: String,
    file: String,
    contract: String,
    project_root: String,
    diagnostics: Vec<build::Diagnostic>,
    gas_hints: Vec<GasHint>,
}

#[derive(Debug, Serialize)]
struct GasHint {
    signature: String,
    gas: String,
    finite: bool,
    signal: write::GasSignal,
    line: Option<usize>,
    message: String,
}

pub fn run(cli: &Cli, args: &HintsArgs) -> AppResult<()> {
    let target = target_from_args(args);
    let build_data = build::build_data(cli, Some(&target))?;
    let gas_data = gas::compile_data(cli, &target)?;
    let source = fs::read_to_string(&args.file).unwrap_or_default();
    let gas_hints = gas_data
        .functions
        .iter()
        .map(|function| gas_hint(function, &source))
        .collect::<Vec<_>>();
    let data = HintsData {
        target,
        file: args.file.display().to_string(),
        contract: gas_data.contract,
        project_root: gas_data.project_root,
        diagnostics: build_data.diagnostics,
        gas_hints,
    };

    if cli.json {
        let mut meta = Meta::new("hints");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else {
        println!("Hints: {}", data.target);
        println!("  diagnostics: {}", data.diagnostics.len());
        println!("  gas hints: {}", data.gas_hints.len());
        Ok(())
    }
}

fn target_from_args(args: &HintsArgs) -> String {
    let file = args.file.display().to_string();
    args.contract
        .as_ref()
        .map_or(file.clone(), |contract| format!("{file}:{contract}"))
}

fn gas_hint(function: &gas::FunctionGas, source: &str) -> GasHint {
    let line = function_line(source, &function.signature);
    let gas_label = if function.finite {
        function.gas.clone()
    } else {
        "infinite".to_string()
    };
    GasHint {
        signature: function.signature.clone(),
        gas: function.gas.clone(),
        finite: function.finite,
        signal: function.signal.clone(),
        line,
        message: format!("gas: {gas_label}"),
    }
}

fn function_line(source: &str, signature: &str) -> Option<usize> {
    let name = signature.split_once('(')?.0;
    let needle = format!("function {name}");
    let public_var = format!(" public {name}");
    source
        .lines()
        .position(|line| {
            line.contains(&needle) || (line.contains(&public_var) && line.trim_end().ends_with(';'))
        })
        .map(|index| index + 1)
}
