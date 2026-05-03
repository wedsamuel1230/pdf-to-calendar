use std::collections::HashSet;

use reqwest::Client;
use serde_json::{json, Map, Value};

use crate::domain::{errors::AppError, models::LessonOccurrenceInput};

const NOTION_VERSION: &str = "2022-06-28";

#[derive(Clone)]
pub struct NotionClient {
    http: Client,
    base_url: String,
}

#[derive(Debug, Clone)]
pub struct CreatedDatabase {
    pub database_id: String,
    pub database_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabasePropertyDefinition {
    pub name: String,
    pub property_type: String,
}

const DAY_PROPERTY: &str = "Day";
const START_DATE_PROPERTY: &str = "Start Date";
const START_TIME_PROPERTY: &str = "Start Time";
const END_TIME_PROPERTY: &str = "End Time";
const END_DATE_PROPERTY: &str = "End Date";
const LOCATION_PROPERTY: &str = "Location";
const INSTRUCTOR_PROPERTY: &str = "Instructor";

impl Default for NotionClient {
    fn default() -> Self {
        let base_url = std::env::var("NOTION_API_BASE_URL")
            .unwrap_or_else(|_| "https://api.notion.com".to_string());
        Self::with_base_url(base_url)
    }
}

impl NotionClient {
    pub fn with_base_url(base_url: String) -> Self {
        Self {
            http: Client::new(),
            base_url,
        }
    }

    fn auth_headers(
        &self,
        request: reqwest::RequestBuilder,
        token: &str,
    ) -> reqwest::RequestBuilder {
        request
            .bearer_auth(token)
            .header("Notion-Version", NOTION_VERSION)
            .header("Content-Type", "application/json")
    }

    async fn ensure_success(&self, response: reqwest::Response) -> Result<Value, AppError> {
        let status = response.status();
        let body: Value = response.json().await.unwrap_or_else(|_| json!({}));
        if status.is_success() {
            return Ok(body);
        }

        let message = body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Notion API returned an error");
        let code = body
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("unknown_error");
        Err(AppError::new(format!("{status} [{code}]: {message}")))
    }

    pub async fn test_database_access(
        &self,
        token: &str,
        database_id: &str,
    ) -> Result<(), AppError> {
        let url = format!("{}/v1/databases/{database_id}", self.base_url);
        let response = self.auth_headers(self.http.get(url), token).send().await?;
        self.ensure_success(response).await?;
        Ok(())
    }

    pub async fn retrieve_database_schema(
        &self,
        token: &str,
        database_id: &str,
    ) -> Result<Vec<DatabasePropertyDefinition>, AppError> {
        let url = format!("{}/v1/databases/{database_id}", self.base_url);
        let response = self.auth_headers(self.http.get(url), token).send().await?;
        let body = self.ensure_success(response).await?;
        let properties = body
            .get("properties")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                AppError::new("Notion API response did not include database properties.")
            })?;

