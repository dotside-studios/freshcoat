export type SchedulerStats = {
	completed: number;
	/** Requests replaced by a newer one before they started. */
	coalesced: number;
	p50: number;
	p95: number;
	max: number;
	/** Renders finished in the last second. */
	perSecond: number;
};

export type RenderScheduler<I> = {
	request(input: I): void;
	stats(): SchedulerStats;
	/** Resolves once nothing is pending or in flight. */
	idle(): Promise<void>;
	dispose(): void;
};

const WINDOW = 60;

/**
 * Runs `run` for the latest requested input, one at a time. A request made
 * while a render is in flight replaces any earlier waiting one, and starts on
 * the next animation frame after the current render finishes.
 */
export function createRenderScheduler<I, O>(
	run: (input: I) => Promise<O>,
	handlers: {
		onResult(output: O, input: I, ms: number): void;
		onError(error: unknown, input: I): void;
	},
	env: {
		raf?: (cb: () => void) => void;
		now?: () => number;
	} = {},
): RenderScheduler<I> {
	const raf =
		env.raf ??
		((cb: () => void) => {
			requestAnimationFrame(() => cb());
		});
	const now = env.now ?? (() => performance.now());

	let pending: { input: I } | null = null;
	let running = false;
	let scheduled = false;
	let disposed = false;
	let completed = 0;
	let coalesced = 0;
	const durations: number[] = [];
	const finishedAt: number[] = [];
	let idleWaiters: (() => void)[] = [];

	const settleIdle = () => {
		if (running || scheduled || pending) return;
		const waiters = idleWaiters;
		idleWaiters = [];
		for (const w of waiters) w();
	};

	const start = () => {
		scheduled = false;
		if (disposed || running || !pending) {
			settleIdle();
			return;
		}
		const { input } = pending;
		pending = null;
		running = true;
		const began = now();
		run(input)
			.then(
				(output) => {
					if (disposed) return;
					const ms = now() - began;
					completed++;
					durations.push(ms);
					if (durations.length > WINDOW) durations.shift();
					finishedAt.push(now());
					if (finishedAt.length > WINDOW) finishedAt.shift();
					handlers.onResult(output, input, ms);
				},
				(error) => {
					if (!disposed) handlers.onError(error, input);
				},
			)
			.finally(() => {
				running = false;
				if (pending && !disposed) schedule();
				else settleIdle();
			});
	};

	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		raf(start);
	};

	return {
		request(input) {
			if (disposed) return;
			if (pending) coalesced++;
			pending = { input };
			if (!running) schedule();
		},
		stats() {
			const sorted = [...durations].sort((a, b) => a - b);
			const at = (q: number) =>
				sorted.length === 0
					? 0
					: (sorted[
							Math.min(sorted.length - 1, Math.floor(q * sorted.length))
						] ?? 0);
			const t = now();
			return {
				completed,
				coalesced,
				p50: at(0.5),
				p95: at(0.95),
				max: sorted.at(-1) ?? 0,
				perSecond: finishedAt.filter((f) => t - f <= 1000).length,
			};
		},
		idle() {
			if (!running && !scheduled && !pending) return Promise.resolve();
			return new Promise((resolve) => idleWaiters.push(resolve));
		},
		dispose() {
			disposed = true;
			pending = null;
			settleIdle();
		},
	};
}
