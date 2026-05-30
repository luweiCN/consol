use super::detect;
use crate::cli::Cli;
use crate::error::AppResult;
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

pub fn list(cli: &Cli) -> AppResult<()> {
    let account = detect::active_account(cli);
    let data = AccountList {
        active: account.name.clone(),
        accounts: vec![account.clone()],
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

pub fn balance(cli: &Cli, selector: Option<&str>) -> AppResult<()> {
    let account = detect::active_account(cli);
    let network = detect::active_network(cli);
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
    let account = detect::active_account(cli);
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

pub fn signer_status(cli: &Cli, _name: Option<&str>) -> AppResult<()> {
    let account = detect::active_account(cli);
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
