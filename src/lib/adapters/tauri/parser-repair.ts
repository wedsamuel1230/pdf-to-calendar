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

export interface LlmInvokeOptions {
	timeoutMs?: number;
}

function withTimeout<T>(task: Promise<T>, timeoutMs = 8000): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return task;
	}

	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(`NVIDIA LLM request timed out after ${timeoutMs}ms.`));
		}, timeoutMs);
	});

	return Promise.race([task, timeout]).finally(() => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	});
}

function invokeLlm(
	command: string,
	lessons: ParsedLesson[],
	model: string | undefined,
	mode: string | undefined,
	options?: LlmInvokeOptions
): Promise<ParsedLesson[]> {
	const task = invoke<ParsedLesson[]>(command, {
		input: { lessons, model, mode }
	});
	return withTimeout(task, options?.timeoutMs ?? 8000);
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
	model?: string,
	options?: LlmInvokeOptions
): Promise<ParsedLesson[]> {
	if (!isTauriRuntime() || lessons.length === 0) {
		return lessons;
	}
	return invokeLlm('repair_lessons_with_llm', lessons, model, undefined, options);
}

export async function extractLessonsWithLlm(
	candidates: ParsedLesson[],
	model?: string,
	options?: LlmInvokeOptions
): Promise<ParsedLesson[]> {
	if (!isTauriRuntime() || candidates.length === 0) {
		return [];
	}
	return invokeLlm('extract_lessons_with_llm', candidates, model, 'extract', options);
}

export async function refineLessonsWithLlm(
	candidates: ParsedLesson[],
	model?: string,
	options?: LlmInvokeOptions
): Promise<ParsedLesson[]> {
	if (!isTauriRuntime() || candidates.length === 0) {
		return [];
	}
	return invokeLlm('repair_lessons_with_llm', candidates, model, 'refine', options);
}

export const __testables = {
	withTimeout
};
