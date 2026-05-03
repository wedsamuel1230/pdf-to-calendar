use std::env;

use keyring::Entry;

use crate::domain::errors::AppError;

const KEYRING_SERVICE: &str = "pdf-to-calendar";
const KEYRING_ACCOUNT: &str = "notion-token";
const NOTION_TOKEN_ENV_VARS: [&str; 3] = ["NOTION_TOKEN", "NOTIONTOKEN", "notion_token"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenSource {
    Environment,
    Keychain,
}

impl TokenSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Environment => "environment",
            Self::Keychain => "keychain",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedToken {
    pub value: String,
    pub source: TokenSource,
}

fn entry() -> Result<Entry, AppError> {
    Ok(Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?)
}

fn load_env_token() -> Option<String> {
    for key in NOTION_TOKEN_ENV_VARS {
        if let Ok(value) = env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

pub fn load_token() -> Result<Option<String>, AppError> {
    let entry = entry()?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(other) => Err(AppError::from(other)),
    }
}

pub fn load_resolved_token(input_token: Option<String>) -> Result<Option<ResolvedToken>, AppError> {
    if let Some(value) = load_env_token() {
        return Ok(Some(ResolvedToken {
            value,
            source: TokenSource::Environment,
        }));
    }

    let from_input = input_token
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty());
    if let Some(value) = from_input {
        return Ok(Some(ResolvedToken {
            value,
            source: TokenSource::Keychain,
        }));
    }

    Ok(load_token()?.map(|value| ResolvedToken {
        value,
        source: TokenSource::Keychain,
    }))
}

pub fn detect_token_source() -> Result<Option<TokenSource>, AppError> {
    if load_env_token().is_some() {
        return Ok(Some(TokenSource::Environment));
    }

    Ok(load_token()?.map(|_| TokenSource::Keychain))
}

pub fn save_token(token: &str) -> Result<(), AppError> {
    let entry = entry()?;
    entry.set_password(token)?;
    Ok(())
}