        let mut result = Vec::with_capacity(properties.len());
        for (name, value) in properties {
            let property_type = value.get("type").and_then(Value::as_str).ok_or_else(|| {
                AppError::new(format!("Database property {name} is missing its type."))
            })?;
            result.push(DatabasePropertyDefinition {
                name: name.clone(),
                property_type: property_type.to_string(),
            });
        }
        Ok(result)
    }

    pub async fn create_database(
        &self,
        token: &str,
        parent_page_id: &str,
        database_name: &str,
        title_property_name: &str,
        date_property_name: &str,
    ) -> Result<CreatedDatabase, AppError> {
        let mut properties = Map::new();
        properties.insert(title_property_name.to_string(), json!({ "title": {} }));
        properties.insert(date_property_name.to_string(), json!({ "date": {} }));
        for (name, definition) in [
            (DAY_PROPERTY, json!({ "select": {} })),
            (START_DATE_PROPERTY, json!({ "date": {} })),
            (START_TIME_PROPERTY, json!({ "date": {} })),
            (END_TIME_PROPERTY, json!({ "date": {} })),
            (END_DATE_PROPERTY, json!({ "date": {} })),
            (LOCATION_PROPERTY, json!({ "rich_text": {} })),
            (INSTRUCTOR_PROPERTY, json!({ "rich_text": {} })),
        ] {
            properties.entry(name.to_string()).or_insert(definition);
        }

        let payload = json!({
            "parent": { "type": "page_id", "page_id": parent_page_id },
            "title": [{ "type": "text", "text": { "content": database_name } }],
            "properties": properties
        });
        let url = format!("{}/v1/databases", self.base_url);
        let response = self
            .auth_headers(self.http.post(url), token)
            .json(&payload)
            .send()
            .await?;
        let body = self.ensure_success(response).await?;
        let database_id = body
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::new("Notion API response did not include a database ID."))?
            .to_string();
        let database_url = body
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::new("Notion API response did not include a database URL."))?
            .to_string();

        Ok(CreatedDatabase {
            database_id,
            database_url,
        })
    }

    pub async fn existing_duplicate_keys(
        &self,
        token: &str,
        database_id: &str,
        title_property_name: &str,
        schema: &[DatabasePropertyDefinition],
        fallback_date_property_name: &str,
    ) -> Result<HashSet<String>, AppError> {
        let url = format!("{}/v1/databases/{database_id}/query", self.base_url);
        let start_time_property =
            resolve_property_name(schema, START_TIME_PROPERTY, &["starttime"], "date")
                .unwrap_or_else(|| fallback_date_property_name.to_string());
        let mut cursor: Option<String> = None;
        let mut keys = HashSet::new();

        loop {
            let mut payload = Map::new();
            payload.insert("page_size".to_string(), json!(100));
            if let Some(value) = cursor.as_ref() {
                payload.insert("start_cursor".to_string(), json!(value));
            }
            let response = self
                .auth_headers(self.http.post(&url), token)
                .json(&Value::Object(payload))
                .send()
                .await?;
            let body = self.ensure_success(response).await?;

            for page in body
                .get("results")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(key) =
                    duplicate_key_from_page(page, title_property_name, &start_time_property)
                {
                    keys.insert(key);
                } else if start_time_property != fallback_date_property_name {
                    if let Some(key) = duplicate_key_from_page(
                        page,
                        title_property_name,
                        fallback_date_property_name,
                    ) {
                        keys.insert(key);
                    }
                }
            }

            if !body
                .get("has_more")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                break;
            }
            cursor = body
                .get("next_cursor")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            if cursor.is_none() {
                break;
            }
        }
        Ok(keys)
    }

    pub async fn create_page(
        &self,
        token: &str,
        database_id: &str,
        title_property_name: &str,
        date_property_name: &str,
        _timezone: &str,
        schema: &[DatabasePropertyDefinition],
        occurrence: &LessonOccurrenceInput,
    ) -> Result<(), AppError> {
        let detail_lines = vec![
            format!("Course: {}", occurrence.course_code),
            format!("Day: {} | Week: {}", occurrence.day, occurrence.week_number),
            format!(
                "Time: {} - {}",
                occurrence.start_iso.replace('T', " "),
                occurrence.end_iso.replace('T', " ")
            ),
            format!(
                "Venue: {}",
                occurrence.venue.clone().unwrap_or_else(|| "-".to_string())
            ),
            format!(
                "Instructor: {}",
                occurrence
                    .instructor
                    .clone()
                    .unwrap_or_else(|| "-".to_string())
            ),
            format!("Source: {}", occurrence.source_text),
        ];

        let blocks: Vec<Value> = detail_lines
            .iter()
            .map(|line| {
                json!({
                    "object": "block",
                    "type": "paragraph",
                    "paragraph": { "rich_text": [{ "type": "text", "text": { "content": line } }] }
                })
            })
            .collect();

        let payload = json!({
            "parent": { "database_id": database_id },
            "properties": build_properties_payload(
                title_property_name,
                date_property_name,
                schema,
                occurrence
            ),
            "children": blocks
        });

        let url = format!("{}/v1/pages", self.base_url);
        let response = self
            .auth_headers(self.http.post(url), token)
            .json(&payload)
            .send()
            .await?;
        self.ensure_success(response).await.map_err(|error| {
            AppError::new(format!(
                "Failed to create Notion page for {} with mapped timetable properties: {}",
                occurrence.id, error.message
            ))
        })?;
        Ok(())
    }
}

fn build_properties_payload(
    title_property_name: &str,
    date_property_name: &str,
    schema: &[DatabasePropertyDefinition],
    occurrence: &LessonOccurrenceInput,
) -> Value {
    let mut properties = serde_json::Map::new();
    properties.insert(
        title_property_name.to_string(),
        json!({
            "title": [{ "type": "text", "text": { "content": occurrence.title } }]
        }),
    );

    for property in schema {
        if property.name == title_property_name {
            continue;
        }

        if property.name == date_property_name && property.property_type == "date" {
            let normalized = normalize_property_name(&property.name);
            if matches_alias(&normalized, &["datetime", "date", "classdate", "eventdate"]) {
                properties.insert(
                    property.name.clone(),
                    date_range_value(&occurrence.start_iso, &occurrence.end_iso),
                );
                continue;
            }
        }

        if let Some(value) = map_occurrence_property(property, occurrence) {
            properties.insert(property.name.clone(), value);
        }
    }

    Value::Object(properties)
}

