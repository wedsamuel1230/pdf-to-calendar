use once_cell::sync::Lazy;
use regex::Regex;
use tauri::AppHandle;

use crate::{
    domain::{
        errors::AppError,
        models::{
            ConnectionResult, CreateNotionDatabaseInput, CreateNotionDatabaseResult, ImportResult,
            LessonOccurrenceInput, NotionConfig, NotionConfigInput,
        },
    },
    infrastructure::{
        config_store,
        notion_client::{occurrence_duplicate_key, resolve_property_name, NotionClient},
        secret_store,
    },
};

static DATABASE_ID_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})")
    .expect("database regex should compile")
});
const LOCKED_TITLE_PROPERTY: &str = "Class/Event";
const LOCKED_DATE_PROPERTY: &str = "Time";

#[derive(Clone)]
pub struct NotionService {
    app: AppHandle,
    client: NotionClient,
}

impl NotionService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            client: NotionClient::default(),
        }
    }

    pub fn load_config(&self) -> Result<NotionConfig, AppError> {
        let token_status = secret_store::detect_token_status()?;
        let has_token = token_status.source.is_some();
        let mut config = config_store::load_persisted_config(&self.app, has_token)?;
        config.title_property_name = LOCKED_TITLE_PROPERTY.to_string();
        config.date_property_name = LOCKED_DATE_PROPERTY.to_string();
        config.token_source = token_status
            .source
            .map(|source| source.as_str().to_string())
            .unwrap_or_else(|| "none".to_string());
        config.token_env_var_name = token_status.env_var_name;
        Ok(config)
    }

    pub fn save_config(&self, input: NotionConfigInput) -> Result<NotionConfig, AppError> {
        let mut config = input.normalized();
        config.title_property_name = LOCKED_TITLE_PROPERTY.to_string();
        config.date_property_name = LOCKED_DATE_PROPERTY.to_string();
        self.validate_config(&config)?;

        if let Some(token) = config.token.as_ref() {
            secret_store::save_token(token)?;
        }

        let token_status = secret_store::detect_token_status()?;
        let has_token = token_status.source.is_some() || config.token.is_some();
        let token_source_label = token_status
            .source
            .map(|source| source.as_str().to_string())
            .unwrap_or_else(|| {
                if config.token.is_some() {
                    "keychain".to_string()
                } else {
                    "none".to_string()
                }
            });
        config_store::save_persisted_config(&self.app, &config, has_token, &token_source_label)
    }

    pub async fn test_connection(
        &self,
        input: NotionConfigInput,
    ) -> Result<ConnectionResult, AppError> {
        let mut config = input.normalized();
        config.title_property_name = LOCKED_TITLE_PROPERTY.to_string();
        config.date_property_name = LOCKED_DATE_PROPERTY.to_string();
        self.validate_config(&config)?;
        let token = self.resolve_token(config.token)?;
        let database_id = extract_database_id(&config.database_id_or_url)?;

        if let Err(error) = self
            .client
            .test_database_access(&token.value, &database_id)
            .await
        {
            return Err(map_notion_access_error(&config.database_id_or_url, error));
        }

        let token_source_label = if let Some(env_var_name) = token.source_env_var.as_deref() {
            format!("{} ({env_var_name})", token.source.as_str())
        } else {
            token.source.as_str().to_string()
        };

        Ok(ConnectionResult {
            ok: true,
            message: format!(
                "Connected using {} token. Database {database_id} is reachable.",
                token_source_label
            ),
        })
    }

    pub async fn create_calendar_database(
        &self,
        input: CreateNotionDatabaseInput,
    ) -> Result<CreateNotionDatabaseResult, AppError> {
        let mut input = input.normalized();
        input.title_property_name = LOCKED_TITLE_PROPERTY.to_string();
        input.date_property_name = LOCKED_DATE_PROPERTY.to_string();
        self.validate_database_setup(&input)?;
        let token = self.resolve_token(input.token.clone())?;
        let parent_page_id = extract_notion_id(&input.parent_page_id_or_url)?;

        if let Some(token) = input.token.as_ref() {
            secret_store::save_token(token)?;
        }

        let created = self
            .client
            .create_database(
                &token.value,
                &parent_page_id,
                &input.database_name,
                &input.title_property_name,
                &input.date_property_name,
            )
            .await?;

        let saved_config = NotionConfigInput {
            token: None,
            database_id_or_url: created.database_url.clone(),
            date_property_name: input.date_property_name.clone(),
            title_property_name: input.title_property_name.clone(),
            timezone: input.timezone.clone(),
        };
        let token_source = secret_store::detect_token_source()?;
        let has_token = token_source.is_some();
        let token_source_label = token_source
            .map(|source| source.as_str().to_string())
            .unwrap_or_else(|| "none".to_string());
        config_store::save_persisted_config(
            &self.app,
            &saved_config,
            has_token,
            &token_source_label,
        )?;

        Ok(CreateNotionDatabaseResult {
            ok: true,
            message: format!(
                "Created and saved Notion database \"{}\". Future imports will reuse {}.",
                input.database_name, created.database_id
            ),
            database_id: created.database_id,
            database_url: created.database_url,
            date_property_name: input.date_property_name,
            title_property_name: input.title_property_name,
            timezone: input.timezone,
        })
    }

    pub async fn import_lessons(
        &self,
        occurrences: Vec<LessonOccurrenceInput>,
    ) -> Result<ImportResult, AppError> {
        if occurrences.is_empty() {
            return Ok(ImportResult {
                total: 0,
                imported: 0,
                duplicates: 0,
                failed: 0,
                errors: vec![],
            });
        }

        let saved = self.load_config()?;
        if saved.database_id_or_url.trim().is_empty() {
            return Err(AppError::new(
                "Missing Notion database setting. Save settings before importing.",
            ));
        }

        let token = self.resolve_token(None)?;
        let database_id = extract_database_id(&saved.database_id_or_url)?;
        let schema = self
            .client
            .retrieve_database_schema(&token.value, &database_id)
            .await
            .map_err(|error| map_notion_access_error(&saved.database_id_or_url, error))?;
        let title_property_name = resolve_property_name(
            &schema,
            "Class/Event",
            &["classevent", "class", "event", "name", "title"],
            "title",
        )
        .ok_or_else(|| {
            AppError::new("Could not find a title property in the target Notion database.")
        })?;
        let date_property_name = resolve_property_name(
            &schema,
            "Time",
            &["time", "starttime"],
            "date",
        )
        .ok_or_else(|| {
            AppError::new("Could not find a date property in the target Notion database.")
        })?;
        let mut existing_keys = self
            .client
            .existing_duplicate_keys(
                &token.value,
                &database_id,
                &title_property_name,
                &schema,
                &date_property_name,
            )
            .await
            .map_err(|error| map_notion_access_error(&saved.database_id_or_url, error))?;
        let mut result = ImportResult {
            total: occurrences.len(),
            imported: 0,
            duplicates: 0,
            failed: 0,
            errors: vec![],
        };

        for occurrence in occurrences {
            if occurrence.start_iso.trim().is_empty() || occurrence.end_iso.trim().is_empty() {
                result.failed += 1;
                result
                    .errors
                    .push(format!("{}: invalid datetime values.", occurrence.id));
                continue;
            }

            if existing_keys.contains(&occurrence_duplicate_key(&occurrence)) {
                result.duplicates += 1;
                continue;
            }

            if let Err(error) = self
                .client
                .create_page(
                    &token.value,
                    &database_id,
                    &title_property_name,
                    &date_property_name,
                    &saved.timezone,
                    &schema,
                    &occurrence,
                )
                .await
            {
                result.failed += 1;
                result
                    .errors
                    .push(format!("{}: {}", occurrence.id, error.message));
            } else {
                result.imported += 1;
                existing_keys.insert(occurrence_duplicate_key(&occurrence));
            }
        }

        Ok(result)
    }

    fn validate_config(&self, config: &NotionConfigInput) -> Result<(), AppError> {
        if config.database_id_or_url.trim().is_empty() {
            return Err(AppError::new("Database ID or URL is required."));
        }
        if config.date_property_name.trim().is_empty() {
            return Err(AppError::new("Date property name is required."));
        }
        if config.title_property_name.trim().is_empty() {
            return Err(AppError::new("Title property name is required."));
        }
        if config.timezone.trim().is_empty() {
            return Err(AppError::new("Timezone is required."));
        }
        Ok(())
    }

    fn validate_database_setup(&self, input: &CreateNotionDatabaseInput) -> Result<(), AppError> {
        if input.parent_page_id_or_url.trim().is_empty() {
            return Err(AppError::new("Parent page URL or ID is required."));
        }
        if input.database_name.trim().is_empty() {
            return Err(AppError::new("Database name is required."));
        }
        self.validate_config(&NotionConfigInput {
            token: None,
            database_id_or_url: "pending".to_string(),
            date_property_name: input.date_property_name.clone(),
            title_property_name: input.title_property_name.clone(),
            timezone: input.timezone.clone(),
        })
    }

    fn resolve_token(
        &self,
        input_token: Option<String>,
    ) -> Result<crate::infrastructure::secret_store::ResolvedToken, AppError> {
        secret_store::load_resolved_token(input_token)?.ok_or_else(|| {
            AppError::new(
                "Notion token missing. Set NOTION_TOKEN or save a token in app settings first.",
            )
        })
    }
}

