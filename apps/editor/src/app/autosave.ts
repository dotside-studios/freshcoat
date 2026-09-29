import type { Template } from "@freshcoat-js/coatfile";
import {
	type Dataset,
	type DatasetAsset,
	parseImageInfo,
	type Workspace,
} from "@freshcoat-js/workspace";
import { sameGuides, singleTemplateWorkspace } from "~/state/workspace";
import { plural } from "./copy";

export type Autosave = {
	workspace: Workspace;
	fileName: string;
	savedAt: number;
	/** photos the document names that storage did not hold */
	missingAssets?: number;
};

/** What restoring `saved` has to tell the user. */
export function restoreNotices(saved: Autosave): string[] {
	const n = saved.missingAssets;
	if (!n) return [];
	return [
		`${plural(n, "photo")} ${n === 1 ? "wasn't" : "weren't"} autosaved. Add ${n === 1 ? "it" : "them"} again in Data.`,
	];
}

/** An asset as the document stores it: everything but its bytes, which live
 *  in the `assets` store under their sha256. */
type AssetMeta = Omit<DatasetAsset, "blob">;

type StoredWorkspace = Omit<Workspace, "datasets"> & {
	datasets: (Omit<Dataset, "assets"> & { assets: AssetMeta[] })[];
};

type StoredAutosave = {
	version: 2;
	workspace: StoredWorkspace;
	fileName: string;
	savedAt: number;
};

/** What phase 1 stored: one template. Read once and folded into a workspace. */
type LegacyTemplateAutosave = {
	template: Template;
	fileName: string;
	savedAt: number;
};

/** What phase 2 stored: the workspace with every photo's bytes inline. */
type InlineAutosave = {
	workspace: Omit<Workspace, "datasets"> & {
		datasets: (Omit<Dataset, "assets"> & {
			assets: {
				sha256: string;
				contentType: string;
				name: string;
				bytes: Uint8Array;
			}[];
		})[];
	};
	fileName: string;
	savedAt: number;
};

const DOC_STORE = "autosave";
const ASSET_STORE = "assets";
const KEY = "current";

export type AutosaveOptions = {
	/** Called once when storage fills up and photos stop being saved, and
	 *  not again until they have been saved once more. */
	onStorageFull?: () => void;
};

export type AutosaveStore = {
	write(entry: Omit<Autosave, "savedAt">): Promise<void>;
	read(): Promise<Autosave | null>;
	clear(): Promise<void>;
};

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () =>
			reject(tx.error ?? new DOMException("aborted", "AbortError"));
	});
}

function isQuotaError(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"name" in err &&
		(err as { name: unknown }).name === "QuotaExceededError"
	);
}

function stripAssets(ws: Workspace): StoredWorkspace {
	return {
		...ws,
		datasets: ws.datasets.map((d) => ({
			...d,
			assets: d.assets.map(({ blob: _blob, ...meta }) => meta),
		})),
	};
}

/** Whether two snapshots hold the same things, compared the way the store
 *  keeps them: by identity. */
function sameWorkspace(a: Workspace, b: Workspace): boolean {
	return (
		a.name === b.name &&
		a.datasets === b.datasets &&
		a.presets === b.presets &&
		a.templates.length === b.templates.length &&
		a.templates.every((t, i) => {
			const o = b.templates[i];
			return (
				o !== undefined &&
				t.id === o.id &&
				t.fileName === o.fileName &&
				t.template === o.template &&
				t.binding === o.binding &&
				sameGuides(t.guides, o.guides)
			);
		})
	);
}

function fromInline(v: InlineAutosave): Autosave {
	return {
		workspace: {
			...v.workspace,
			datasets: v.workspace.datasets.map((d) => ({
				...d,
				assets: d.assets.map(({ bytes, ...meta }) => {
					const info = parseImageInfo(bytes);
					const asset: DatasetAsset = {
						...meta,
						size: bytes.length,
						blob: new Blob([bytes as BlobPart], { type: meta.contentType }),
					};
					if (info) {
						asset.width = info.width;
						asset.height = info.height;
						if (info.orientation !== undefined)
							asset.orientation = info.orientation;
					}
					return asset;
				}),
			})),
		},
		fileName: v.fileName,
		savedAt: v.savedAt,
	};
}

/**
 * Autosave in two object stores: the workspace document with its photos
 * reduced to metadata, and the photos' Blobs keyed by sha256, each written
 * once. Writes run one at a time; a write that arrives while one runs
 * replaces any other waiting behind it.
 */
