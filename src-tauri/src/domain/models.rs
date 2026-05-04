use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionConfigInput {
    pub token: Option<String>,
    pub database_id_or_url: String,
    pub date_property_name: String,
    pub title_property_name: String,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionConfig {
    pub database_id_or_url: String,
    pub date_property_name: String,
    pub title_property_name: String,
    pub timezone: String,
    pub has_token: bool,
    pub token_source: String,
    pub token_env_var_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotionDatabaseInput {
    pub token: Option<String>,
    pub parent_page_id_or_url: String,
    pub database_name: String,
    pub date_property_name: String,
    pub title_property_name: String,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotionDatabaseResult {
    pub ok: bool,
    pub message: String,
    pub database_id: String,
    pub database_url: String,
    pub date_property_name: String,
    pub title_property_name: String,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedNotionConfig {
    pub database_id_or_url: String,
    pub date_property_name: String,
    pub title_property_name: String,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonOccurrenceInput {
    pub id: String,
    pub lesson_id: String,
    pub title: String,
    pub course_code: String,
    pub lesson_type: Option<String>,
    pub day: String,
    pub week_number: i32,
    pub start_iso: String,
    pub end_iso: String,
    pub venue: Option<String>,
    pub instructor: Option<String>,
    pub source_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseIssue {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLessonForRepair {
    pub id: String,
    pub title: String,
    pub course_code: String,
    pub lesson_type: Option<String>,
    pub day: String,
    pub start_time: String,
    pub end_time: String,
    pub venue: Option<String>,
    pub instructor: Option<String>,
    pub weeks: Vec<i32>,
    pub source_text: String,
    pub confidence: f64,
    pub issues: Vec<ParseIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairLessonsInput {
    pub lessons: Vec<ParsedLessonForRepair>,
    pub model: Option<String>,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairLessonResult {
    pub lessons: Vec<ParsedLessonForRepair>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvidiaModelStatus {
    pub has_api_key: bool,
    pub source_env_var: Option<String>,
    pub models: Vec<String>,
    pub used_fallback: bool,
    pub api_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub total: usize,
    pub imported: usize,
    pub duplicates: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionResult {
    pub ok: bool,
    pub message: String,
}

impl NotionConfigInput {
    pub fn normalized(self) -> Self {
        Self {
            token: self
                .token
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            database_id_or_url: self.database_id_or_url.trim().to_string(),
            date_property_name: self.date_property_name.trim().to_string(),
            title_property_name: self.title_property_name.trim().to_string(),
            timezone: self.timezone.trim().to_string(),
        }
    }
}

impl CreateNotionDatabaseInput {
    pub fn normalized(self) -> Self {
        Self {
            token: self
                .token
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            parent_page_id_or_url: self.parent_page_id_or_url.trim().to_string(),
            database_name: self.database_name.trim().to_string(),
            date_property_name: self.date_property_name.trim().to_string(),
            title_property_name: self.title_property_name.trim().to_string(),
            timezone: self.timezone.trim().to_string(),
        }
    }
}
