import { invoke } from '@tauri-apps/api/core';
import type { ParsedLesson } from '$lib/types/timetable';

const isBrowser = typeof window !== 'undefined';

declare global {
	interface Window {
		__TAURI_INTERNALS__?: unknown;
	}
}

function isTauriRuntime(): boolean {
	return Boolean(isBrowser && window.__TAURI_INTERNALS__);
}

const FALLBACK_MODELS = [
	'meta/llama-3.1-70b-instruct',
	'mistralai/mixtral-8x7b-instruct-v0.1',
	'meta/llama-3.1-8b-instruct',
	'google/gemma-2-9b-it'
] as const;

export interface NvidiaModelStatus {
	hasApiKey: boolean;
	sourceEnvVar?: string;
	models: string[];
	usedFallback: boolean;
	apiError?: string;
}

export async function listNvidiaModels(): Promise<string[]> {
	if (!isTauriRuntime()) {
		return [...FALLBACK_MODELS];
	}
	return invoke<string[]>('list_nvidia_models');
}

export async function getNvidiaModelStatus(): Promise<NvidiaModelStatus> {
	if (!isTauriRuntime()) {
		return {
			hasApiKey: false,
			models: [...FALLBACK_MODELS],
			usedFallback: true,
			apiError: 'Browser mode: NVIDIA model API is only available in Tauri runtime.'
		};
	}
	return invoke<NvidiaModelStatus>('get_nvidia_model_status');
}

export async function repairLessonsWithLlm(
	lessons: ParsedLesson[],
	model?: string
): Promise<ParsedLesson[]> {
	if (!isTauriRuntime() || lessons.length === 0) {
		return lessons;
	}
	return invoke<ParsedLesson[]>('repair_lessons_with_llm', { input: { lessons, model } });
}

export async function extractLessonsWithLlm(
	candidates: ParsedLesson[],
	model?: string
): Promise<ParsedLesson[]> {
	if (!isTauriRuntime() || candidates.length === 0) {
		return [];
	}
	return invoke<ParsedLesson[]>('extract_lessons_with_llm', {
		input: { lessons: candidates, model, mode: 'extract' }
	});
}
