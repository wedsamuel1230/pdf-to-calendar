<script lang="ts">
	import { onMount } from 'svelte';
	import { CalendarSync, Loader2, Settings2 } from 'lucide-svelte';
	import FileDropzone from '$lib/components/FileDropzone.svelte';
	import LessonTable from '$lib/components/LessonTable.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import {
		createNotionCalendarDatabase,
		importLessons,
		loadNotionConfig,
		saveNotionConfig,
		testNotionConnection
	} from '$lib/adapters/tauri/notion';
	import { inTauriRuntime, readFilePath, validateFileBytes } from '$lib/adapters/tauri/file';
	import {
		ensurePdfFile,
		ensureStartDate,
		lessonOccurrenceSchema,
		notionConfigSchema,
		notionDatabaseSetupSchema
	} from '$lib/services/schemas';
	import {
		parseTimetablePdfBytes,
		rebuildPreviewFromLessons
	} from '$lib/services/timetable-parser';
	import {
		getNvidiaModelStatus,
		listNvidiaModels,
		repairLessonsWithLlm
	} from '$lib/adapters/tauri/parser-repair';
	import { appMessage, appStep } from '$lib/stores/import-state';
	import type { NotionConfigInput, NotionTokenSource } from '$lib/types/notion';
	import type { ImportPreview, ImportResult, LessonOccurrence, ParsedLesson } from '$lib/types/timetable';

	let selectedFile = $state<File | null>(null);
	let selectedNativePath = $state('');
	let startWeekDate = $state('');
	let showSettings = $state(true);
	let preview = $state<ImportPreview | null>(null);
	let reviewOccurrences = $state<LessonOccurrence[]>([]);
	let parseSummary = $state('');
	let errorText = $state('');
	let settingsStatus = $state('');
	let importResult = $state<ImportResult | null>(null);
	let busy = $state(false);
	let importProgress = $state(0);
	let tokenSource = $state<NotionTokenSource>('none');
	let llmRepairEnabled = $state(false);
	let nvidiaModels = $state<string[]>([]);
	let selectedNvidiaModel = $state('');
	let nvidiaModelOverride = $state('');
	let nvidiaStatus = $state('');

	let notionForm = $state<NotionConfigInput>({
		databaseIdOrUrl: '',
		datePropertyName: 'Start Time',
		titlePropertyName: 'Class/Event',
		timezone: 'Asia/Hong_Kong'
	});
	let parentPageIdOrUrl = $state('');
	let databaseName = $state('Timetable Calendar');

	onMount(async () => {
		const config = await loadNotionConfig();
		notionForm = {
			databaseIdOrUrl: config.databaseIdOrUrl,
			datePropertyName: config.datePropertyName,
			titlePropertyName: config.titlePropertyName,
			timezone: config.timezone
		};
		tokenSource = config.tokenSource;
		settingsStatus = tokenSourceStatus(config.tokenSource);
		await refreshNvidiaModels();
	});

	async function refreshNvidiaModels(): Promise<void> {
		const status = await getNvidiaModelStatus();
		nvidiaModels = status.models;
		if (!selectedNvidiaModel && nvidiaModels.length > 0) {
			selectedNvidiaModel = nvidiaModels[0];
		}
		const source = status.sourceEnvVar ? ` (${status.sourceEnvVar})` : '';
		nvidiaStatus = status.apiError
			? status.apiError
			: status.usedFallback
				? `Using fallback model list${source}.`
				: `Loaded models from NVIDIA API${source}.`;
	}

	function tokenSourceStatus(source: NotionTokenSource): string {
		if (source === 'environment') {
			return 'Using NOTION_TOKEN from the environment.';
		}
		if (source === 'keychain') {
			return 'Using a saved keychain token.';
		}
		return 'No token configured. Set NOTION_TOKEN or save a token in app settings first.';
	}

	function resetTransientMessages(): void {
		errorText = '';
		settingsStatus = '';
		appMessage.set('');
		importResult = null;
	}

	function onFileSelected(file: File): void {
		selectedFile = file;
		selectedNativePath = '';
		resetTransientMessages();
	}

	function onFilePathSelected(path: string): void {
		selectedNativePath = path;
		selectedFile = null;
		resetTransientMessages();
	}

	function selectedFileName(): string {
		if (selectedFile) {
			return selectedFile.name;
		}
		if (!selectedNativePath) {
			return '';
		}
		const tokens = selectedNativePath.split(/[\\/]/);
		return tokens[tokens.length - 1] ?? selectedNativePath;
	}

	function getDuplicateKeys(occurrences: LessonOccurrence[]): Set<string> {
		const count = new Map<string, number>();
		for (const item of occurrences) {
			const key = `${item.title}|${item.startIso}|${item.endIso}`;
			count.set(key, (count.get(key) ?? 0) + 1);
		}
		return new Set([...count.entries()].filter(([, value]) => value > 1).map(([key]) => key));
	}

	let duplicateKeys = $derived(getDuplicateKeys(reviewOccurrences));

	async function handleParse(): Promise<void> {
		resetTransientMessages();
		importProgress = 0;
		try {
			const weekDate = ensureStartDate(startWeekDate);
			busy = true;
			appStep.set('parsing');
			appMessage.set('Parsing timetable...');
			let data: Uint8Array;
			if (selectedNativePath && inTauriRuntime()) {
				const result = await readFilePath(selectedNativePath);
				if (!result.ok) {
					throw new Error(result.message);
				}
				if (!result.bytes || result.bytes.length === 0) {
					throw new Error('Native drop read succeeded but no file bytes were returned.');
				}
				data = new Uint8Array(result.bytes);
			} else {
				const file = ensurePdfFile(selectedFile);
				data = new Uint8Array(await file.arrayBuffer());
				const validation = await validateFileBytes(file.name, data);
				if (!validation.ok) {
					throw new Error(validation.message);
				}
			}
			preview = await parseTimetablePdfBytes(data, weekDate);
			if (llmRepairEnabled) {
				const lowConfidence = preview.lessons.filter((item) => (item.confidence ?? 1) < 0.7);
				if (lowConfidence.length > 0) {
					const model = nvidiaModelOverride.trim() || selectedNvidiaModel || undefined;
					const repaired = await repairLessonsWithLlm(lowConfidence, model);
					const merged = mergeRepairedLessons(preview.lessons, repaired);
					preview = rebuildPreviewFromLessons(merged, weekDate);
				}
			}
			reviewOccurrences = [...preview.occurrences];
			const lowConfidenceCount = preview.lessons.filter((item) => (item.confidence ?? 1) < 0.7).length;
			parseSummary = `Parsed ${preview.lessons.length} lessons and ${preview.occurrences.length} event occurrences (Wk:${preview.minWeek}-${preview.maxWeek}). ${lowConfidenceCount} low-confidence lessons.`;
			appStep.set('review');
			appMessage.set('Ready for review.');
		} catch (error) {
			errorText = error instanceof Error ? error.message : 'Failed to parse timetable.';
			appStep.set('idle');
		} finally {
			busy = false;
		}
	}

	function updateOccurrence(id: string, patch: Partial<LessonOccurrence>): void {
		reviewOccurrences = reviewOccurrences.map((item) =>
			item.id === id ? { ...item, ...patch } : item
		);
	}

	function removeOccurrence(id: string): void {
		reviewOccurrences = reviewOccurrences.filter((item) => item.id !== id);
	}

	async function handleSaveSettings(): Promise<void> {
		try {
			const parsed = notionConfigSchema.parse(notionForm);
			const saved = await saveNotionConfig(parsed);
			tokenSource = saved.tokenSource;
			settingsStatus = `Settings saved. ${tokenSourceStatus(saved.tokenSource)}`;
		} catch (error) {
			settingsStatus = error instanceof Error ? error.message : 'Unable to save settings.';
		}
	}

	async function handleTestConnection(): Promise<void> {
		try {
			const parsed = notionConfigSchema.parse(notionForm);
			const response = await testNotionConnection(parsed);
			settingsStatus = response.message;
		} catch (error) {
			settingsStatus = error instanceof Error ? error.message : 'Unable to test connection.';
		}
	}

	async function handleCreateDatabase(): Promise<void> {
		try {
			const parsed = notionDatabaseSetupSchema.parse({
				parentPageIdOrUrl,
				databaseName,
				datePropertyName: notionForm.datePropertyName,
				titlePropertyName: notionForm.titlePropertyName,
				timezone: notionForm.timezone
			});
			const created = await createNotionCalendarDatabase(parsed);
			notionForm = {
				...notionForm,
				databaseIdOrUrl: created.databaseUrl,
				datePropertyName: created.datePropertyName,
				titlePropertyName: created.titlePropertyName,
				timezone: created.timezone
			};
			settingsStatus = created.message;
		} catch (error) {
			settingsStatus = error instanceof Error ? error.message : 'Unable to create database.';
		}
	}

	async function handleImport(): Promise<void> {
		resetTransientMessages();
		try {
			if (reviewOccurrences.length === 0) {
				throw new Error('No occurrences to import.');
			}
			const parsedConfig = notionConfigSchema.parse(notionForm);
			await saveNotionConfig(parsedConfig);
			for (const occurrence of reviewOccurrences) {
				lessonOccurrenceSchema.parse(occurrence);
			}
			busy = true;
			importProgress = 12;
			appStep.set('importing');
			appMessage.set(`Importing lessons... this can take a moment for ${reviewOccurrences.length} events...`);
			importResult = await importLessons(reviewOccurrences);
			importProgress = 100;
			appMessage.set(`Imported ${importResult.imported}/${importResult.total} occurrences.`);
			appStep.set('review');
		} catch (error) {
			importProgress = 0;
			errorText = error instanceof Error ? error.message : 'Import failed.';
			appStep.set('review');
		} finally {
			busy = false;
		}
	}

	function mergeRepairedLessons(original: ParsedLesson[], repaired: ParsedLesson[]): ParsedLesson[] {
		const byId = new Map(repaired.map((item) => [item.id, item]));
		return original.map((item) => byId.get(item.id) ?? item);
	}
