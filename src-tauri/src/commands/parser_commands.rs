use tauri::AppHandle;

use crate::{
    domain::models::{NvidiaModelStatus, ParsedLessonForRepair, RepairLessonsInput},
    services::parser_repair_service::ParserRepairService,
};

#[tauri::command]
pub async fn list_nvidia_models(app: AppHandle) -> Result<Vec<String>, String> {
    ParserRepairService::new(app)
        .list_models()
        .await
        .map_err(|error| error.message)
}

#[tauri::command]
pub async fn get_nvidia_model_status(app: AppHandle) -> Result<NvidiaModelStatus, String> {
    ParserRepairService::new(app)
        .model_status()
        .await
        .map_err(|error| error.message)
}

#[tauri::command]
pub async fn repair_lessons_with_llm(
    app: AppHandle,
    input: RepairLessonsInput,
) -> Result<Vec<ParsedLessonForRepair>, String> {
    ParserRepairService::new(app)
        .repair_lessons(input)
        .await
        .map(|result| result.lessons)
        .map_err(|error| error.message)
}

#[tauri::command]
pub async fn extract_lessons_with_llm(
    app: AppHandle,
    mut input: RepairLessonsInput,
) -> Result<Vec<ParsedLessonForRepair>, String> {
    input.mode = Some("extract".to_string());
    ParserRepairService::new(app)
        .repair_lessons(input)
        .await
        .map(|result| result.lessons)
        .map_err(|error| error.message)
}
