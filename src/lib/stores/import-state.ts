import { writable } from 'svelte/store';

export type AppStep = 'idle' | 'parsing' | 'review' | 'importing';

export const appStep = writable<AppStep>('idle');
export const appMessage = writable<string>('');
