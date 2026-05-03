import { describe, expect, it } from 'vitest';
import { ensurePdfJsWebViewCompatibility } from './webview-compat';

describe('webview compatibility polyfills', () => {
	it('installs missing Promise.withResolvers without replacing existing implementations', () => {
		const original = Promise.withResolvers;
		try {
			Reflect.deleteProperty(Promise, 'withResolvers');
			ensurePdfJsWebViewCompatibility();
			expect(Promise.withResolvers).toBeTypeOf('function');
			const installed = Promise.withResolvers;

			ensurePdfJsWebViewCompatibility();
			expect(Promise.withResolvers).toBe(installed);
		} finally {
			if (original) {
				Promise.withResolvers = original;
			}
		}
	});

	it('does not overwrite an existing ReadableStream async iterator', () => {
		const prototype = globalThis.ReadableStream?.prototype;
		if (!prototype) {
			return;
		}

		const original = prototype[Symbol.asyncIterator];
		try {
			const existing = async function* () {
				yield new Uint8Array([1]);
			};
			Object.defineProperty(prototype, Symbol.asyncIterator, {
				configurable: true,
				writable: true,
				value: existing
			});

			ensurePdfJsWebViewCompatibility();
			expect(prototype[Symbol.asyncIterator]).toBe(existing);
		} finally {
			if (original) {
				Object.defineProperty(prototype, Symbol.asyncIterator, {
					configurable: true,
					writable: true,
					value: original
				});
			} else {
				Reflect.deleteProperty(prototype, Symbol.asyncIterator);
			}
		}
	});
});
