use crate::cli::Cli;
use crate::commands::detect;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceMode {
    Project,
    SingleFile,
}

impl std::fmt::Display for SourceMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SourceMode::Project => f.write_str("project"),
            SourceMode::SingleFile => f.write_str("single_file"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedTarget {
    pub source_mode: SourceMode,
    pub project_root: PathBuf,
    pub source_file: Option<PathBuf>,
    pub contract_name: String,
}

pub fn resolve(cli: &Cli, target: Option<&str>) -> AppResult<ResolvedTarget> {
    match target {
        Some(target) if target.contains(".sol") => resolve_single_file(cli, target),
        Some(target) => resolve_project(cli, target),
        None => resolve_project_root(cli),
    }
}

pub fn artifact_path(resolved: &ResolvedTarget) -> AppResult<PathBuf> {
    match resolved.source_mode {
        SourceMode::SingleFile => {
            let source = resolved.source_file.as_ref().ok_or_else(|| {
                AppError::user(
                    "source_file_missing",
                    "Single-file target did not resolve to a source file.",
                    Some("Use a target like ./Counter.sol:Counter.".to_string()),
                )
            })?;
            let file_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| {
                    AppError::user(
                        "invalid_source_file",
                        format!("Invalid source file path: {}", source.display()),
                        None,
                    )
                })?;
            Ok(resolved
                .project_root
                .join("out")
                .join(file_name)
                .join(format!("{}.json", resolved.contract_name)))
        }
        SourceMode::Project => {
            find_project_artifact(&resolved.project_root, &resolved.contract_name)
        }
    }
}

fn resolve_project_root(cli: &Cli) -> AppResult<ResolvedTarget> {
    let detected = detect::detect(cli, None)?;
    let project_root = detected.project_root.ok_or_else(|| {
        AppError::user(
            "foundry_project_not_found",
            "No foundry.toml was found for the current directory.",
            Some("Run inside a Foundry project, pass --project, or use a .sol target.".to_string()),
        )
    })?;
    Ok(ResolvedTarget {
        source_mode: SourceMode::Project,
        project_root: PathBuf::from(project_root),
        source_file: None,
        contract_name: String::new(),
    })
}

fn resolve_project(cli: &Cli, target: &str) -> AppResult<ResolvedTarget> {
    let detected = detect::detect(cli, Some(target))?;
    let project_root = detected.project_root.ok_or_else(|| {
        AppError::user(
            "foundry_project_not_found",
            "No foundry.toml was found for the target.",
            Some("Run inside a Foundry project, pass --project, or use a .sol target.".to_string()),
        )
    })?;
    Ok(ResolvedTarget {
        source_mode: SourceMode::Project,
        project_root: PathBuf::from(project_root),
        source_file: None,
        contract_name: target.to_string(),
    })
}

fn resolve_single_file(_cli: &Cli, target: &str) -> AppResult<ResolvedTarget> {
    let (file, explicit_contract) = target
        .split_once(':')
        .map_or((target, None), |(file, contract)| (file, Some(contract)));
    let source_file = fs::canonicalize(file).map_err(|err| {
        AppError::user(
            "source_file_not_found",
            format!("Failed to read Solidity file `{file}`: {err}"),
            Some("Check the path, or run from the directory that contains the file.".to_string()),
        )
    })?;
    let contract_name = match explicit_contract {
        Some(contract) if !contract.is_empty() => contract.to_string(),
        _ => infer_single_contract(&source_file)?,
    };
    let project_root = ensure_scratch_project(&source_file)?;

    Ok(ResolvedTarget {
        source_mode: SourceMode::SingleFile,
        project_root,
        source_file: Some(source_file),
        contract_name,
    })
}

fn infer_single_contract(source_file: &Path) -> AppResult<String> {
    let contracts = contract_names(source_file)?;
    match contracts.as_slice() {
        [name] => Ok(name.clone()),
        [] => Err(AppError::user(
            "target_not_deployable",
            format!(
                "No contract declaration found in {}.",
                source_file.display()
            ),
            Some("Use a file with a deployable contract or pass an explicit target.".to_string()),
        )),
        _ => Err(AppError::user(
            "target_ambiguous",
            format!("Multiple contracts found in {}.", source_file.display()),
            Some(format!(
                "Use an explicit target like {}:<contract>. Candidates: {}",
                source_file.display(),
                contracts.join(", ")
            )),
        )),
    }
}

fn contract_names(source_file: &Path) -> AppResult<Vec<String>> {
    let content = fs::read_to_string(source_file)?;
    let mut names = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim_start();
        for keyword in ["contract ", "library ", "interface "] {
            if let Some(rest) = trimmed.strip_prefix(keyword) {
                if let Some(name) = rest
                    .split(|ch: char| ch.is_whitespace() || ch == '{' || ch == '(')
                    .find(|part| !part.is_empty())
                {
                    names.push(name.to_string());
                }
            }
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

fn ensure_scratch_project(source_file: &Path) -> AppResult<PathBuf> {
    let file_name = source_file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            AppError::user(
                "invalid_source_file",
                format!("Invalid Solidity file path: {}", source_file.display()),
                None,
            )
        })?;
    let root = scratch_root(source_file);
    let src_dir = root.join("src");
    fs::create_dir_all(&src_dir)?;
    fs::write(
        root.join("foundry.toml"),
        "[profile.default]\nsrc = \"src\"\nout = \"out\"\nlibs = [\"lib\"]\n",
    )?;
    fs::copy(source_file, src_dir.join(file_name))?;
    fs::write(
        root.join("scratch.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "original_file": source_file.display().to_string(),
            "copied_file": format!("src/{file_name}")
        }))?,
    )?;
    Ok(root)
}

fn scratch_root(source_file: &Path) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".cache")
        .join("consol")
        .join("scratch")
        .join(stable_hash(&source_file.display().to_string()))
}

fn find_project_artifact(project_root: &Path, contract_name: &str) -> AppResult<PathBuf> {
    let out_dir = project_root.join("out");
    let mut matches = Vec::new();
    visit_json_files(&out_dir, &mut |path| {
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == format!("{contract_name}.json"))
        {
            matches.push(path.to_path_buf());
        }
    })?;

    match matches.as_slice() {
        [path] => Ok(path.clone()),
        [] => Err(AppError::user(
            "artifact_not_found",
            format!("Contract artifact `{contract_name}` was not found."),
            Some("Run `consol build` first, or check the contract name.".to_string()),
        )),
        _ => Err(AppError::user(
            "target_ambiguous",
            format!("Multiple artifacts named `{contract_name}` were found."),
            Some("Use a file-qualified target once project target syntax supports it.".to_string()),
        )),
    }
}

fn visit_json_files(dir: &Path, visitor: &mut impl FnMut(&Path)) -> AppResult<()> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            visit_json_files(&path, visitor)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            visitor(&path);
        }
    }
    Ok(())
}

pub fn stable_hash(value: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
