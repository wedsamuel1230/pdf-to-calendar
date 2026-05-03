<script lang="ts">
	import { Progress } from '@friendofsvelte/progress';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<Progress size="sm" color="amber" class="fos-progress-bar" />
{@render children()}
