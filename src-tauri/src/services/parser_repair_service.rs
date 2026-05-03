use reqwest::Client;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::domain::{
    errors::AppError,
    models::{NvidiaModelStatus, ParsedLessonForRepair, RepairLessonResult, RepairLessonsInput},
};

const NVIDIA_BASE_URL_DEFAULT: &str = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL_PREFERENCES: [&str; 4] = [
    "meta/llama-3.1-70b-instruct",
    "mistralai/mixtral-8x7b-instruct-v0.1",
    "meta/llama-3.1-8b-instruct",
    "google/gemma-2-9b-it",
];
const NVIDIA_API_KEY_ENV_VARS: [&str; 3] = ["NVIDIA_API_KEY", "NV_API_KEY", "nvapi"];
const NVIDIA_FALLBACK_MODELS: [&str; 4] = [
    "meta/llama-3.1-70b-instruct",
    "mistralai/mixtral-8x7b-instruct-v0.1",
    "meta/llama-3.1-8b-instruct",
    "google/gemma-2-9b-it",
];

#[derive(Debug, Clone)]
struct NvidiaApiKey {
    value: String,
    source_env_var: String,
}

#[derive(Clone)]
pub struct ParserRepairService {
    _app: AppHandle,
    http: Client,
}

impl ParserRepairService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            _app: app,
            http: Client::new(),
        }
    }

    pub async fn list_models(&self) -> Result<Vec<String>, AppError> {
        let token = load_nvidia_api_key();
        if token.is_none() {
            return Ok(NVIDIA_FALLBACK_MODELS
                .iter()
                .map(|item| item.to_string())
                .collect());
        }
        let token = token.map(|item| item.value).unwrap_or_default();
        let url = format!("{}/models", nvidia_base_url());
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .send()
            .await;
        let Ok(response) = response else {
            return Ok(NVIDIA_FALLBACK_MODELS
                .iter()
                .map(|item| item.to_string())
                .collect());
        };
        let body: Value = response.json().await.unwrap_or_else(|_| json!({}));
        let mut models = body
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("id").and_then(Value::as_str))
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        if models.is_empty() {
            models = NVIDIA_FALLBACK_MODELS
                .iter()
                .map(|item| item.to_string())
                .collect();
        }
        models.sort();
        models.dedup();
        Ok(models)
    }

    pub async fn model_status(&self) -> Result<NvidiaModelStatus, AppError> {
        let Some(api_key) = load_nvidia_api_key() else {
            return Ok(NvidiaModelStatus {
                has_api_key: false,
                source_env_var: None,
                models: NVIDIA_FALLBACK_MODELS
                    .iter()
                    .map(|item| item.to_string())
                    .collect(),
                used_fallback: true,
                api_error: Some("NVIDIA API key is not configured.".to_string()),
            });
        };

        let url = format!("{}/models", nvidia_base_url());
        let response = self
            .http
            .get(url)
            .bearer_auth(api_key.value)
            .header("Content-Type", "application/json")
            .send()
            .await;
        let Ok(response) = response else {
            return Ok(NvidiaModelStatus {
                has_api_key: true,
                source_env_var: Some(api_key.source_env_var),
                models: NVIDIA_FALLBACK_MODELS
                    .iter()
                    .map(|item| item.to_string())
                    .collect(),
                used_fallback: true,
                api_error: Some("Failed to fetch NVIDIA model list.".to_string()),
            });
        };
        let body: Value = response.json().await.unwrap_or_else(|_| json!({}));
        let mut models = body
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("id").and_then(Value::as_str))
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        let mut used_fallback = false;
        let mut api_error = None;
        if models.is_empty() {
            models = NVIDIA_FALLBACK_MODELS
                .iter()
                .map(|item| item.to_string())
                .collect();
            used_fallback = true;
            api_error = Some("NVIDIA model API returned no selectable models.".to_string());
        }
        models.sort();
        models.dedup();
        Ok(NvidiaModelStatus {
            has_api_key: true,
            source_env_var: Some(api_key.source_env_var),
            models,
            used_fallback,
            api_error,
        })
    }

    pub async fn repair_lessons(
        &self,
        input: RepairLessonsInput,
    ) -> Result<RepairLessonResult, AppError> {
        let token = load_nvidia_api_key();
        if token.is_none() || input.lessons.is_empty() {
            return Ok(RepairLessonResult {
                lessons: input.lessons,
            });
        }
        let token = token.map(|item| item.value).unwrap_or_default();
        let model = if let Some(value) = input.model.as_ref() {
            if !value.trim().is_empty() {
                value.clone()
            } else {
                self.pick_default_model().await?
            }
        } else {
            self.pick_default_model().await?
        };

        let prompt = build_repair_prompt(&input.lessons);
        let url = format!("{}/chat/completions", nvidia_base_url());
        let payload = json!({
            "model": model,
            "temperature": 0,
            "messages": [
                { "role": "system", "content": "You normalize timetable lessons. Return strict JSON array only." },
                { "role": "user", "content": prompt }
            ]
        });
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;
        let body: Value = response.json().await?;
        let content = body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        let array_text = extract_json_array_text(&content).unwrap_or_else(|| "[]".to_string());
        let parsed: Vec<ParsedLessonForRepair> =
            serde_json::from_str(&array_text).unwrap_or_default();
        if parsed.is_empty() {
            return Ok(RepairLessonResult {
                lessons: input.lessons,
            });
        }
        Ok(RepairLessonResult { lessons: parsed })
    }

    async fn pick_default_model(&self) -> Result<String, AppError> {
        let models = self.list_models().await?;
        for preferred in NVIDIA_MODEL_PREFERENCES {
            if models.iter().any(|value| value == preferred) {
                return Ok(preferred.to_string());
            }
        }
        if let Some(first) = models.first() {
            return Ok(first.clone());
        }
        Err(AppError::new(
            "No NVIDIA models available from /models. Configure API key and retry.",
        ))
    }
}

fn build_repair_prompt(lessons: &[ParsedLessonForRepair]) -> String {
    let json_lessons = serde_json::to_string_pretty(lessons).unwrap_or_else(|_| "[]".to_string());
    format!(
        "Normalize malformed timetable rows. Preserve ids and fields. Fill missing instructor/lessonType when obvious from sourceText. Keep weeks integers. Set repairedByLlm by increasing confidence and reducing issues.\nReturn JSON array only.\nInput:\n{}",
        json_lessons
    )
}

fn extract_json_array_text(content: &str) -> Option<String> {
    let start = content.find('[')?;
    let end = content.rfind(']')?;
    if end < start {
        return None;
    }
    Some(content[start..=end].to_string())
}

fn load_nvidia_api_key() -> Option<NvidiaApiKey> {
    for key in NVIDIA_API_KEY_ENV_VARS {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(NvidiaApiKey {
                    value: trimmed.to_string(),
                    source_env_var: key.to_string(),
                });
            }
        }
    }
    None
}

fn nvidia_base_url() -> String {
    std::env::var("NVIDIA_BASE_URL")
        .unwrap_or_else(|_| NVIDIA_BASE_URL_DEFAULT.to_string())
        .trim_end_matches('/')
        .to_string()
}
