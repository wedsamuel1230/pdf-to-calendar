<script lang="ts">
	import { Trash2 } from 'lucide-svelte';
	import type { LessonOccurrence } from '$lib/types/timetable';

	interface Props {
		occurrences: LessonOccurrence[];
		duplicateKeys: Set<string>;
		onUpdate: (id: string, patch: Partial<LessonOccurrence>) => void;
		onRemove: (id: string) => void;
	}

	let { occurrences, duplicateKeys, onUpdate, onRemove }: Props = $props();

	function datePart(iso: string): string {
		return iso.slice(0, 10);
	}

	function timePart(iso: string): string {
		return iso.slice(11, 16);
	}

	function duplicateKeyFor(occurrence: LessonOccurrence): string {
		return `${occurrence.title}|${occurrence.startIso}|${occurrence.endIso}`;
	}
</script>

<section class="panel review">
	<header class="review-head">
		<h2 class="panel-title">Review Lessons</h2>
		<span class="chip">{occurrences.length} events</span>
	</header>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Day</th>
					<th>Week</th>
					<th>Date</th>
					<th>Time</th>
					<th>Title</th>
					<th>Venue</th>
					<th>Instructor</th>
					<th>Flags</th>
					<th>Action</th>
				</tr>
			</thead>
			<tbody>
				{#each occurrences as occurrence (occurrence.id)}
					<tr>
						<td>{occurrence.day}</td>
						<td>{occurrence.weekNumber}</td>
						<td>{datePart(occurrence.startIso)}</td>
						<td>{timePart(occurrence.startIso)}-{timePart(occurrence.endIso)}</td>
						<td>
							<input
								class="control"
								value={occurrence.title}
								oninput={(event) =>
									onUpdate(occurrence.id, { title: (event.currentTarget as HTMLInputElement).value })}
							/>
						</td>
						<td>
							<input
								class="control"
								value={occurrence.venue ?? ''}
								oninput={(event) =>
									onUpdate(occurrence.id, { venue: (event.currentTarget as HTMLInputElement).value })}
							/>
						</td>
						<td>
							<input
								class="control"
								value={occurrence.instructor ?? ''}
								oninput={(event) =>
									onUpdate(occurrence.id, { instructor: (event.currentTarget as HTMLInputElement).value })}
							/>
						</td>
						<td>
							{#if duplicateKeys.has(duplicateKeyFor(occurrence))}
								<span class="chip duplicate">Duplicate</span>
							{/if}
						</td>
						<td>
							<button
								class="icon-btn"
								type="button"
								onclick={() => onRemove(occurrence.id)}
								aria-label="Remove lesson occurrence"
								title="Remove lesson occurrence"
							>
								<Trash2 size={14} />
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<style>
	.review {
		padding: 16px;
		display: grid;
		gap: 12px;
	}

	.review-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}

	.duplicate {
		border-color: rgba(231, 197, 154, 0.58);
		color: var(--color-amber-glow);
	}
</style>
