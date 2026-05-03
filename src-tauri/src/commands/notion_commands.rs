use tauri::AppHandle;

use crate::{
    domain::models::{
        ConnectionResult, CreateNotionDatabaseInput, CreateNotionDatabaseResult, ImportResult,
        LessonOccurrenceInput, NotionConfig, NotionConfigInput,
    },
    services::notion_service::NotionService,
};

#[tauri::command]
pub fn load_notion_config(app: AppHandle) -> Result<NotionConfig, String> {
    NotionService::new(app)
        .load_config()
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn save_notion_config(
    app: AppHandle,
    config: NotionConfigInput,
) -> Result<NotionConfig, String> {
    NotionService::new(app)
        .save_config(config)
        .map_err(|error| error.message)
}

#[tauri::command]
pub async fn test_notion_connection(
    app: AppHandle,
    config: NotionConfigInput,
) -> Result<ConnectionResult, String> {
    NotionService::new(app)
        .test_connection(config)
        .await
        .map_err(|error| error.message)
}

#[tauri::command]
pub async fn create_notion_calendar_database(
    app: AppHandle,
    input: CreateNotionDatabaseInput,
) -> Result<CreateNotionDatabaseResult, String> {
    NotionService::new(app)
        .create_calendar_database(input)
        .await
        .map_err(|error| error.message)
}

#[tauri::command]
pub async fn import_lessons(
    app: AppHandle,
    occurrences: Vec<LessonOccurrenceInput>,
) -> Result<ImportResult, String> {
    NotionService::new(app)
        .import_lessons(occurrences)
        .await
        .map_err(|error| error.message)
}