fn map_occurrence_property(
    property: &DatabasePropertyDefinition,
    occurrence: &LessonOccurrenceInput,
) -> Option<Value> {
    let normalized_name = normalize_property_name(&property.name);
    if property.property_type == "date" {
        if matches_alias(
            &normalized_name,
            &["startdate", "datefrom", "classstartdate", "eventstartdate"],
        ) {
            return Some(date_only_value(&occurrence.start_iso));
        }
        if matches_alias(
            &normalized_name,
            &["enddate", "dateto", "classenddate", "eventenddate"],
        ) {
            return Some(date_only_value(&occurrence.end_iso));
        }
        if matches_alias(&normalized_name, &["starttime", "start"]) {
            return Some(date_value(&occurrence.start_iso));
        }
        if matches_alias(&normalized_name, &["endtime", "end"]) {
            return Some(date_value(&occurrence.end_iso));
        }
        if matches_alias(&normalized_name, &["datetime", "classdate", "eventdate"]) {
            return Some(date_range_value(&occurrence.start_iso, &occurrence.end_iso));
        }
    }

    let string_value = if matches_alias(
        &normalized_name,
        &["coursecode", "course", "code", "modulecode", "subjectcode"],
    ) {
        Some(occurrence.course_code.as_str())
    } else if matches_alias(
        &normalized_name,
        &["lessontype", "type", "classtype", "sessiontype"],
    ) {
        occurrence.lesson_type.as_deref()
    } else if matches_alias(&normalized_name, &["day", "weekday"]) {
        Some(occurrence.day.as_str())
    } else if matches_alias(&normalized_name, &["venue", "room", "location"]) {
        occurrence.venue.as_deref()
    } else if matches_alias(
        &normalized_name,
        &[
            "instructor",
            "instructors",
            "teacher",
            "lecturer",
            "tutor",
            "professor",
        ],
    ) {
        occurrence.instructor.as_deref()
    } else if matches_alias(
        &normalized_name,
        &["sourcetext", "source", "rawtext", "notes", "description"],
    ) {
        Some(occurrence.source_text.as_str())
    } else {
        None
    };

    if matches_alias(&normalized_name, &["week", "weeknumber", "wk"]) {
        return match property.property_type.as_str() {
            "number" => Some(json!({ "number": occurrence.week_number })),
            "rich_text" => Some(rich_text_value(&occurrence.week_number.to_string())),
            "select" => Some(json!({ "select": { "name": occurrence.week_number.to_string() } })),
            "multi_select" => {
                Some(json!({ "multi_select": [{ "name": occurrence.week_number.to_string() }] }))
            }
            _ => None,
        };
    }

    let value = string_value?;
    if value.trim().is_empty() {
        return None;
    }

    match property.property_type.as_str() {
        "rich_text" => Some(rich_text_value(value)),
        "select" => Some(json!({ "select": { "name": value } })),
        "multi_select" => Some(json!({ "multi_select": [{ "name": value }] })),
        "url" if value.starts_with("http://") || value.starts_with("https://") => {
            Some(json!({ "url": value }))
        }
        _ => None,
    }
}

fn date_value(start: &str) -> Value {
    json!({ "date": { "start": start } })
}

fn date_only_value(iso: &str) -> Value {
    let date_only = iso.split('T').next().unwrap_or(iso);
    json!({ "date": { "start": date_only } })
}

fn date_range_value(start: &str, end: &str) -> Value {
    json!({ "date": { "start": start, "end": end } })
}

pub fn occurrence_duplicate_key(occurrence: &LessonOccurrenceInput) -> String {
    format!("{}|{}", occurrence.title, occurrence.start_iso)
}

fn duplicate_key_from_page(
    page: &Value,
    title_property_name: &str,
    date_property_name: &str,
) -> Option<String> {
    let properties = page.get("properties")?.as_object()?;
    let title = extract_title(properties.get(title_property_name)?)?;
    let date = extract_date_start(properties.get(date_property_name)?)?;
    Some(format!("{title}|{date}"))
}

fn extract_title(value: &Value) -> Option<String> {
    let text = value
        .get("title")?
        .as_array()?
        .iter()
        .filter_map(|item| item.get("plain_text").and_then(Value::as_str))
        .collect::<String>();
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn extract_date_start(value: &Value) -> Option<String> {
    value
        .get("date")?
        .get("start")?
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}

fn rich_text_value(content: &str) -> Value {
    json!({
      "rich_text": [
        {
          "type": "text",
          "text": { "content": content }
        }
      ]
    })
}

fn normalize_property_name(name: &str) -> String {
    name.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn matches_alias(name: &str, aliases: &[&str]) -> bool {
    aliases.iter().any(|alias| name == *alias)
}

pub fn resolve_property_name(
    schema: &[DatabasePropertyDefinition],
    preferred_name: &str,
    aliases: &[&str],
    property_type: &str,
) -> Option<String> {
    if let Some(found) = schema
        .iter()
        .find(|property| property.name == preferred_name && property.property_type == property_type)
    {
        return Some(found.name.clone());
    }

    schema
        .iter()
        .find(|property| {
            property.property_type == property_type
                && matches_alias(&normalize_property_name(&property.name), aliases)
        })
        .map(|property| property.name.clone())
}
