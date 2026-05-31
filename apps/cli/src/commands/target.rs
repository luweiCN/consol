use crate::cli::Cli;
use crate::commands::detect;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

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

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedTarget {
    pub source_mode: SourceMode,
    pub project_root: PathBuf,
    pub source_file: Option<PathBuf>,
    pub contract_name: String,
}

pub fn resolve(cli: &Cli, target: Option<&str>) -> AppResult<ResolvedTarget> {
    match target {
        Some(target) if target.contains(".sol") => {
            if let Some(resolved) = resolve_project_file(cli, target)? {
                Ok(resolved)
            } else {
                resolve_single_file(cli, target)
            }
        }
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
        SourceMode::Project => match &resolved.source_file {
            Some(source_file) => find_project_artifact_for_source(
                &resolved.project_root,
                source_file,
                &resolved.contract_name,
            ),
            None => find_project_artifact(&resolved.project_root, &resolved.contract_name),
        },
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

fn resolve_project_file(cli: &Cli, target: &str) -> AppResult<Option<ResolvedTarget>> {
    let Some(source_file) = project_source_file(cli, target, None)? else {
        return Ok(None);
    };
    let Some(project_root) = project_root_for_source(cli, &source_file) else {
        return Ok(None);
    };
    let (_, explicit_contract) = split_source_target(target);
    let contract_name = match explicit_contract {
        Some(contract) if !contract.is_empty() => contract.to_string(),
        _ => infer_single_contract(&source_file)?,
    };

    Ok(Some(ResolvedTarget {
        source_mode: SourceMode::Project,
        project_root,
        source_file: Some(source_file),
        contract_name,
    }))
}

fn resolve_single_file(_cli: &Cli, target: &str) -> AppResult<ResolvedTarget> {
    let (file, explicit_contract) = split_source_target(target);
    let source_file = canonicalize_source_file(file)?;
    let contract_name = match explicit_contract {
        Some(contract) if !contract.is_empty() => contract.to_string(),
        _ => infer_single_contract(&source_file)?,
    };
    let project_root = scratch_root(&source_file);
    with_scratch_lock(&project_root, || {
        ensure_scratch_project(&source_file, &project_root)
    })?;

    Ok(ResolvedTarget {
        source_mode: SourceMode::SingleFile,
        project_root,
        source_file: Some(source_file),
        contract_name,
    })
}

pub(crate) fn scratch_root_for_single_file_target(target: &str) -> AppResult<PathBuf> {
    let (file, _) = split_source_target(target);
    let source_file = canonicalize_source_file(file)?;
    Ok(scratch_root(&source_file))
}

pub(crate) fn project_source_file(
    cli: &Cli,
    target: &str,
    project_root: Option<&Path>,
) -> AppResult<Option<PathBuf>> {
    let (file, _) = split_source_target(target);
    if !file.contains(".sol") {
        return Ok(None);
    }
    let cwd = std::env::current_dir()?;
    let candidates = source_file_candidates(file, cli.project.as_deref().or(project_root), &cwd);
    let Some(source_file) = candidates
        .into_iter()
        .find_map(|candidate| fs::canonicalize(candidate).ok())
    else {
        return Ok(None);
    };

    if let Some(project_root) = cli.project.as_deref().or(project_root) {
        let project_root =
            fs::canonicalize(project_root).unwrap_or_else(|_| project_root.to_path_buf());
        if source_file.starts_with(project_root) {
            return Ok(Some(source_file));
        }
        return Ok(None);
    }

    if project_root_for_source(cli, &source_file).is_some() {
        Ok(Some(source_file))
    } else {
        Ok(None)
    }
}

fn split_source_target(target: &str) -> (&str, Option<&str>) {
    target
        .split_once(':')
        .map_or((target, None), |(file, contract)| (file, Some(contract)))
}

fn source_file_candidates(file: &str, project_root: Option<&Path>, cwd: &Path) -> Vec<PathBuf> {
    let path = PathBuf::from(file);
    if path.is_absolute() {
        return vec![path];
    }
    let mut candidates = Vec::new();
    if let Some(project_root) = project_root {
        candidates.push(project_root.join(&path));
    }
    candidates.push(cwd.join(&path));
    candidates.push(path);
    candidates
}

fn project_root_for_source(cli: &Cli, source_file: &Path) -> Option<PathBuf> {
    if let Some(project_root) = &cli.project {
        let project_root = fs::canonicalize(project_root).ok()?;
        return source_file
            .starts_with(&project_root)
            .then_some(project_root);
    }

    find_upward(source_file.parent()?, "foundry.toml")
        .and_then(|foundry_toml| foundry_toml.parent().map(Path::to_path_buf))
}

fn canonicalize_source_file(file: &str) -> AppResult<PathBuf> {
    fs::canonicalize(file).map_err(|err| {
        AppError::user(
            "source_file_not_found",
            format!("Failed to read Solidity file `{file}`: {err}"),
            Some("Check the path, or run from the directory that contains the file.".to_string()),
        )
    })
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

fn ensure_scratch_project(source_file: &Path, root: &Path) -> AppResult<()> {
    let source_root = source_file.parent().ok_or_else(|| {
        AppError::user(
            "invalid_source_file",
            format!("Invalid Solidity file path: {}", source_file.display()),
            None,
        )
    })?;
    let files = collect_local_import_graph(source_file, source_root)?;
    let src_dir = root.join("src");
    fs::create_dir_all(&src_dir)?;
    fs::write(
        root.join("foundry.toml"),
        "[profile.default]\nsrc = \"src\"\nout = \"out\"\nlibs = [\"lib\"]\n",
    )?;
    let mut copied_files = Vec::new();
    for file in &files {
        let relative = file
            .strip_prefix(source_root)
            .map_err(|_| import_outside_root_error(source_root, file))?;
        let destination = src_dir.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(file, &destination)?;
        copied_files.push(format!("src/{}", relative.display()));
    }
    fs::write(
        root.join("scratch.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "original_file": source_file.display().to_string(),
            "source_root": source_root.display().to_string(),
            "copied_files": copied_files
        }))?,
    )?;
    Ok(())
}

fn collect_local_import_graph(source_file: &Path, source_root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut visited = BTreeSet::new();
    let mut files = Vec::new();
    visit_local_imports(source_file, source_root, &mut visited, &mut files)?;
    Ok(files)
}

fn visit_local_imports(
    source_file: &Path,
    source_root: &Path,
    visited: &mut BTreeSet<PathBuf>,
    files: &mut Vec<PathBuf>,
) -> AppResult<()> {
    let source_file = fs::canonicalize(source_file).map_err(|err| {
        AppError::user(
            "source_file_not_found",
            format!(
                "Failed to read Solidity file `{}`: {err}",
                source_file.display()
            ),
            Some("Check local import paths relative to the importing Solidity file.".to_string()),
        )
    })?;
    if !source_file.starts_with(source_root) {
        return Err(import_outside_root_error(source_root, &source_file));
    }
    if !visited.insert(source_file.clone()) {
        return Ok(());
    }

    let content = fs::read_to_string(&source_file)?;
    files.push(source_file.clone());
    let import_base = source_file.parent().unwrap_or(source_root);
    for import in solidity_import_paths(&content) {
        let import_path = Path::new(&import);
        let candidate = if import_path.is_absolute() {
            import_path.to_path_buf()
        } else {
            import_base.join(import_path)
        };
        if import_path.is_absolute() || import.starts_with('.') || candidate.exists() {
            visit_local_imports(&candidate, source_root, visited, files)?;
        }
    }
    Ok(())
}

fn solidity_import_paths(content: &str) -> Vec<String> {
    content.lines().filter_map(solidity_import_path).collect()
}

fn solidity_import_path(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with("import ") {
        return None;
    }
    let quote_start = trimmed
        .find('"')
        .map(|index| (index, '"'))
        .into_iter()
        .chain(trimmed.find('\'').map(|index| (index, '\'')))
        .min_by_key(|(index, _)| *index)?;
    let rest = &trimmed[quote_start.0 + 1..];
    let quote_end = rest.find(quote_start.1)?;
    Some(rest[..quote_end].to_string())
}

fn import_outside_root_error(source_root: &Path, imported: &Path) -> AppError {
    AppError::user(
        "single_file_import_outside_root",
        format!(
            "Imported Solidity file `{}` is outside the single-file source root `{}`.",
            imported.display(),
            source_root.display()
        ),
        Some(
            "Move the imported file under the same directory tree, or initialize a Foundry project."
                .to_string(),
        ),
    )
}

fn scratch_root(source_file: &Path) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    scratch_base_from_home(&home)
        .join(".cache")
        .join("consol")
        .join("scratch")
        .join(stable_hash(&source_file.display().to_string()))
}

