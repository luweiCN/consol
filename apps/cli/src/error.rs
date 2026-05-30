use serde_json::{json, Value};
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{message}")]
    User {
        code: &'static str,
        message: String,
        hint: Option<String>,
        details: Value,
    },

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    pub fn user(
        code: &'static str,
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
    ) -> Self {
        Self::User {
            code,
            message: message.into(),
            hint: hint.into(),
            details: json!({}),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            AppError::User { code, .. } => code,
            AppError::Io(_) => "io_error",
            AppError::Json(_) => "json_error",
        }
    }

    pub fn message(&self) -> String {
        match self {
            AppError::User { message, .. } => message.clone(),
            AppError::Io(err) => err.to_string(),
            AppError::Json(err) => err.to_string(),
        }
    }

    pub fn hint(&self) -> Option<String> {
        match self {
            AppError::User { hint, .. } => hint.clone(),
            AppError::Io(_) => None,
            AppError::Json(_) => None,
        }
    }

    pub fn details(&self) -> Value {
        match self {
            AppError::User { details, .. } => details.clone(),
            AppError::Io(_) => json!({}),
            AppError::Json(_) => json!({}),
        }
    }
}
