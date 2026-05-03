type PromiseWithResolvers<T> = {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
};

type PromiseConstructorWithOptionalResolvers = PromiseConstructor & {
	withResolvers?: <T>() => PromiseWithResolvers<T>;
};

type ReadableStreamReaderResult<T> = ReadableStreamReadDoneResult<T> | ReadableStreamReadValueResult<T>;

type AsyncIterableReadableStream<T> = ReadableStream<T> & {
	[Symbol.asyncIterator]?: () => AsyncIterator<T>;
};

export function ensurePdfJsWebViewCompatibility(): void {
	const promiseConstructor = Promise as PromiseConstructorWithOptionalResolvers;
	if (!promiseConstructor.withResolvers) {
		promiseConstructor.withResolvers = <T>() => {
			let resolve!: (value: T | PromiseLike<T>) => void;
			let reject!: (reason?: unknown) => void;
			const promise = new Promise<T>((promiseResolve, promiseReject) => {
				resolve = promiseResolve;
				reject = promiseReject;
			});
			return { promise, resolve, reject };
		};
	}

	const readableStreamPrototype = globalThis.ReadableStream?.prototype as
		| AsyncIterableReadableStream<unknown>
		| undefined;
	if (!readableStreamPrototype || readableStreamPrototype[Symbol.asyncIterator]) {
		return;
	}

	Object.defineProperty(readableStreamPrototype, Symbol.asyncIterator, {
		configurable: true,
		writable: true,
		value: async function* <T>(this: ReadableStream<T>): AsyncGenerator<T> {
			const reader = this.getReader();
			try {
				while (true) {
					const result: ReadableStreamReaderResult<T> = await reader.read();
					if (result.done) {
						return;
					}
					yield result.value;
				}
			} finally {
				reader.releaseLock();
			}
		}
	});
}
