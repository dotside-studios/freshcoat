const SIGNALS = { SIGINT: 130, SIGTERM: 143 } as const;

export type Cancellation = {
	signal: AbortSignal;
	/** the exit code of the cancellation, once `signal` is aborted */
	readonly code: number;
	dispose(): void;
};

/** An abort signal that fires on SIGINT or SIGTERM, or when `outer` aborts.
 *  A second signal exits at once. `dispose` removes the listeners. */
export function listenForCancel(outer?: AbortSignal): Cancellation {
	const controller = new AbortController();
	let code: number = SIGNALS.SIGINT;
	const handlers = Object.entries(SIGNALS).map(([name, exitCode]) => {
		const handler = () => {
			if (controller.signal.aborted) process.exit(exitCode);
			code = exitCode;
			controller.abort(new Error(`received ${name}`));
		};
		process.on(name, handler);
		return [name, handler] as const;
	});
	const follow = () => controller.abort(outer?.reason);
	if (outer?.aborted) follow();
	else outer?.addEventListener("abort", follow, { once: true });
	return {
		signal: controller.signal,
		get code() {
			return code;
		},
		dispose() {
			for (const [name, handler] of handlers) process.off(name, handler);
			outer?.removeEventListener("abort", follow);
		},
	};
}
