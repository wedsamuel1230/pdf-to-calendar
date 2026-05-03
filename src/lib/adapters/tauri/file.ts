import { invoke } from '@tauri-apps/api/core';

export interface ProcessFileResult {
	ok: boolean;
	message: string;
	fileName?: string;
	byteLen?: number;
	bytes?: number[];
}

const isBrowser = typeof window !== 'undefined';

declare global {
	interface Window {
		__TAURI_INTERNALS__?: unknown;
	}
}

function isTauriRuntime(): boolean {
	return Boolean(isBrowser && window.__TAURI_INTERNALS__);
}

export function inTauriRuntime(): boolean {
	return isTauriRuntime();
}

export async function validateFileBytes(fileName: string, data: Uint8Array): Promise<ProcessFileResult> {
	if (!isTauriRuntime()) {
		return {
			ok: data.byteLength > 0,
			message: data.byteLength > 0 ? `Loaded ${fileName}.` : 'Empty file.',
			fileName,
			byteLen: data.byteLength
		};
	}

	return invoke<ProcessFileResult>('process_file_bytes', {
		fileName,
		bytes: Array.from(data)
	});
}

export async function readFilePath(path: string): Promise<ProcessFileResult> {
	if (!isTauriRuntime()) {
		return {
			ok: false,
			message: 'Native file-path reads are only available in Tauri runtime.'
		};
	}

	return invoke<ProcessFileResult>('process_file_path', { path });
}
