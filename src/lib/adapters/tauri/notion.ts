import { invoke } from '@tauri-apps/api/core';
import type {
	NotionConfig,
	NotionConfigInput,
	NotionDatabaseSetupInput,
	NotionDatabaseSetupResult
} from '$lib/types/notion';
import type { ImportResult, LessonOccurrence } from '$lib/types/timetable';

const LOCAL_CONFIG_KEY = 'pdf-to-calendar:notion-config';
const DEFAULT_DATABASE_ID_OR_URL =
	'https://www.notion.so/bottlesumo/355a0ed49a7c802b909dc6c07271519f?v=355a0ed49a7c807e9c33000c33d47fb4';
const isBrowser = typeof window !== 'undefined';

declare global {
	interface Window {
		__TAURI_INTERNALS__?: unknown;
	}
}

function isTauriRuntime(): boolean {
	return Boolean(isBrowser && window.__TAURI_INTERNALS__);
}

function loadLocalConfig(): NotionConfig {
	if (!isBrowser) {
		return {
			databaseIdOrUrl: DEFAULT_DATABASE_ID_OR_URL,
			datePropertyName: 'Start Time',
			titlePropertyName: 'Class/Event',
			timezone: 'Asia/Hong_Kong',
			hasToken: false,
			tokenSource: 'none'
		};
	}
	const raw = window.localStorage.getItem(LOCAL_CONFIG_KEY);
	if (!raw) {
		return {
			databaseIdOrUrl: DEFAULT_DATABASE_ID_OR_URL,
			datePropertyName: 'Start Time',
			titlePropertyName: 'Class/Event',
			timezone: 'Asia/Hong_Kong',
			hasToken: false,
			tokenSource: 'none'
		};
	}

	try {
		const parsed = JSON.parse(raw) as NotionConfig;
		return {
			...parsed,
			titlePropertyName: parsed.titlePropertyName === 'Name' ? 'Class/Event' : parsed.titlePropertyName,
			datePropertyName: parsed.datePropertyName === 'Date' ? 'Start Time' : parsed.datePropertyName,
			tokenSource: parsed.tokenSource ?? 'none'
		};
	} catch {
		return {
			databaseIdOrUrl: DEFAULT_DATABASE_ID_OR_URL,
			datePropertyName: 'Start Time',
			titlePropertyName: 'Class/Event',
			timezone: 'Asia/Hong_Kong',
			hasToken: false,
			tokenSource: 'none'
		};
	}
}

function saveLocalConfig(value: NotionConfigInput): NotionConfig {
	const config: NotionConfig = {
		databaseIdOrUrl: value.databaseIdOrUrl,
		datePropertyName: value.datePropertyName,
		titlePropertyName: value.titlePropertyName,
		timezone: value.timezone,
		hasToken: Boolean(value.token),
		tokenSource: value.token ? 'keychain' : 'none'
	};
	if (isBrowser) {
		window.localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
	}
	return config;
}

export async function loadNotionConfig(): Promise<NotionConfig> {
	if (!isTauriRuntime()) {
		return loadLocalConfig();
	}
	return invoke<NotionConfig>('load_notion_config');
}

export async function saveNotionConfig(config: NotionConfigInput): Promise<NotionConfig> {
	if (!isTauriRuntime()) {
		return saveLocalConfig(config);
	}
	return invoke<NotionConfig>('save_notion_config', { config });
}

export async function testNotionConnection(config: NotionConfigInput): Promise<{ ok: boolean; message: string }> {
	if (!isTauriRuntime()) {
		return {
			ok: true,
			message: 'Running in browser preview mode. Connection checks are available in Tauri runtime.'
		};
	}
	return invoke<{ ok: boolean; message: string }>('test_notion_connection', { config });
}

export async function createNotionCalendarDatabase(
	input: NotionDatabaseSetupInput
): Promise<NotionDatabaseSetupResult> {
	if (!isTauriRuntime()) {
		return {
			ok: false,
			message: 'Running in browser preview mode. Database creation is available in Tauri runtime.',
			databaseId: '',
			databaseUrl: '',
			datePropertyName: input.datePropertyName,
			titlePropertyName: input.titlePropertyName,
			timezone: input.timezone
		};
	}
	return invoke<NotionDatabaseSetupResult>('create_notion_calendar_database', { input });
}

export async function importLessons(occurrences: LessonOccurrence[]): Promise<ImportResult> {
	if (!isTauriRuntime()) {
		return {
			total: occurrences.length,
			imported: occurrences.length,
			duplicates: 0,
			failed: 0,
			errors: ['Browser preview mode: no write was sent to Notion.']
		};
	}
	return invoke<ImportResult>('import_lessons', { occurrences });
}
