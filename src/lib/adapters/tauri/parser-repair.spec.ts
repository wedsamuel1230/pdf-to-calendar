import { describe, expect, it } from 'vitest';
import { __testables } from './parser-repair';

describe('parser repair adapter timeout', () => {
	it('returns task result before timeout', async () => {
		const result = await __testables.withTimeout(Promise.resolve('ok'), 200);
		expect(result).toBe('ok');
	});

	it('throws timeout error when task exceeds timeout', async () => {
		await expect(
			__testables.withTimeout(
				new Promise<string>((resolve) => {
					setTimeout(() => resolve('late'), 80);
				}),
				5
			)
		).rejects.toThrow(/timed out/i);
	});
});