export function createAutosaveStore(
	dbName = "freshcoat",
	opts: AutosaveOptions = {},
): AutosaveStore {
	let last: Workspace | null = null;
	/** shas the assets store is known to hold, read on the first write */
	let stored: Set<string> | null = null;
	let full = false;
	let running: Promise<void> = Promise.resolve();
	let waiting: Omit<Autosave, "savedAt"> | null = null;

	function openDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			if (typeof indexedDB === "undefined")
				return reject(new Error("no IndexedDB"));
			const req = indexedDB.open(dbName, 2);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(DOC_STORE))
					db.createObjectStore(DOC_STORE);
				if (!db.objectStoreNames.contains(ASSET_STORE))
					db.createObjectStore(ASSET_STORE);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	async function writeAssets(db: IDBDatabase, ws: Workspace): Promise<void> {
		if (stored === null) {
			const keys = await request(
				db.transaction(ASSET_STORE).objectStore(ASSET_STORE).getAllKeys(),
			);
			stored = new Set(keys.map(String));
		}
		for (const dataset of ws.datasets) {
			for (const asset of dataset.assets) {
				if (stored.has(asset.sha256)) continue;
				// One transaction each, so a full disk loses the photo that did
				// not fit rather than the ones before it.
				const tx = db.transaction(ASSET_STORE, "readwrite");
				try {
					tx.objectStore(ASSET_STORE).put(asset.blob, asset.sha256);
					await done(tx);
				} catch (err) {
					try {
						tx.abort();
					} catch {}
					throw err;
				}
				stored.add(asset.sha256);
			}
		}
	}

	async function collect(db: IDBDatabase, ws: Workspace): Promise<void> {
		const keep = new Set(
			ws.datasets.flatMap((d) => d.assets.map((a) => a.sha256)),
		);
		const tx = db.transaction(ASSET_STORE, "readwrite");
		const store = tx.objectStore(ASSET_STORE);
		const keys = await request(store.getAllKeys());
		for (const key of keys) {
			if (keep.has(String(key))) continue;
			store.delete(key);
			stored?.delete(String(key));
		}
		await done(tx);
	}

	async function writeNow(entry: Omit<Autosave, "savedAt">): Promise<void> {
		if (last !== null && sameWorkspace(last, entry.workspace)) return;
		const db = await openDb();
		try {
			let assetsSaved = true;
			try {
				await writeAssets(db, entry.workspace);
			} catch (err) {
				if (!isQuotaError(err)) throw err;
				assetsSaved = false;
				if (!full) opts.onStorageFull?.();
				full = true;
			}
			const doc: StoredAutosave = {
				version: 2,
				workspace: stripAssets(entry.workspace),
				fileName: entry.fileName,
				savedAt: Date.now(),
			};
			const tx = db.transaction(DOC_STORE, "readwrite");
			tx.objectStore(DOC_STORE).put(doc, KEY);
			await done(tx);
			last = entry.workspace;
			if (assetsSaved) {
				full = false;
				await collect(db, entry.workspace);
			} else {
				// Retry the photos on the next write, even if nothing changed.
				last = null;
			}
		} finally {
			db.close();
		}
	}

	return {
		write(entry) {
			const first = waiting === null;
			waiting = entry;
			if (!first) return running;
			running = running.then(async () => {
				const next = waiting;
				waiting = null;
				if (next) await writeNow(next).catch(() => {});
			});
			return running;
		},

		async read() {
			try {
				const db = await openDb();
				try {
					const v = (await request(
						db.transaction(DOC_STORE).objectStore(DOC_STORE).get(KEY),
					)) as
						| StoredAutosave
						| InlineAutosave
						| LegacyTemplateAutosave
						| undefined;
					if (!v) return null;
					if (!("workspace" in v)) {
						return {
							workspace: singleTemplateWorkspace(v.template, v.fileName),
							fileName: "Untitled.coatworkspace",
							savedAt: v.savedAt,
						};
					}
					if (!("version" in v)) return fromInline(v);
					const store = db.transaction(ASSET_STORE).objectStore(ASSET_STORE);
					let missing = 0;
					const datasets: Dataset[] = [];
					for (const d of v.workspace.datasets) {
						const assets: DatasetAsset[] = [];
						for (const meta of d.assets) {
							const blob = (await request(store.get(meta.sha256))) as
								| Blob
								| undefined;
							if (blob) assets.push({ ...meta, blob });
							else missing += 1;
						}
						datasets.push({ ...d, assets });
					}
					const out: Autosave = {
						workspace: { ...v.workspace, datasets },
						fileName: v.fileName,
						savedAt: v.savedAt,
					};
					if (missing) out.missingAssets = missing;
					return out;
				} finally {
					db.close();
				}
			} catch {
				return null;
			}
		},

		async clear() {
			last = null;
			try {
				const db = await openDb();
				try {
					const tx = db.transaction([DOC_STORE, ASSET_STORE], "readwrite");
					tx.objectStore(DOC_STORE).delete(KEY);
					tx.objectStore(ASSET_STORE).clear();
					await done(tx);
					stored = new Set();
				} finally {
					db.close();
				}
			} catch {}
		},
	};
}

let shared: AutosaveStore | null = null;
let sharedOptions: AutosaveOptions = {};

/** Sets what the editor's autosave does when storage is full. */
export function configureAutosave(opts: AutosaveOptions): void {
	sharedOptions = opts;
}

function store(): AutosaveStore {
	shared ??= createAutosaveStore("freshcoat", {
		onStorageFull: () => sharedOptions.onStorageFull?.(),
	});
	return shared;
}

export function writeAutosave(entry: Omit<Autosave, "savedAt">): Promise<void> {
	return store().write(entry);
}

export function readAutosave(): Promise<Autosave | null> {
	return store().read();
}

export function clearAutosave(): Promise<void> {
	return store().clear();
}
