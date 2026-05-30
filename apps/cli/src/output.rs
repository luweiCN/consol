use crate::error::AppError;
use serde::ser::SerializeStruct;
use serde::Serialize;
use std::io::{self, Write};

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

#[derive(Debug, Clone)]
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

pub fn print_ndjson_event<T: Serialize>(
    event_type: &str,
    sequence: u64,
    data: T,
    meta: Meta,
) -> crate::error::AppResult<()> {
    let event = serde_json::json!({
        "type": event_type,
        "sequence": sequence,
        "timestamp_ms": unix_timestamp_ms(),
        "data": data,
        "meta": meta,
    });
    let mut stdout = io::stdout();
    serde_json::to_writer(&mut stdout, &event)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

pub fn print_ndjson_error(
    err: &AppError,
    sequence: u64,
    meta: Meta,
) -> crate::error::AppResult<()> {
    print_ndjson_event(
        "error",
        sequence,
        serde_json::json!({
            "code": err.code(),
            "message": err.message(),
            "hint": err.hint(),
            "details": err.details(),
        }),
        meta,
    )
}

fn unix_timestamp_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
}

impl Serialize for NetworkMeta {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("NetworkMeta", 6)?;
        state.serialize_field("name", &self.name)?;
        state.serialize_field("kind", &self.kind)?;
        state.serialize_field("chain_id", &self.chain_id)?;
        state.serialize_field("rpc_url", &redact_rpc_url(&self.rpc_url))?;
        state.serialize_field("fingerprint", &self.fingerprint)?;
        state.serialize_field("write_policy", &self.write_policy)?;
        state.end()
    }
}

pub fn redact_rpc_url(rpc_url: &str) -> String {
    let value = rpc_url.trim();
    if value.is_empty() || is_local_rpc(value) {
        return value.to_string();
    }

    let (scheme, rest) = value
        .split_once("://")
        .map_or(("", value), |(scheme, rest)| (scheme, rest));
    let split_at = rest
        .find(|ch| ['/', '?', '#'].contains(&ch))
        .unwrap_or(rest.len());
    let authority = &rest[..split_at];
    let suffix = &rest[split_at..];
    let safe_authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let prefix = if scheme.is_empty() {
        safe_authority.to_string()
    } else {
        format!("{scheme}://{safe_authority}")
    };

    if suffix.is_empty() || suffix == "/" {
        prefix
    } else {
        format!("{prefix}/<redacted>")
    }
}

fn is_local_rpc(rpc_url: &str) -> bool {
    matches!(
        rpc_host(rpc_url).as_deref(),
        Some("localhost" | "127.0.0.1" | "::1")
    )
}

fn rpc_host(rpc_url: &str) -> Option<String> {
    let value = rpc_url.trim();
    let authority = value
        .split_once("://")
        .map_or(value, |(_, rest)| rest)
        .split(['/', '?', '#'])
        .next()?;
    let host_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if let Some(rest) = host_port.strip_prefix('[') {
        return rest
            .split_once(']')
            .map(|(host, _)| host.to_ascii_lowercase());
    }
    let host = host_port
        .split_once(':')
        .map_or(host_port, |(host, _)| host);
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_remote_rpc_paths_and_queries() {
        assert_eq!(
            redact_rpc_url("https://eth-mainnet.g.alchemy.com/v2/secret-key"),
            "https://eth-mainnet.g.alchemy.com/<redacted>"
        );
        assert_eq!(
            redact_rpc_url("https://rpc.example.com?token=secret"),
            "https://rpc.example.com/<redacted>"
        );
        assert_eq!(
            redact_rpc_url("https://user:password@rpc.example.com"),
            "https://rpc.example.com"
        );
    }

    #[test]
    fn keeps_local_rpc_urls_visible() {
        assert_eq!(
            redact_rpc_url("http://127.0.0.1:8545/my-path?debug=true"),
            "http://127.0.0.1:8545/my-path?debug=true"
        );
    }
}
