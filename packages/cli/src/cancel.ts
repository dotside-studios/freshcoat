import { rmSync } from "node:fs";

const SIGNALS = { SIGINT: 130, SIGTERM: 143 } as const;

/** The reason a signal from `listenForCancel` aborts with. */
export class SignalReceived extends Error {
	constructor(
		readonly signalName: string,
		readonly code: number,
	) {
		super(`received ${signalName}`);
		this.name = "SignalReceived";
	}
}

/** The exit code for a command cancelled through `signal`. */
export function cancelCode(signal: AbortSignal): number {
	return signal.reason instanceof SignalReceived
		? signal.reason.code
		: SIGNALS.SIGINT;
}

/** Temporary files a forced exit removes, since it skips their cleanup. */
export const pendingFiles = new Set<string>();

export type Cancellation = {
	signal: AbortSignal;
	/** while false, a signal exits at once instead of aborting `signal` */
	cancellable: boolean;
	dispose(): void;
};

/** An abort signal that fires on SIGINT or SIGTERM while `cancellable`.
 *  Any other signal exits at once, after removing `pendingFiles`. `dispose`
 *  removes the listeners. */
export function listenForCancel(): Cancellation {
	const controller = new AbortController();
	const cancellation: Cancellation = {
		signal: controller.signal,
		cancellable: false,
		dispose() {
			for (const [name, handler] of handlers) process.off(name, handler);
		},
	};
	const handlers = Object.entries(SIGNALS).map(([name, code]) => {
		const handler = () => {
			if (!cancellation.cancellable || controller.signal.aborted) {
				for (const path of pendingFiles) rmSync(path, { force: true });
				process.exit(code);
			}
			controller.abort(new SignalReceived(name, code));
		};
		process.on(name, handler);
		return [name, handler] as const;
	});
	return cancellation;
}
