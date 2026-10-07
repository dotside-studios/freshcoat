import { toast } from "@freshcoat-js/ui/toast";

const SLOW_MS = 400;

/** Shares one call of `load`. A failed load is retried by the next call. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
	let pending: Promise<T> | null = null;
	return () => {
		pending ??= load().catch((err: unknown) => {
			pending = null;
			throw err;
		});
		return pending;
	};
}

/** Toasts `loading` while a slow load runs. A failed load toasts `failed`
 *  with a Retry and resolves null. */
export async function loadFor<T>(
	load: () => Promise<T>,
	copy: { loading: string; failed: string },
	retry: () => unknown,
): Promise<T | null> {
	let close: (() => void) | undefined;
	const slow = setTimeout(() => {
		close = toast(copy.loading, { timeout: 0 });
	}, SLOW_MS);
	try {
		return await load();
	} catch {
		toast(copy.failed, {
			tone: "danger",
			timeout: 10000,
			action: { label: "Retry", onAction: () => void retry() },
		});
		return null;
	} finally {
		clearTimeout(slow);
		close?.();
	}
}
