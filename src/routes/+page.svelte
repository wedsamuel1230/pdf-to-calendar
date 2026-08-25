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
	applyCourseNameMapping,
	applyDefaultCourseNameMappings
} from '$lib/services/course-name-mapping';
	import {
		getNvidiaModelStatus,
		refineLessonsWithLlm
	} from '$lib/adapters/tauri/parser-repair';
	import { appMessage, appStep } from '$lib/stores/import-state';
	import type { NotionConfigInput, NotionTokenSource } from '$lib/types/notion';
	import type {
		ImportPreview,
		ImportResult,
		LessonOccurrence,
		ParseIssue,
		ParsedLesson,
		RefinementStatus,
		UnparsedLessonCandidate
	} from '$lib/types/timetable';

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
	let tokenEnvVarName = $state<string | undefined>(undefined);
	let llmRepairEnabled = $state(false);
	let nvidiaModels = $state<string[]>([]);
	let selectedNvidiaModel = $state('');
	let nvidiaModelOverride = $state('');
	let nvidiaStatus = $state('');
	let nvidiaHasApiKey = $state(false);
	let courseCodeInput = $state('');
	let fullCourseNameInput = $state('');
	let activeParseRunId = '';

	const LOW_CONFIDENCE_THRESHOLD = 0.7;
	const LLM_TIMEOUT_MS = 8000;

	let notionForm = $state<NotionConfigInput>({
		databaseIdOrUrl: '',
		datePropertyName: 'Time',
		titlePropertyName: 'Class/Event',
		timezone: 'Asia/Hong_Kong'
	});
	let parentPageIdOrUrl = $state('');
	let databaseName = $state('Timetable Calendar');

	onMount(async () => {
		const config = await loadNotionConfig();
		notionForm = {
			databaseIdOrUrl: config.databaseIdOrUrl,
			datePropertyName: 'Time',
			titlePropertyName: 'Class/Event',
			timezone: config.timezone
		};
		tokenSource = config.tokenSource;
		tokenEnvVarName = config.tokenEnvVarName;
		settingsStatus = tokenSourceStatus(config.tokenSource, config.tokenEnvVarName);
		await refreshNvidiaModels();
	});

	async function refreshNvidiaModels(): Promise<void> {
		const status = await getNvidiaModelStatus();
		nvidiaHasApiKey = status.hasApiKey;
		nvidiaModels = status.models.length > 0 ? status.models : ['meta/llama-3.1-70b-instruct'];
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

	function tokenSourceStatus(source: NotionTokenSource, envVarName?: string): string {
		if (source === 'environment') {
			return `Using environment token${envVarName ? ` (${envVarName})` : ''}.`;
		}
		if (source === 'keychain') {
			return 'Using a saved keychain token.';
		}
		return 'No token configured. Set NOTION_TOKEN or save a token in app settings first.';
	}

	function lockedNotionConfig(value: NotionConfigInput): NotionConfigInput {
		return {
			...value,
			titlePropertyName: 'Class/Event',
			datePropertyName: 'Time'
		};
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

	function createParseRunId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	async function handleParse(): Promise<void> {
		resetTransientMessages();
		importProgress = 0;
		try {
			const weekDate = ensureStartDate(startWeekDate);
			const parseRunId = createParseRunId();
			activeParseRunId = parseRunId;
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
			const deterministicPreview = await parseTimetablePdfBytes(data, weekDate);
			const unresolvedCount = deterministicPreview.missedCandidates?.length ?? 0;
			if (deterministicPreview.lessons.length === 0) {
				if (unresolvedCount > 0) {
					throw new Error(
						`No lessons were parsed. ${unresolvedCount} unresolved lesson candidates were detected. Enable LLM recovery with NVIDIA API key for fallback extraction.`
					);
				}
				throw new Error('No lessons were detected from this PDF. Please review the timetable format.');
			}

			preview = {
				...deterministicPreview,
				parseRunId,
				refinementStatus: llmRepairEnabled ? 'idle' : 'skipped',
				refinedCount: 0
			};
			const mappedOccurrences = applyDefaultCourseNameMappings(deterministicPreview.occurrences);
			reviewOccurrences = mappedOccurrences.updated;
			const lowConfidenceCount = deterministicPreview.lessons.filter(
				(item) => (item.confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD
			).length;
			parseSummary = `Parsed ${deterministicPreview.lessons.length} lessons and ${deterministicPreview.occurrences.length} event occurrences (Wk:${deterministicPreview.minWeek}-${deterministicPreview.maxWeek}). ${lowConfidenceCount} low-confidence lessons.`;
			appStep.set('review');
			appMessage.set(
				unresolvedCount > 0
					? `Deterministic parse complete with ${unresolvedCount} unresolved candidates.`
					: `Deterministic parse complete. Applied ${mappedOccurrences.changed} course-name mappings. Ready for review.`
			);

			if (llmRepairEnabled) {
				if (!nvidiaHasApiKey) {
					if (preview) {
						preview = {
							...preview,
							refinementStatus: 'skipped',
							refinedCount: 0
						};
					}
					appMessage.set(
						'LLM refinement is enabled, but NVIDIA API key was not detected. Using deterministic parse only.'
					);
				} else {
					const model = nvidiaModelOverride.trim() || selectedNvidiaModel || undefined;
					void runBackgroundRefinement(parseRunId, weekDate, deterministicPreview, model);
				}
			}
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
			const parsed = notionConfigSchema.parse(lockedNotionConfig(notionForm));
			const saved = await saveNotionConfig(parsed);
			tokenSource = saved.tokenSource;
			tokenEnvVarName = saved.tokenEnvVarName;
			settingsStatus = `Settings saved. ${tokenSourceStatus(saved.tokenSource, saved.tokenEnvVarName)}`;
		} catch (error) {
			settingsStatus = error instanceof Error ? error.message : 'Unable to save settings.';
		}
	}

	async function handleTestConnection(): Promise<void> {
		try {
			const parsed = notionConfigSchema.parse(lockedNotionConfig(notionForm));
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
				datePropertyName: 'Time',
				titlePropertyName: 'Class/Event',
				timezone: notionForm.timezone
			});
			const created = await createNotionCalendarDatabase(parsed);
			notionForm = {
				...notionForm,
				databaseIdOrUrl: created.databaseUrl,
				datePropertyName: 'Time',
				titlePropertyName: 'Class/Event',
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
			const parsedConfig = notionConfigSchema.parse(lockedNotionConfig(notionForm));
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

	function parseWeekNumbers(sourceText: string): number[] {
		const match = sourceText.match(/W\s*k\s*:?\s*([0-9,\-\s]+)/i);
		if (!match) {
			return [];
		}
		const tokens = match[1]
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
		const weeks = new Set<number>();
		for (const token of tokens) {
			const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
			if (range) {
				const start = Number(range[1]);
				const end = Number(range[2]);
				if (Number.isFinite(start) && Number.isFinite(end)) {
					const [from, to] = start <= end ? [start, end] : [end, start];
					for (let week = from; week <= to; week += 1) {
						weeks.add(week);
					}
				}
				continue;
			}
			const numeric = Number(token);
			if (Number.isFinite(numeric)) {
				weeks.add(numeric);
			}
		}
		return [...weeks].sort((a, b) => a - b);
	}

	function isValidHhmm(value: string): boolean {
		return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
	}

	function nonEmpty(value: string | undefined): string | undefined {
		const trimmed = value?.trim();
		return trimmed && trimmed.length > 0 ? trimmed : undefined;
	}

	function preferText(existing: string | undefined, next: string | undefined): string | undefined {
		const a = nonEmpty(existing);
		const b = nonEmpty(next);
		if (!a) {
			return b;
		}
		if (!b) {
			return a;
		}
		return b.length >= a.length ? b : a;
	}

	function preferIssues(existing: ParseIssue[] | undefined, next: ParseIssue[] | undefined): ParseIssue[] | undefined {
		if (!existing || existing.length === 0) {
			return next;
		}
		if (!next || next.length === 0) {
			return next;
		}
		return next.length <= existing.length ? next : existing;
	}

	function candidatesToLessons(candidates: UnparsedLessonCandidate[]): ParsedLesson[] {
		return candidates.map((candidate) => ({
			id: candidate.id,
			title: candidate.courseCode ?? 'RECOVERY_CANDIDATE',
			courseCode: candidate.courseCode ?? 'RECOVERY_CANDIDATE',
			day: candidate.day,
			startTime: candidate.startTime ?? '00:00',
			endTime: candidate.endTime ?? '00:00',
			weeks: candidate.weeks.length > 0 ? candidate.weeks : parseWeekNumbers(candidate.sourceText),
			sourceText: candidate.sourceText,
			confidence: 0.2,
			issues: candidate.issues
		}));
	}

	function isValidRefinedLesson(item: ParsedLesson): boolean {
		if (!item.id.trim()) {
			return false;
		}
		if (!item.title.trim() || item.title.startsWith('RECOVERY_')) {
			return false;
		}
		if (!item.courseCode.trim() || item.courseCode.startsWith('RECOVERY_')) {
			return false;
		}
		if (!isValidHhmm(item.startTime) || !isValidHhmm(item.endTime)) {
			return false;
		}
		if (!item.weeks.every((week) => Number.isInteger(week) && week > 0)) {
			return false;
		}
		return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(item.day);
	}

	function lessonQualityScore(item: ParsedLesson): number {
		const confidence = Math.max(0, Math.min(1, item.confidence ?? 0.35));
		const filled =
			(item.venue ? 1 : 0) +
			(item.instructor ? 1 : 0) +
			(item.lessonType ? 1 : 0) +
			(item.weeks.length > 0 ? 1 : 0);
		const issuePenalty = item.issues?.length ?? 0;
		return confidence * 100 + filled * 8 - issuePenalty * 5;
	}

	function lessonDedupKey(item: ParsedLesson): string {
		return [
			item.day,
			item.startTime,
			item.endTime,
			(item.courseCode || item.title).trim().toUpperCase(),
			item.weeks.join(',')
		].join('|');
	}

	function buildRefinementCandidates(source: ImportPreview): ParsedLesson[] {
		const candidates: ParsedLesson[] = [];
		const seen = new Set<string>();
		for (const lesson of source.lessons) {
			if ((lesson.confidence ?? 1) >= LOW_CONFIDENCE_THRESHOLD) {
				continue;
			}
			const key = lessonDedupKey(lesson);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			candidates.push(lesson);
		}
		for (const candidate of candidatesToLessons(source.missedCandidates ?? [])) {
			const key = lessonDedupKey(candidate);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			candidates.push(candidate);
		}
		return candidates;
	}

	function mergeRefinedLessons(
		original: ParsedLesson[],
		refined: ParsedLesson[]
	): { lessons: ParsedLesson[]; refinedCount: number } {
		const merged = [...original];
		const indexById = new Map<string, number>();
		const indexByKey = new Map<string, number>();
		for (let index = 0; index < merged.length; index += 1) {
			indexById.set(merged[index].id, index);
			indexByKey.set(lessonDedupKey(merged[index]), index);
		}

		let refinedCount = 0;
		for (const lesson of refined) {
			if (!isValidRefinedLesson(lesson)) {
				continue;
			}

			const key = lessonDedupKey(lesson);
			const currentIndex = indexById.get(lesson.id) ?? indexByKey.get(key);
			if (currentIndex === undefined) {
				merged.push({ ...lesson, repairedByLlm: true });
				indexById.set(lesson.id, merged.length - 1);
				indexByKey.set(key, merged.length - 1);
				refinedCount += 1;
				continue;
			}

			const current = merged[currentIndex];
			if (lessonQualityScore(lesson) <= lessonQualityScore(current)) {
				continue;
			}

			const updated: ParsedLesson = {
				...current,
				...lesson,
				title: preferText(current.title, lesson.title) ?? current.title,
				courseCode: preferText(current.courseCode, lesson.courseCode) ?? current.courseCode,
				lessonType: preferText(current.lessonType, lesson.lessonType),
				venue: preferText(current.venue, lesson.venue),
				instructor: preferText(current.instructor, lesson.instructor),
				sourceText: preferText(current.sourceText, lesson.sourceText) ?? current.sourceText,
				weeks: lesson.weeks.length >= current.weeks.length ? lesson.weeks : current.weeks,
				confidence: Math.max(current.confidence ?? 0, lesson.confidence ?? 0),
				issues: preferIssues(current.issues, lesson.issues),
				repairedByLlm: true
			};
			merged[currentIndex] = updated;
			indexById.set(updated.id, currentIndex);
			indexByKey.set(lessonDedupKey(updated), currentIndex);
			refinedCount += 1;
		}

		return { lessons: merged, refinedCount };
	}

	async function runBackgroundRefinement(
		parseRunId: string,
		weekDate: string,
		sourcePreview: ImportPreview,
		model: string | undefined
	): Promise<void> {
		const candidates = buildRefinementCandidates(sourcePreview);
		if (activeParseRunId !== parseRunId) {
			return;
		}
		if (candidates.length === 0) {
			const currentPreview = preview;
			if (currentPreview?.parseRunId === parseRunId) {
				preview = { ...currentPreview, refinementStatus: 'skipped', refinedCount: 0 };
			}
			appMessage.set('No low-confidence candidates required LLM refinement.');
			return;
		}

		const currentPreview = preview;
		if (currentPreview?.parseRunId === parseRunId) {
			preview = { ...currentPreview, refinementStatus: 'running', refinedCount: 0 };
		}
		appMessage.set(`Running NVIDIA refinement in background for ${candidates.length} candidates...`);

		try {
			const refined = await refineLessonsWithLlm(candidates, model, { timeoutMs: LLM_TIMEOUT_MS });
			if (activeParseRunId !== parseRunId || preview?.parseRunId !== parseRunId) {
				return;
			}

			const merged = mergeRefinedLessons(sourcePreview.lessons, refined);
			if (merged.refinedCount === 0) {
				if (preview) {
					preview = { ...preview, refinementStatus: 'skipped', refinedCount: 0 };
				}
				appMessage.set('LLM refinement finished with no higher-confidence updates.');
				return;
			}

			const rebuilt = rebuildPreviewFromLessons(merged.lessons, weekDate);
			const mappedOccurrences = applyDefaultCourseNameMappings(rebuilt.occurrences);
			preview = {
				...rebuilt,
				missedCandidates: sourcePreview.missedCandidates,
				refinementStatus: 'applied',
				refinedCount: merged.refinedCount,
				parseRunId
			};
			reviewOccurrences = mappedOccurrences.updated;
			parseSummary = `${parseSummary} LLM refinement applied ${merged.refinedCount} updates.`;
			appMessage.set(`Background refinement applied ${merged.refinedCount} lesson updates.`);
		} catch (error) {
			if (activeParseRunId !== parseRunId || preview?.parseRunId !== parseRunId) {
				return;
			}
			const message = error instanceof Error ? error.message : 'LLM refinement failed.';
			const status: RefinementStatus = /timed out/i.test(message) ? 'timeout' : 'error';
			if (preview) {
				preview = { ...preview, refinementStatus: status, refinedCount: 0 };
			}
			appMessage.set(`LLM refinement ${status}. Using deterministic results.`);
		}
	}

	function refinementStatusText(value: ImportPreview | null): string {
		const status = value?.refinementStatus;
		if (!status) {
			return '';
		}
		if (status === 'idle') {
			return 'Refinement queued.';
		}
		if (status === 'running') {
			return 'Refinement running...';
		}
		if (status === 'applied') {
			return `Refinement applied (${value?.refinedCount ?? 0} updates).`;
		}
		if (status === 'skipped') {
			return 'Refinement skipped.';
		}
		if (status === 'timeout') {
			return 'Refinement timed out. Deterministic parse is kept.';
		}
		return 'Refinement failed. Deterministic parse is kept.';
	}

	function handleApplyCourseName(): void {
		const courseCode = courseCodeInput.trim().toUpperCase();
		const fullName = fullCourseNameInput.trim();
		if (!courseCode || !fullName) {
			errorText = 'Provide both Course Code and Full Course Name.';
			return;
		}

		const mapped = applyCourseNameMapping(reviewOccurrences, courseCode, fullName);
		reviewOccurrences = mapped.updated;
		parseSummary =
			mapped.changed > 0
				? `Applied full course name to ${mapped.changed} occurrences.`
				: `No rows matched ${courseCode}.`;
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
			tokenEnvVarName={tokenEnvVarName}
			parentPageIdOrUrl={parentPageIdOrUrl}
			databaseName={databaseName}
			busy={busy}
			status={settingsStatus}
			onFormChange={(next) => {
				notionForm = lockedNotionConfig(next);
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
						<select class="control control-model-large" bind:value={selectedNvidiaModel}>
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
			<div class="course-map panel">
				<h3 class="panel-title">Bulk Course Name Mapping</h3>
				<p class="text-muted">Session-only override for all rows matching a course code.</p>
				<div class="course-map-row">
					<input class="control" type="text" bind:value={courseCodeInput} placeholder="Course Code (e.g. VAR3033)" />
					<input class="control" type="text" bind:value={fullCourseNameInput} placeholder="Full Course Name" />
					<button class="btn" type="button" onclick={handleApplyCourseName} disabled={busy}>
						Apply
					</button>
				</div>
			</div>
			{#if parseSummary}
				<p class="status status-success">{parseSummary}</p>
			{/if}
			{#if refinementStatusText(preview)}
				<p class="status status-warning">{refinementStatusText(preview)}</p>
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

	.control-model-large {
		min-height: 48px;
		font-size: 16px;
		padding: 12px 14px;
	}

	.nvidia-row {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}

	.course-map {
		padding: 10px;
		display: grid;
		gap: 8px;
	}

	.course-map h3 {
		margin: 0;
		font-size: 15px;
	}

	.course-map p {
		margin: 0;
	}

	.course-map-row {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 8px;
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

		.course-map-row {
			grid-template-columns: 1fr;
		}
	}
</style>