pub(crate) fn with_scratch_lock<T>(
    project_root: &Path,
    run: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    if !is_scratch_project(project_root) {
        return run();
    }
    let _lock = acquire_scratch_lock(project_root)?;
    run()
}

fn is_scratch_project(project_root: &Path) -> bool {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    project_root.starts_with(
        scratch_base_from_home(&home)
            .join(".cache")
            .join("consol")
            .join("scratch"),
    )
}

fn scratch_base_from_home(home: &str) -> PathBuf {
    PathBuf::from(home)
}

struct ScratchLock {
    path: PathBuf,
}

impl Drop for ScratchLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn acquire_scratch_lock(root: &Path) -> AppResult<ScratchLock> {
    fs::create_dir_all(root)?;
    let path = root.join(".consol.lock");
    for _ in 0..1200 {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => return Ok(ScratchLock { path }),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(err.into()),
        }
    }
    Err(AppError::user(
        "scratch_lock_timeout",
        format!(
            "Timed out waiting for scratch project lock `{}`.",
            path.display()
        ),
        Some("Another ConSol process may still be building this single-file target.".to_string()),
    ))
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
            Some(format!(
                "Use a file-qualified target like src/{contract_name}.sol:{contract_name}."
            )),
        )),
    }
}

fn find_project_artifact_for_source(
    project_root: &Path,
    source_file: &Path,
    contract_name: &str,
) -> AppResult<PathBuf> {
    let mut name_matches = Vec::new();
    let mut source_matches = Vec::new();
    let expected_file_name = format!("{contract_name}.json");
    visit_json_files(&project_root.join("out"), &mut |path| {
        if path.file_name().and_then(|name| name.to_str()) != Some(expected_file_name.as_str()) {
            return;
        }
        name_matches.push(path.to_path_buf());
        if artifact_matches_source(path, project_root, source_file, contract_name) {
            source_matches.push(path.to_path_buf());
        }
    })?;

    match source_matches.as_slice() {
        [path] => return Ok(path.clone()),
        [_, ..] => {
            return Err(AppError::user(
                "target_ambiguous",
                format!(
                    "Multiple artifacts for `{}` and `{contract_name}` were found.",
                    source_file.display()
                ),
                Some("Remove stale artifacts and run `consol build` again.".to_string()),
            ));
        }
        [] => {}
    }

    match name_matches.as_slice() {
        [path] => Ok(path.clone()),
        [] => Err(AppError::user(
            "artifact_not_found",
            format!(
                "Contract artifact `{contract_name}` for `{}` was not found.",
                source_file.display()
            ),
            Some("Run `consol build` first, or check the file-qualified target.".to_string()),
        )),
        _ => Err(AppError::user(
            "target_ambiguous",
            format!(
                "Multiple artifacts named `{contract_name}` were found, but none identify `{}`.",
                source_file.display()
            ),
            Some("Run `consol build` to refresh artifact metadata.".to_string()),
        )),
    }
}

fn artifact_matches_source(
    artifact_path: &Path,
    project_root: &Path,
    source_file: &Path,
    contract_name: &str,
) -> bool {
    let Ok(content) = fs::read_to_string(artifact_path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&content) else {
        return false;
    };
    let Some(compilation_target) = value
        .pointer("/metadata/settings/compilationTarget")
        .and_then(Value::as_object)
    else {
        return false;
    };

    compilation_target.iter().any(|(source, name)| {
        name.as_str() == Some(contract_name)
            && artifact_source_path_matches(project_root, source_file, source)
    })
}

fn artifact_source_path_matches(
    project_root: &Path,
    source_file: &Path,
    artifact_source: &str,
) -> bool {
    let project_root =
        fs::canonicalize(project_root).unwrap_or_else(|_| project_root.to_path_buf());
    let candidate = project_root.join(artifact_source);
    fs::canonicalize(candidate)
        .map(|candidate| candidate == source_file)
        .unwrap_or(false)
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
