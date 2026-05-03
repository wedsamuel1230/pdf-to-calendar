use std::{fs, path::Path};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessFileResult {
    ok: bool,
    message: String,
    file_name: Option<String>,
    byte_len: Option<usize>,
    bytes: Option<Vec<u8>>,
}

#[tauri::command]
pub fn process_file_bytes(file_name: String, bytes: Vec<u8>) -> ProcessFileResult {
    if bytes.is_empty() {
        return ProcessFileResult {
            ok: false,
            message: "Empty file.".to_string(),
            file_name: Some(file_name),
            byte_len: Some(0),
            bytes: None,
        };
    }

    ProcessFileResult {
        ok: true,
        message: format!("Received file bytes: {file_name}"),
        file_name: Some(file_name),
        byte_len: Some(bytes.len()),
        bytes: None,
    }
}

#[tauri::command]
pub fn process_file_path(path: String) -> ProcessFileResult {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return ProcessFileResult {
            ok: false,
            message: "File path is empty.".to_string(),
            file_name: None,
            byte_len: None,
            bytes: None,
        };
    }

    let ext = Path::new(trimmed)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ext != "pdf" {
        return ProcessFileResult {
            ok: false,
            message: "Only PDF files are supported.".to_string(),
            file_name: Path::new(trimmed)
                .file_name()
                .and_then(|value| value.to_str())
                .map(ToString::to_string),
            byte_len: None,
            bytes: None,
        };
    }

    let file_name = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToString::to_string);
    let bytes = match fs::read(trimmed) {
        Ok(data) => data,
        Err(error) => {
            return ProcessFileResult {
                ok: false,
                message: format!("Failed to read file path: {error}"),
                file_name,
                byte_len: None,
                bytes: None,
            };
        }
    };

    if bytes.is_empty() {
        return ProcessFileResult {
            ok: false,
            message: "Empty file.".to_string(),
            file_name,
            byte_len: Some(0),
            bytes: None,
        };
    }

    ProcessFileResult {
        ok: true,
        message: "Read file from native path.".to_string(),
        file_name,
        byte_len: Some(bytes.len()),
        bytes: Some(bytes),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{process_file_bytes, process_file_path};

    #[test]
    fn rejects_empty_file_bytes() {
        let result = process_file_bytes("empty.pdf".to_string(), vec![]);
        assert!(!result.ok);
        assert_eq!(result.file_name.as_deref(), Some("empty.pdf"));
        assert_eq!(result.byte_len, Some(0));
    }

    #[test]
    fn accepts_non_empty_file_bytes() {
        let result = process_file_bytes("sample.pdf".to_string(), vec![1, 2, 3]);
        assert!(result.ok);
        assert_eq!(result.file_name.as_deref(), Some("sample.pdf"));
        assert_eq!(result.byte_len, Some(3));
    }

    #[test]
    fn rejects_non_pdf_path() {
        let result = process_file_path("/tmp/file.txt".to_string());
        assert!(!result.ok);
        assert_eq!(result.message, "Only PDF files are supported.");
    }

    #[test]
    fn accepts_valid_pdf_path() {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join("tauri_file_path_test.pdf");
        fs::write(&path, [1_u8, 2, 3, 4]).expect("should write temp pdf");
        let result = process_file_path(path.to_string_lossy().to_string());
        assert!(result.ok);
        assert_eq!(result.byte_len, Some(4));
        assert_eq!(result.bytes.as_ref().map(std::vec::Vec::len), Some(4));
        let _ = fs::remove_file(path);
    }
}
