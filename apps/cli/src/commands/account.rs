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
    signers: Vec<String>,
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

    let address = std::env::var(&args.private_key_env)
        .ok()
        .and_then(|key| config::private_key_address(&key));
    let mut config = config::load()?;
    config.accounts.insert(
        args.name.clone(),
        AccountProfile {
            address: address.clone(),
            private_key_env: args.private_key_env.clone(),
            signer: Some("env-private-key".to_string()),
        },
    );
    config::save(&config)?;
    let account = AccountMeta {
        name: args.name.clone(),
        address,
        signer: "env-private-key".to_string(),
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
    let data = SignerList {
        active: account.signer.clone(),
        signers: vec![account.signer.clone()],
    };

    if cli.json {
        let mut meta = Meta::new("signer list");
        meta.account = Some(account);
        output::print_json(data, meta)
    } else {
        println!("Active signer: {}", data.active);
        for signer in data.signers {
            println!("  {signer}");
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

pub fn signer_status(cli: &Cli, _name: Option<&str>) -> AppResult<()> {
    let account = detect::active_account(cli)?;
    if cli.json {
        let mut meta = Meta::new("signer status");
        meta.account = Some(account.clone());
        output::print_json(account, meta)
    } else {
        println!("Signer: {}", account.signer);
        println!("  account: {}", account.name);
        println!(
            "  address: {}",
            account.address.as_deref().unwrap_or("unknown")
        );
        Ok(())
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
