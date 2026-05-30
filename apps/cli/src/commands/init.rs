use crate::cli::{Cli, InitArgs};
use crate::error::{AppError, AppResult};
use crate::output::{self, Meta};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
struct InitData {
    project_root: String,
    source_file: Option<String>,
    copied_source: Option<String>,
    created: Vec<String>,
}

pub fn run(cli: &Cli, args: &InitArgs) -> AppResult<()> {
    let project_root = resolve_project_root(args)?;
    let source_file = args
        .from_file
        .as_deref()
        .map(fs::canonicalize)
        .transpose()?;
    let data = create_project(&project_root, source_file.as_deref())?;

    if cli.json {
        let mut meta = Meta::new("init");
        meta.project_root = Some(data.project_root.clone());
        output::print_json(data, meta)
    } else {
        println!("ConSol project initialized: {}", data.project_root);
        if let Some(source) = &data.copied_source {
            println!("  source: {source}");
        }
        println!("  next:");
        println!("    cd {}", data.project_root);
        println!("    consol build");
        Ok(())
    }
}

fn resolve_project_root(args: &InitArgs) -> AppResult<PathBuf> {
    if let Some(to) = &args.to {
        return Ok(to.clone());
    }
    if let Some(from_file) = &args.from_file {
        let stem = from_file
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                AppError::user(
                    "init_source_invalid",
                    format!("Invalid Solidity source path: {}", from_file.display()),
                    None,
                )
            })?;
        return Ok(std::env::current_dir()?.join(format!("{stem}-foundry")));
    }
    Ok(std::env::current_dir()?)
}

fn create_project(project_root: &Path, source_file: Option<&Path>) -> AppResult<InitData> {
    if project_root.join("foundry.toml").exists() {
        return Err(AppError::user(
            "project_already_initialized",
            format!("{} already contains foundry.toml.", project_root.display()),
            Some("Choose a different --to directory or use the existing project.".to_string()),
        ));
    }

    fs::create_dir_all(project_root.join("src"))?;
    fs::create_dir_all(project_root.join("test"))?;
    fs::create_dir_all(project_root.join("script"))?;
    fs::create_dir_all(project_root.join("lib"))?;

    let mut created = Vec::new();
    write_file(
        &project_root.join("foundry.toml"),
        "[profile.default]\nsrc = \"src\"\nout = \"out\"\nlibs = [\"lib\"]\n",
        &mut created,
    )?;

    let (source_file, copied_source) = if let Some(source_file) = source_file {
        let file_name = source_file
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                AppError::user(
                    "init_source_invalid",
                    format!("Invalid Solidity source path: {}", source_file.display()),
                    None,
                )
            })?;
        let destination = project_root.join("src").join(file_name);
        if destination.exists() {
            return Err(AppError::user(
                "init_source_exists",
                format!("{} already exists.", destination.display()),
                Some("Choose a different --to directory or move the existing file.".to_string()),
            ));
        }
        fs::copy(source_file, &destination)?;
        created.push(destination.display().to_string());
        (
            Some(source_file.display().to_string()),
            Some(destination.display().to_string()),
        )
    } else {
        let destination = project_root.join("src").join("Counter.sol");
        write_file(&destination, SAMPLE_COUNTER, &mut created)?;
        (None, Some(destination.display().to_string()))
    };

    Ok(InitData {
        project_root: project_root.display().to_string(),
        source_file,
        copied_source,
        created,
    })
}

fn write_file(path: &Path, contents: &str, created: &mut Vec<String>) -> AppResult<()> {
    if path.exists() {
        return Err(AppError::user(
            "init_file_exists",
            format!("{} already exists.", path.display()),
            Some("Choose a different --to directory or remove the existing file.".to_string()),
        ));
    }
    fs::write(path, contents)?;
    created.push(path.display().to_string());
    Ok(())
}

const SAMPLE_COUNTER: &str = r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public number;

    event NumberChanged(uint256 value);

    function setNumber(uint256 newNumber) public {
        number = newNumber;
        emit NumberChanged(newNumber);
    }

    function increment() public {
        number++;
        emit NumberChanged(number);
    }
}
"#;
