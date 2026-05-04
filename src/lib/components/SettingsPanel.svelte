<script lang="ts">
	import { Link2, TestTube2, Save } from 'lucide-svelte';
	import type { NotionConfigInput, NotionTokenSource } from '$lib/types/notion';

	interface Props {
		form: NotionConfigInput;
		tokenSource: NotionTokenSource;
		tokenEnvVarName?: string;
		parentPageIdOrUrl: string;
		databaseName: string;
		busy?: boolean;
		status?: string;
		onFormChange: (next: NotionConfigInput) => void;
		onParentPageChange: (value: string) => void;
		onDatabaseNameChange: (value: string) => void;
		onSave: () => void | Promise<void>;
		onTest: () => void | Promise<void>;
		onCreateDatabase: () => void | Promise<void>;
	}

	let {
		form,
		tokenSource,
		tokenEnvVarName = undefined,
		parentPageIdOrUrl,
		databaseName,
		busy = false,
		status = '',
		onFormChange,
		onParentPageChange,
		onDatabaseNameChange,
		onSave,
		onTest,
		onCreateDatabase
	}: Props = $props();

	function patch(next: Partial<NotionConfigInput>): void {
		onFormChange({ ...form, ...next });
	}

	function tokenSourceLabel(value: NotionTokenSource): string {
		if (value === 'environment') {
			return `Environment variable${tokenEnvVarName ? ` (${tokenEnvVarName})` : ''}`;
		}
		if (value === 'keychain') {
			return 'Saved keychain token';
		}
		return 'No token configured';
	}
</script>

<section class="panel settings">
	<header class="settings-header">
		<h2 class="panel-title">Notion Connection</h2>
		<p class="text-muted">Use `NOTION_TOKEN` or a saved keychain token with your Notion database URL/ID.</p>
	</header>

	<form
		class="settings-form"
		onsubmit={(event) => {
			event.preventDefault();
			void onSave();
		}}
	>
		<div class="settings-grid">
			<div class="token-status">
				<span class="label-row">Token Source</span>
				<p class="token-value">{tokenSourceLabel(tokenSource)}</p>
				{#if tokenSource === 'none'}
					<div class="env-help text-muted">
						<p>Set `NOTION_TOKEN` then restart the app.</p>
						<p>macOS/Linux: `export NOTION_TOKEN=\"your_token\"`</p>
						<p>Windows PowerShell: `$env:NOTION_TOKEN=\"your_token\"`</p>
						<p>Persist on Windows: `setx NOTION_TOKEN \"your_token\"`</p>
					</div>
				{/if}
			</div>

			<label>
				<span class="label-row">
					<Link2 size={14} />
					Database ID or URL
				</span>
				<input
					class="control"
					type="text"
					value={form.databaseIdOrUrl}
					placeholder="Notion database URL or ID"
					oninput={(event) =>
						patch({ databaseIdOrUrl: (event.currentTarget as HTMLInputElement).value })}
				/>
			</label>

			<div class="row">
				<label>
					<span class="label-row">Parent Page URL or ID</span>
					<input
						class="control"
						type="text"
						value={parentPageIdOrUrl}
						placeholder="Notion page URL or ID for the new calendar database"
						oninput={(event) => onParentPageChange((event.currentTarget as HTMLInputElement).value)}
					/>
				</label>

				<label>
					<span class="label-row">Database Name</span>
					<input
						class="control"
						type="text"
						value={databaseName}
						placeholder="Timetable Calendar"
						oninput={(event) => onDatabaseNameChange((event.currentTarget as HTMLInputElement).value)}
					/>
				</label>
			</div>

			<div class="row">
				<div class="schema-lock">
					<span class="label-row">Locked Schema</span>
					<p class="token-value">Class/Event, Day, Time, Location, Instructor</p>
				</div>

				<label>
					<span class="label-row">Timezone</span>
					<input
						class="control"
						type="text"
						value={form.timezone}
						oninput={(event) => patch({ timezone: (event.currentTarget as HTMLInputElement).value })}
					/>
				</label>
			</div>
		</div>

		<div class="actions">
			<button class="btn" type="button" onclick={onCreateDatabase} disabled={busy}>
				Create Calendar Database
			</button>
			<button class="btn" type="button" onclick={onTest} disabled={busy}>
				<TestTube2 size={16} />
				Test Connection
			</button>
			<button class="btn btn-primary" type="submit" disabled={busy}>
				<Save size={16} />
				Save Settings
			</button>
		</div>
	</form>

	{#if status}
		<p class="status">{status}</p>
	{/if}
</section>

<style>
	.settings {
		padding: 16px;
		display: grid;
		gap: 12px;
	}

	.settings-header p {
		margin: 6px 0 0;
	}

	.settings-grid {
		display: grid;
		gap: 12px;
	}

	.settings-form {
		display: grid;
		gap: 12px;
	}

	label {
		display: grid;
		gap: 6px;
	}

	.label-row {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--color-ash-gray);
	}

	.row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.token-status {
		display: grid;
		gap: 6px;
	}

	.token-value {
		margin: 0;
		color: var(--color-polar-white);
		font-family: var(--font-mono);
		font-size: 14px;
	}

	.env-help p {
		margin: 0;
	}

	.schema-lock {
		display: grid;
		gap: 6px;
	}

	p.status {
		margin: 0;
	}

	@media (max-width: 900px) {
		.row {
			grid-template-columns: 1fr;
		}
	}
</style>
