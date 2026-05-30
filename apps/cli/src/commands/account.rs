use super::detect;
use crate::cli::{AccountImportArgs, Cli};
use crate::config::{self, AccountProfile};
use crate::error::{AppError, AppResult};
use crate::output::{self, AccountMeta, Meta};
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct AccountList {
    active: String,
    accounts: Vec<AccountMeta>,
}

#[derive(Debug, Serialize)]
struct Balance {
    selector: String,
    wei: Option<String>,
}

#[derive(Debug, Serialize)]
struct SignerList {
    active: String,
    signers: Vec<SignerListItem>,
}

#[derive(Debug, Clone, Serialize)]
struct SignerListItem {
    name: String,
    source: String,
    account: String,
    address: Option<String>,
    active: bool,
    available: bool,
}

#[derive(Debug, Serialize)]
struct AccountAction {
    action: String,
    name: String,
    active: String,
    account: AccountMeta,
    config_path: String,
}

pub fn list(cli: &Cli) -> AppResult<()> {
    let account = detect::active_account(cli)?;
    let config = config::load()?;
    let mut accounts = vec![config::account_meta_from_selector(&config, "anvil0")?];
    if std::env::var("ETH_PRIVATE_KEY").is_ok() {
        accounts.push(config::account_meta_from_selector(&config, "env")?);
    }
    for name in config.accounts.keys() {
        accounts.push(config::account_meta_from_selector(&config, name)?);
    }
    let data = AccountList {
        active: account.name.clone(),
        accounts,
    };

    if cli.json {
        let mut meta = Meta::new("account list");
        meta.account = Some(account);
        output::print_json(data, meta)
    } else {
        println!("Active account: {}", data.active);
        for account in data.accounts {
            println!(
                "  {} {} signer={}",
                account.name,
                account.address.as_deref().unwrap_or("address unknown"),
                account.signer
            );
        }
        Ok(())
    }
}

pub fn use_account(cli: &Cli, selector: &str) -> AppResult<()> {
    let mut config = config::load()?;
    let account = config::account_meta_from_selector(&config, selector)?;
    if account.signer == "selected" {
        return Err(AppError::user(
            "account_not_found",
            format!("Account profile `{selector}` does not exist."),
            Some(
                "Run `consol account list` or import one with `consol account import`.".to_string(),
            ),
        ));
    }
    config.active_account = Some(selector.to_string());
    config::save(&config)?;
    print_action(
        cli,
        AccountAction {
            action: "selected".to_string(),
            name: selector.to_string(),
            active: selector.to_string(),
            account,
            config_path: config::config_path().display().to_string(),
        },
    )
}

pub fn import(cli: &Cli, args: &AccountImportArgs) -> AppResult<()> {
    if args.name == "anvil0" || args.name == "env" {
        return Err(AppError::user(
            "account_reserved",
            format!("`{}` is a built-in account name.", args.name),
            Some("Use a different account profile name.".to_string()),
        ));
    }

    let signer = import_signer(args)?;
    let address = match signer.as_str() {
        "env-private-key" => args
            .private_key_env
            .as_deref()
            .and_then(|env_name| std::env::var(env_name).ok())
            .and_then(|key| config::private_key_address(&key)),
        "keystore" => args
            .password_env
            .as_deref()
            .and_then(|env_name| {
                config::keystore_private_key(
                    args.keystore.as_deref().unwrap_or(&args.name),
                    args.keystore_dir.as_deref(),
                    env_name,
                )
                .ok()
            })
            .and_then(|key| config::private_key_address(&key)),
        _ => None,
    };
    let mut config = config::load()?;
    config.accounts.insert(
        args.name.clone(),
        AccountProfile {
            address: address.clone(),
            private_key_env: (signer == "env-private-key").then(|| {
                args.private_key_env
                    .clone()
                    .expect("env signer requires private_key_env")
            }),
            keystore: (signer == "keystore").then(|| {
                args.keystore
                    .clone()
                    .expect("keystore signer requires keystore")
            }),
            keystore_dir: (signer == "keystore")
                .then(|| args.keystore_dir.clone())
                .flatten(),
            password_env: (signer == "keystore").then(|| {
                args.password_env
                    .clone()
                    .expect("keystore signer requires password_env")
            }),
            signer: Some(signer.clone()),
        },
    );
    config::save(&config)?;
    let account = AccountMeta {
        name: args.name.clone(),
        address,
        signer,
    };
    print_action(
        cli,
        AccountAction {
            action: "imported".to_string(),
            name: args.name.clone(),
            active: config
                .active_account
                .clone()
                .unwrap_or_else(|| "anvil0".to_string()),
            account,
            config_path: config::config_path().display().to_string(),
        },
    )
}

fn import_signer(args: &AccountImportArgs) -> AppResult<String> {
    match (&args.private_key_env, &args.keystore) {
        (Some(_), None) => Ok("env-private-key".to_string()),
        (None, Some(_)) => {
            if args.password_env.is_none() {
                return Err(AppError::user(
                    "keystore_password_env_missing",
                    "Keystore account import requires `--password-env`.",
                    Some(
                        "ConSol stores only the env var name; set it before writes to decrypt the keystore."
                            .to_string(),
                    ),
                ));
            }
            Ok("keystore".to_string())
        }
        (None, None) => Err(AppError::user(
            "account_import_signer_missing",
            "Account import requires a signer source.",
            Some(
                "Use `--private-key-env <ENV>` or `--keystore <ACCOUNT> --password-env <ENV>`."
                    .to_string(),
            ),
        )),
        (Some(_), Some(_)) => Err(AppError::user(
            "account_import_signer_conflict",
            "Account import accepts only one signer source.",
            Some("Use either `--private-key-env` or `--keystore`, not both.".to_string()),
        )),
    }
}

