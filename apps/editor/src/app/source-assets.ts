import type { DatasetAsset, Workspace } from "@freshcoat-js/workspace";
import { plural } from "./copy";

// A workspace opened from a file keeps its stored photos as slices of that
// file, which the browser refuses to read once the file changes on disk. Each
// one is copied into storage in the background and swapped for the stored
// copy, on the asset object itself so every snapshot, undo step and saved
// state that shares it sees the copy. A copy in memory is kept only when
// storage cannot hold it.

export class SourceChangedError extends Error {
	constructor(
		readonly fileName: string,
		readonly unreadable: number,
	) {
		super(
			`${fileName} changed on disk since it was opened, so ${plural(unreadable, "photo")} can no longer be read. Reopen the file to keep working with ${unreadable === 1 ? "it" : "them"}.`,
		);
		this.name = "SourceChangedError";
	}
}

export function isNotReadable(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"name" in err &&
		(err as { name: unknown }).name === "NotReadableError"
	);
}

export type SourceAssetsOptions = {
	fileName: string;
	/** Stores the photo, such as in autosave's store, and hands back the
	 *  stored copy, or null when it cannot. */
	keep?: (asset: DatasetAsset) => Promise<Blob | null>;
	/** Runs `task` when the page is idle. */
	schedule?: (task: () => void) => void;
	lanes?: number;
	/** Called once, the first time a photo is found unreadable with no copy. */
	onChanged?: (err: SourceChangedError) => void;
};

export type SourceAssets = {
	/** Photos still read from the file. */
	readonly pending: number;
	/** Resolves when the background copy has finished or stopped. */
	readonly done: Promise<void>;
	/** Swaps in the asset's copy now if it is still read from the file.
	 *  Whether its Blob changed. */
	recover(asset: DatasetAsset): Promise<boolean>;
	/** Copies every one of `assets` still read from the file, or throws a
	 *  SourceChangedError naming how many cannot be. */
	settle(assets: Iterable<DatasetAsset>): Promise<void>;
	/** Says the file changed, unless that was said already. */
	report(): void;
	stop(): void;
};

function idle(task: () => void): void {
	if (typeof requestIdleCallback === "function")
		requestIdleCallback(() => task(), { timeout: 2000 });
	else setTimeout(task, 0);
}

async function inLanes<T>(
	items: readonly T[],
	lanes: number,
	run: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await run(items[next++] as T);
	};
	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(lanes, items.length)) }, worker),
	);
}

export function createSourceAssets(
	ws: Workspace,
	opts: SourceAssetsOptions,
): SourceAssets {
	const schedule = opts.schedule ?? idle;
	const lanes = opts.lanes ?? 2;
	const pending = new Set<DatasetAsset>(ws.datasets.flatMap((d) => d.assets));
	const copying = new Map<DatasetAsset, Promise<void>>();
	let stopped = false;
	let reported = false;

	function changed(): SourceChangedError {
		const err = new SourceChangedError(opts.fileName, 1);
		if (!reported) {
			reported = true;
			opts.onChanged?.(err);
		}
		return err;
	}

	async function copyOf(asset: DatasetAsset): Promise<Blob> {
		try {
			const saved = await opts.keep?.(asset).catch((err: unknown) => {
				if (isNotReadable(err)) throw err;
				return null;
			});
			if (saved && saved.size === asset.size) return saved;
			const bytes = await asset.blob.arrayBuffer();
			return new Blob([bytes], { type: asset.contentType });
		} catch (err) {
			if (!isNotReadable(err)) throw err;
			throw changed();
		}
	}

	function detach(asset: DatasetAsset): Promise<void> {
		let running = copying.get(asset);
		if (!running) {
			running = copyOf(asset).then(
				(blob) => {
					copying.delete(asset);
					if (stopped || !pending.has(asset)) return;
					asset.blob = blob;
					pending.delete(asset);
				},
				(err) => {
					copying.delete(asset);
					throw err;
				},
			);
			copying.set(asset, running);
		}
		return running;
	}

	const queue = [...pending];
	const done = inLanes(queue, lanes, async (asset) => {
		if (stopped || !pending.has(asset)) return;
		await new Promise<void>((resolve) => schedule(resolve));
		if (stopped || !pending.has(asset)) return;
		await detach(asset).catch(() => {});
	});

	return {
		get pending() {
			return pending.size;
		},
		done,
		async recover(asset) {
			if (!pending.has(asset)) return false;
			await detach(asset);
			return true;
		},
		async settle(assets) {
			const wanted = [...new Set(assets)].filter((a) => pending.has(a));
			let unreadable = 0;
			await inLanes(wanted, lanes, async (asset) => {
				try {
					await detach(asset);
				} catch (err) {
					if (!(err instanceof SourceChangedError)) throw err;
					unreadable += 1;
				}
			});
			if (unreadable > 0)
				throw new SourceChangedError(opts.fileName, unreadable);
		},
		report() {
			changed();
		},
		stop() {
			stopped = true;
		},
	};
}

let current: SourceAssets | null = null;

/** Starts copying the photos of a workspace just opened from a file, in
 *  place of any workspace tracked before. */
export function trackSourceAssets(
	ws: Workspace,
	opts: SourceAssetsOptions,
): SourceAssets {
	current?.stop();
	current = createSourceAssets(ws, opts);
	return current;
}

export function stopSourceAssets(): void {
	current?.stop();
	current = null;
}

export function recoverAsset(asset: DatasetAsset): Promise<boolean> {
	return current?.recover(asset) ?? Promise.resolve(false);
}

export function reportSourceChanged(): void {
	current?.report();
}

export function settleAssets(assets: Iterable<DatasetAsset>): Promise<void> {
	return current?.settle(assets) ?? Promise.resolve();
}
