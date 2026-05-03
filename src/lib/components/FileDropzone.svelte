<script lang="ts">
	import { onMount } from 'svelte';
	import { FileUp } from 'lucide-svelte';

	interface Props {
		selectedName?: string;
		busy?: boolean;
		onFileSelected: (file: File) => void;
		onFilePathSelected?: (path: string) => void | Promise<void>;
	}

	let { selectedName = '', busy = false, onFileSelected, onFilePathSelected }: Props = $props();
	let inputEl: HTMLInputElement | null = null;
	let isDragging = $state(false);
	let dragDepth = 0;
	let useNativeDrop = false;
	const debugDrag = typeof window !== 'undefined' && window.localStorage.getItem('drag-debug') === '1';

	function logDrag(source: 'dom' | 'tauri-native', message: string, details = ''): void {
		if (!debugDrag) {
			return;
		}
		console.info(`[dropzone][${source}] ${message} depth=${dragDepth}${details ? ` ${details}` : ''}`);
	}

	function logDomDrag(message: string, event?: DragEvent): void {
		const files = event?.dataTransfer?.files?.length ?? 0;
		const types = event?.dataTransfer?.types ? Array.from(event.dataTransfer.types).join(',') : '';
		logDrag('dom', message, `files=${files} types=${types}`);
	}

	function handleFiles(fileList: FileList | null): void {
		if (!fileList || fileList.length === 0) {
			return;
		}
		const file = fileList[0];
		onFileSelected(file);
	}

	function resetDragState(): void {
		dragDepth = 0;
		isDragging = false;
	}

	function isFileDrag(event: DragEvent): boolean {
		const types = event.dataTransfer?.types;
		return Boolean(types && Array.from(types).includes('Files'));
	}

	function handleDragEnter(event: DragEvent): void {
		if (useNativeDrop || busy || !isFileDrag(event)) {
			return;
		}
		event.preventDefault();
		dragDepth += 1;
		isDragging = true;
		logDomDrag('dragenter', event);
	}

	function handleDragOver(event: DragEvent): void {
		if (useNativeDrop || busy || !isFileDrag(event)) {
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		isDragging = true;
		logDomDrag('dragover', event);
	}

	function handleDragLeave(event: DragEvent): void {
		if (useNativeDrop || busy || !isFileDrag(event)) {
			return;
		}
		event.preventDefault();
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) {
			isDragging = false;
		}
		logDomDrag('dragleave', event);
	}

	function handleDrop(event: DragEvent): void {
		if (useNativeDrop || busy || !isFileDrag(event)) {
			return;
		}
		event.preventDefault();
		resetDragState();
		logDomDrag('drop', event);
		handleFiles(event.dataTransfer?.files ?? null);
	}

	function openPicker(): void {
		if (!busy) {
			inputEl?.click();
		}
	}

	onMount(() => {
		let unlistenNativeDrop: (() => void) | null = null;
		let disposed = false;

		(async () => {
			const hasTauriRuntime = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
			if (!hasTauriRuntime) {
				return;
			}

			try {
				const { getCurrentWebview } = await import('@tauri-apps/api/webview');
				const webview = getCurrentWebview();
				useNativeDrop = true;
				unlistenNativeDrop = await webview.onDragDropEvent((event) => {
					if (busy) {
						return;
					}

					const payload = event.payload;
					if (payload.type === 'enter') {
						dragDepth += 1;
						isDragging = true;
						logDrag(
							'tauri-native',
							'drag-enter',
							`paths=${payload.paths.length} x=${payload.position.x} y=${payload.position.y}`
						);
						return;
					}

					if (payload.type === 'over') {
						isDragging = true;
						logDrag('tauri-native', 'drag-over', `x=${payload.position.x} y=${payload.position.y}`);
						return;
					}

					if (payload.type === 'leave') {
						resetDragState();
						logDrag('tauri-native', 'drag-leave');
						return;
					}

					resetDragState();
					logDrag('tauri-native', 'drag-drop', `paths=${payload.paths.length}`);
					const path = payload.paths[0];
					if (path && onFilePathSelected) {
						void Promise.resolve(onFilePathSelected(path));
					}
				});
			} catch (error) {
				useNativeDrop = false;
				if (debugDrag && !disposed) {
					console.warn('[dropzone][tauri-native] failed to subscribe native drag events', error);
				}
			}
		})();

		const preventWindowDrop = (event: DragEvent) => {
			if (!useNativeDrop && isFileDrag(event)) {
				event.preventDefault();
				logDomDrag('window-prevent', event);
			}
		};

		window.addEventListener('dragover', preventWindowDrop);
		window.addEventListener('drop', preventWindowDrop);

		return () => {
			disposed = true;
			resetDragState();
			unlistenNativeDrop?.();
			window.removeEventListener('dragover', preventWindowDrop);
			window.removeEventListener('drop', preventWindowDrop);
		};
	});
</script>

<section class="panel dropzone">
	<input
		bind:this={inputEl}
		class="hidden-input"
		type="file"
		accept=".pdf,application/pdf"
		onchange={(event) => handleFiles((event.currentTarget as HTMLInputElement).files)}
	/>
	<div
		role="button"
		tabindex={busy ? -1 : 0}
		aria-disabled={busy}
		class={`dropzone-hit ${isDragging ? 'dragging' : ''}`}
		ondragenter={handleDragEnter}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		onclick={openPicker}
		onkeydown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				openPicker();
			}
		}}
	>
		<span class="icon-wrap" aria-hidden="true">
			<FileUp size={20} />
		</span>
		<span class="label">Drop Timetable PDF Here</span>
		<span class="text-muted">or choose file</span>
	</div>
	<div class="current-file text-muted">
		{#if selectedName}
			Loaded: <strong>{selectedName}</strong>
		{:else}
			No file selected
		{/if}
	</div>
</section>

<style>
	.dropzone {
		padding: 16px;
		display: grid;
		gap: 12px;
	}

	.hidden-input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 1px;
		height: 1px;
	}

	.dropzone-hit {
		width: 100%;
		min-height: 164px;
		border-radius: 8px;
		border: 1px dashed rgba(193, 193, 193, 0.48);
		background:
			linear-gradient(180deg, rgba(231, 197, 154, 0.06) 0%, rgba(16, 16, 16, 0.76) 100%),
			rgba(8, 8, 8, 0.82);
		color: var(--color-polar-white);
		display: grid;
		place-items: center;
		gap: 8px;
		padding: 16px;
	}

	.dropzone-hit.dragging {
		border-color: var(--color-amber-glow);
		background:
			linear-gradient(180deg, rgba(231, 197, 154, 0.13) 0%, rgba(16, 16, 16, 0.86) 100%),
			rgba(8, 8, 8, 0.92);
	}

	.icon-wrap {
		width: 40px;
		height: 40px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1px solid rgba(231, 197, 154, 0.5);
	}

	.label {
		font-size: 18px;
		line-height: 1.28;
	}

	.current-file {
		font-family: var(--font-mono);
		font-size: 13px;
	}

	strong {
		color: var(--color-polar-white);
	}
</style>
