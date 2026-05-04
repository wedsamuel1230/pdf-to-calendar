use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::domain::{
    errors::AppError,
    models::{NotionConfig, NotionConfigInput, PersistedNotionConfig},
};

const CONFIG_FILE_NAME: &str = "notion-config.json";
const DEFAULT_DATABASE_ID_OR_URL: &str =
    "https://www.notion.so/bottlesumo/355a0ed49a7c802b909dc6c07271519f?v=355a0ed49a7c807e9c33000c33d47fb4";

fn config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app.path().app_config_dir()?;
    Ok(dir.join(CONFIG_FILE_NAME))
}

pub fn load_persisted_config(app: &AppHandle, has_token: bool) -> Result<NotionConfig, AppError> {
    let token_source = if has_token { "keychain" } else { "none" }.to_string();
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(NotionConfig {
            database_id_or_url: DEFAULT_DATABASE_ID_OR_URL.to_string(),
            date_property_name: "Time".to_string(),
            title_property_name: "Class/Event".to_string(),
            timezone: "Asia/Hong_Kong".to_string(),
            has_token,
            token_source,
            token_env_var_name: None,
        });
    }

    let raw = fs::read_to_string(path)?;
    let parsed: PersistedNotionConfig = serde_json::from_str(&raw)?;
    Ok(NotionConfig {
        database_id_or_url: parsed.database_id_or_url,
        date_property_name: migrate_date_property_name(&parsed.date_property_name),
        title_property_name: migrate_title_property_name(&parsed.title_property_name),
        timezone: parsed.timezone,
        has_token,
        token_source,
        token_env_var_name: None,
    })
}

fn migrate_title_property_name(value: &str) -> String {
    if value.trim() == "Name" {
        return "Class/Event".to_string();
    }
    value.to_string()
}

fn migrate_date_property_name(value: &str) -> String {
    if value.trim() == "Date" || value.trim() == "Start Time" {
        return "Time".to_string();
    }
    value.to_string()
}

pub fn save_persisted_config(
    app: &AppHandle,
    config: &NotionConfigInput,
    has_token: bool,
    token_source: &str,
) -> Result<NotionConfig, AppError> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let record = PersistedNotionConfig {
        database_id_or_url: config.database_id_or_url.clone(),
        date_property_name: config.date_property_name.clone(),
        title_property_name: config.title_property_name.clone(),
        timezone: config.timezone.clone(),
    };
    fs::write(path, serde_json::to_string_pretty(&record)?)?;

    Ok(NotionConfig {
        database_id_or_url: record.database_id_or_url,
        date_property_name: record.date_property_name,
        title_property_name: record.title_property_name,
        timezone: record.timezone,
        has_token,
        token_source: token_source.to_string(),
        token_env_var_name: None,
    })
}