</script>

<main class="shell">
	<header class="hero panel">
		<div>
			<h1>Timetable PDF to Notion Calendar</h1>
			<p class="text-muted">
				Drop the semester timetable, map the first week date, review extracted lessons, then import.
			</p>
		</div>
		<div class="hero-actions">
			<button
				class="btn"
				type="button"
				onclick={() => {
					showSettings = !showSettings;
				}}
			>
				<Settings2 size={16} />
				{showSettings ? 'Hide' : 'Show'} Settings
			</button>
		</div>
	</header>

	{#if showSettings}
		<SettingsPanel
			form={notionForm}
			tokenSource={tokenSource}
			parentPageIdOrUrl={parentPageIdOrUrl}
			databaseName={databaseName}
			busy={busy}
			status={settingsStatus}
			onFormChange={(next) => {
				notionForm = next;
			}}
			onParentPageChange={(value) => {
				parentPageIdOrUrl = value;
			}}
			onDatabaseNameChange={(value) => {
				databaseName = value;
			}}
			onSave={handleSaveSettings}
			onTest={handleTestConnection}
			onCreateDatabase={handleCreateDatabase}
		/>
	{/if}

	<section class="row-main">
		<FileDropzone
			selectedName={selectedFileName()}
			busy={busy}
			onFileSelected={onFileSelected}
			onFilePathSelected={onFilePathSelected}
		/>
		<section class="panel controls">
			<h2 class="panel-title">Parse Controls</h2>
			<label>
				<span class="text-muted">Starting Monday Date for Lowest Wk Label</span>
				<input class="control" type="date" bind:value={startWeekDate} />
			</label>
			<label class="toggle-row">
				<input type="checkbox" bind:checked={llmRepairEnabled} />
				<span class="text-muted">Enable LLM repair for low-confidence lessons</span>
			</label>
			{#if llmRepairEnabled}
				<label>
					<span class="text-muted">NVIDIA Model</span>
					<select class="control" bind:value={selectedNvidiaModel}>
						{#each nvidiaModels as model}
							<option value={model}>{model}</option>
						{/each}
					</select>
				</label>
				<label>
					<span class="text-muted">Model Override (optional)</span>
					<input class="control" type="text" bind:value={nvidiaModelOverride} placeholder="meta/llama-3.1-70b-instruct" />
				</label>
				<div class="nvidia-row">
					<button class="btn" type="button" onclick={refreshNvidiaModels} disabled={busy}>
						Refresh models
					</button>
					<span class="text-muted">{nvidiaStatus}</span>
				</div>
			{/if}
			<button class="btn btn-primary" type="button" onclick={handleParse} disabled={busy}>
				{#if busy && $appStep === 'parsing'}
					<span class="spin"><Loader2 size={16} /></span>
				{/if}
				Parse Timetable
			</button>
			{#if parseSummary}
				<p class="status status-success">{parseSummary}</p>
			{/if}
			{#if $appMessage}
				<p class="status">{ $appMessage }</p>
			{/if}
			{#if errorText}
				<p class="status status-error">{errorText}</p>
			{/if}
		</section>
	</section>

	{#if preview}
		<section class="panel import-actions">
			<div class="left">
				<h2 class="panel-title">Import</h2>
				<p class="text-muted">
					Review rows below. Duplicates are flagged when title and start/end datetime match.
				</p>
			</div>
			<button class="btn btn-primary" type="button" onclick={handleImport} disabled={busy}>
				{#if busy && $appStep === 'importing'}
					<span class="spin"><Loader2 size={16} /></span>
				{:else}
					<CalendarSync size={16} />
				{/if}
				Import to Notion
			</button>
			{#if busy && $appStep === 'importing'}
				<div class="import-progress" aria-label="Import progress">
					<div class="import-progress-bar" style={`width: ${importProgress}%`}></div>
				</div>
			{/if}
		</section>

		<LessonTable
			occurrences={reviewOccurrences}
			duplicateKeys={duplicateKeys}
			onUpdate={updateOccurrence}
			onRemove={removeOccurrence}
		/>

		{#if importResult}
			<section class="panel result">
				<div class="stats">
					<span class="chip">{importResult.imported} imported</span>
					<span class="chip">{importResult.duplicates} duplicates</span>
					<span class="chip">{importResult.failed} failed</span>
				</div>
				{#if importResult.errors.length > 0}
					<ul class="errors">
						{#each importResult.errors as line}
							<li>{line}</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	.hero {
		padding: 18px;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	h1 {
		margin: 0;
		font-size: clamp(24px, 2.8vw, 34px);
		line-height: 1.07;
	}

	.hero p {
		margin: 8px 0 0;
		max-width: 720px;
	}

	.row-main {
		margin-top: 16px;
		display: grid;
		grid-template-columns: 1.15fr 1fr;
		gap: 16px;
	}

	.controls {
		padding: 16px;
		display: grid;
		gap: 12px;
	}

	.controls label {
		display: grid;
		gap: 6px;
	}

	.controls .toggle-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.nvidia-row {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}

	.import-actions {
		margin-top: 16px;
		padding: 16px;
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 14px;
	}

	.import-progress {
		grid-column: 1 / -1;
		height: 6px;
		border-radius: 999px;
		background: rgba(193, 193, 193, 0.16);
		overflow: hidden;
	}

	.import-progress-bar {
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--color-amber-glow), var(--color-neon-green));
		transition: width 240ms ease;
	}

	.import-actions p {
		margin: 6px 0 0;
	}

	.result {
		margin-top: 16px;
		padding: 16px;
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.errors {
		margin: 12px 0 0;
		padding-left: 18px;
		color: #ffb4b4;
	}

	.spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 960px) {
		.row-main {
			grid-template-columns: 1fr;
		}

		.import-actions,
		.hero {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
