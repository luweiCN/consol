use crate::error::AppError;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Envelope<T: Serialize> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<ErrorBody>,
    pub meta: Meta,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub hint: Option<String>,
    pub details: serde_json::Value,
}

#[derive(Debug, Default, Serialize)]
pub struct Meta {
    pub version: &'static str,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<NetworkMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<AccountMeta>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworkMeta {
    pub name: String,
    pub kind: String,
    pub chain_id: Option<u64>,
    pub rpc_url: String,
    pub fingerprint: Option<String>,
    pub write_policy: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountMeta {
    pub name: String,
    pub address: Option<String>,
    pub signer: String,
}

impl Meta {
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION"),
            command: command.into(),
            project_root: None,
            network: None,
            account: None,
        }
    }
}

pub fn print_json<T: Serialize>(data: T, meta: Meta) -> crate::error::AppResult<()> {
    let envelope = Envelope {
        ok: true,
        data: Some(data),
        error: None,
        meta,
    };
    println!("{}", serde_json::to_string_pretty(&envelope)?);
    Ok(())
}

pub fn print_json_error(err: &AppError, meta: Meta) -> crate::error::AppResult<()> {
    let envelope: Envelope<serde_json::Value> = Envelope {
        ok: false,
        data: None,
        error: Some(ErrorBody {
            code: err.code().to_string(),
            message: err.message(),
            hint: err.hint(),
            details: err.details(),
        }),
        meta,
    };
    println!("{}", serde_json::to_string_pretty(&envelope)?);
    Ok(())
}