fn map_notion_access_error(target: &str, error: AppError) -> AppError {
    if error.message.contains("[object_not_found]") {
        return AppError::new(format!(
            "Notion can authenticate this integration, but {} is not shared with it. Open {} in Notion, then use Share or Connections to add the integration and retry. Original response: {}",
            target, target, error.message
        ));
    }

    error
}

fn hyphenate_32_char_id(id: &str) -> String {
    format!(
        "{}-{}-{}-{}-{}",
        &id[0..8],
        &id[8..12],
        &id[12..16],
        &id[16..20],
        &id[20..32]
    )
}

pub fn extract_database_id(input: &str) -> Result<String, AppError> {
    extract_notion_id(input)
}

pub fn extract_notion_id(input: &str) -> Result<String, AppError> {
    let found = DATABASE_ID_REGEX
        .captures(input)
        .and_then(|caps| caps.get(1))
        .map(|value| value.as_str().to_string())
        .ok_or_else(|| {
            AppError::new("Could not extract Notion database ID from the provided value.")
        })?;

    let compact = found.replace('-', "");
    if compact.len() == 32 {
        return Ok(hyphenate_32_char_id(&compact.to_lowercase()));
    }

    Err(AppError::new("Invalid Notion database ID."))
}

#[cfg(test)]
mod tests {
    use super::{extract_database_id, extract_notion_id};

    #[test]
    fn extracts_database_id_from_url() {
        let id = extract_database_id(
            "https://www.notion.so/workspace/timetable-db-a1b2c3d4e5f6478899aabbccddeeff00?v=1",
        )
        .expect("id should parse");
        assert_eq!(id, "a1b2c3d4-e5f6-4788-99aa-bbccddeeff00");
    }

    #[test]
    fn extracts_database_id_from_plain_text() {
        let id = extract_database_id("a1b2c3d4e5f6478899aabbccddeeff00").expect("id should parse");
        assert_eq!(id, "a1b2c3d4-e5f6-4788-99aa-bbccddeeff00");
    }

    #[test]
    fn extracts_page_id_from_url() {
        let id = extract_notion_id(
            "https://www.notion.so/workspace/a1b2c3d4e5f6478899aabbccddeeff00?pvs=4",
        )
        .expect("id should parse");
        assert_eq!(id, "a1b2c3d4-e5f6-4788-99aa-bbccddeeff00");
    }
}
