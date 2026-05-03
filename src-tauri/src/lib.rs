mod commands;
mod domain;
mod infrastructure;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::file_commands::process_file_bytes,
            commands::file_commands::process_file_path,
            commands::notion_commands::load_notion_config,
            commands::notion_commands::save_notion_config,
            commands::notion_commands::test_notion_connection,
            commands::notion_commands::create_notion_calendar_database,
            commands::notion_commands::import_lessons,
            commands::parser_commands::list_nvidia_models,
            commands::parser_commands::get_nvidia_model_status,
            commands::parser_commands::repair_lessons_with_llm
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