pub fn balance(cli: &Cli, selector: Option<&str>) -> AppResult<()> {
    let account = detect::active_account(cli)?;
    let network = detect::active_network(cli)?;
    let selector = selector
        .map(ToOwned::to_owned)
        .or_else(|| account.address.clone())
        .unwrap_or_else(|| account.name.clone());
    let data = Balance {
        wei: balance_wei(&selector, &network.rpc_url),
        selector,
    };

    if cli.json {
        let mut meta = Meta::new("account balance");
        meta.account = Some(account);
        meta.network = Some(network);
        output::print_json(data, meta)
    } else {
        println!(
            "Balance {}: {} wei",
            data.selector,
            data.wei.as_deref().unwrap_or("unknown")
        );
        Ok(())
    }
}

pub fn signer_list(cli: &Cli) -> AppResult<()> {
    let account = detect::active_account(cli)?;
    let config = config::load()?;
    let signers = signer_items(&config, &account)?;
    let data = SignerList {
        active: account.name.clone(),
        signers,
    };

    if cli.json {
        let mut meta = Meta::new("signer list");
        meta.account = Some(account);
        output::print_json(data, meta)
    } else {
        println!("Active signer: {}", data.active);
        for signer in data.signers {
            println!(
                "  {}{} source={} account={} available={}",
                if signer.active { "*" } else { " " },
                signer.name,
                signer.source,
                signer.account,
                signer.available
            );
        }
        Ok(())
    }
}

fn print_action(cli: &Cli, data: AccountAction) -> AppResult<()> {
    if cli.json {
        let mut meta = Meta::new(format!("account {}", data.action));
        meta.account = Some(data.account.clone());
        output::print_json(data, meta)
    } else {
        println!("account {}: {}", data.action, data.name);
        println!("  active: {}", data.active);
        println!(
            "  address: {}",
            data.account.address.as_deref().unwrap_or("unknown")
        );
        println!("  signer: {}", data.account.signer);
        println!("  config: {}", data.config_path);
        Ok(())
    }
}

pub fn signer_status(cli: &Cli, name: Option<&str>) -> AppResult<()> {
    let account = detect::active_account(cli)?;
    let config = config::load()?;
    let signers = signer_items(&config, &account)?;
    let signer = match name {
        Some(name) => signers
            .into_iter()
            .find(|signer| signer.name == name)
            .ok_or_else(|| {
                AppError::user(
                    "signer_not_found",
                    format!("Signer profile `{name}` does not exist."),
                    Some("Run `consol signer list` to see configured signers.".to_string()),
                )
            })?,
        None => signers
            .into_iter()
            .find(|signer| signer.active)
            .ok_or_else(|| {
                AppError::user(
                    "signer_not_found",
                    "No active signer profile is available.",
                    Some("Run `consol account use <name>` to select an account.".to_string()),
                )
            })?,
    };

    if cli.json {
        let mut meta = Meta::new("signer status");
        meta.account = Some(account.clone());
        output::print_json(signer, meta)
    } else {
        println!("Signer: {}", signer.name);
        println!("  source: {}", signer.source);
        println!("  account: {}", signer.account);
        println!(
            "  address: {}",
            signer.address.as_deref().unwrap_or("unknown")
        );
        println!("  available: {}", signer.available);
        Ok(())
    }
}

fn signer_items(
    config: &config::Config,
    active_account: &AccountMeta,
) -> AppResult<Vec<SignerListItem>> {
    let mut items = vec![signer_item(
        "anvil0",
        &config::account_meta_from_selector(config, "anvil0")?,
        active_account,
        true,
    )];
    if std::env::var("ETH_PRIVATE_KEY").is_ok() {
        items.push(signer_item(
            "env",
            &config::account_meta_from_selector(config, "env")?,
            active_account,
            true,
        ));
    }
    for (name, profile) in &config.accounts {
        let account = config::account_meta_from_selector(config, name)?;
        items.push(signer_item(
            name,
            &account,
            active_account,
            signer_available(profile),
        ));
    }
    Ok(items)
}

fn signer_item(
    name: &str,
    account: &AccountMeta,
    active_account: &AccountMeta,
    available: bool,
) -> SignerListItem {
    SignerListItem {
        name: name.to_string(),
        source: account.signer.clone(),
        account: account.name.clone(),
        address: account.address.clone(),
        active: account.name == active_account.name,
        available,
    }
}

fn signer_available(profile: &AccountProfile) -> bool {
    let source = profile.signer.as_deref().unwrap_or_else(|| {
        if profile.keystore.is_some() {
            "keystore"
        } else {
            "env-private-key"
        }
    });
    match source {
        "env-private-key" => profile
            .private_key_env
            .as_ref()
            .is_some_and(|name| std::env::var(name).is_ok()),
        "keystore" => profile
            .password_env
            .as_ref()
            .is_some_and(|name| std::env::var(name).is_ok()),
        _ => false,
    }
}

fn balance_wei(selector: &str, rpc_url: &str) -> Option<String> {
    let output = Command::new("cast")
        .args(["balance", selector, "--rpc-url", rpc_url])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
