import type { Template } from "@freshcoat-js/coatfile";
import {
	type Dataset,
	type DatasetAsset,
	parseImageInfo,
	type Workspace,
} from "@freshcoat-js/workspace";
import { newId, sameGuides, singleTemplateWorkspace } from "~/state/workspace";
import { plural } from "./copy";

export type Autosave = {
	workspace: Workspace;
	fileName: string;
	savedAt: number;
	/** photos the document names that storage did not hold */
	missingAssets?: number;
	/** datasets the document names that storage did not hold */
	missingDatasets?: number;
};

/** What restoring `saved` has to tell the user. */
export function restoreNotices(saved: Autosave): string[] {
	const notices: string[] = [];
	const d = saved.missingDatasets;
	if (d)
		notices.push(
			`${plural(d, "dataset")} ${d === 1 ? "wasn't" : "weren't"} autosaved. Import ${d === 1 ? "it" : "them"} again in Data.`,
		);
	const n = saved.missingAssets;
	if (n)
		notices.push(
			`${plural(n, "photo")} ${n === 1 ? "wasn't" : "weren't"} autosaved. Add ${n === 1 ? "it" : "them"} again in Data.`,
		);
	return notices;
}

/** An asset as the document stores it: everything but its bytes, which live
 *  in the `assets` store under their sha256. */
type AssetMeta = Omit<DatasetAsset, "blob">;

type StoredDataset = Omit<Dataset, "assets"> & { assets: AssetMeta[] };

type StoredWorkspace = Omit<Workspace, "datasets"> & {
	datasets: StoredDataset[];
};

/** The workspace with its datasets reduced to their ids; each dataset is
 *  stored under its own key, so a write puts only the ones that changed. */
type StoredShell = Omit<Workspace, "datasets"> & { datasets: string[] };

/** Which tab wrote the shell, and its count of writes when it did. */
type WriterStamp = { tabId: string; generation: number };

type StoredAutosave = {
	version: 3;
	workspace: StoredShell;
	fileName: string;
	savedAt: number;
	writer?: WriterStamp;
};

/** What version 2 stored: the whole workspace under one key. Rewritten as
 *  version 3 when read. */
type SingleRecordAutosave = {
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
const DATASET_PREFIX = "dataset:";

const datasetKey = (id: string) => `${DATASET_PREFIX}${id}`;

const TAB_ID = newId("tab");

export type AutosaveOptions = {
	/** Called once when storage fills up and photos stop being saved, and
	 *  not again until they have been saved once more. */
	onStorageFull?: () => void;
	/** Who this store writes as; another tab's writes make what this one
	 *  remembers writing unreliable. Defaults to an id made per tab. */
	tabId?: string;
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

function stripAssets(d: Dataset): StoredDataset {
	return { ...d, assets: d.assets.map(({ blob: _blob, ...meta }) => meta) };
}

function shell(ws: Workspace | StoredWorkspace): StoredShell {
	return { ...ws, datasets: ws.datasets.map((d) => d.id) };
}

/** What tells one write of the shell from another. */
type Stamp = { writer?: WriterStamp; savedAt?: number };

function stamp(doc: unknown): Stamp {
	const v = doc as Partial<StoredAutosave> | undefined;
	return { writer: v?.writer, savedAt: v?.savedAt };
}

function sameStamp(a: Stamp, b: Stamp): boolean {
	return (
		a.savedAt === b.savedAt &&
		a.writer?.tabId === b.writer?.tabId &&
		a.writer?.generation === b.writer?.generation
	);
}

function sameAssets(saved: DatasetAsset[][], ws: Workspace): boolean {
	return (
		saved.length === ws.datasets.length &&
		ws.datasets.every((d, i) => d.assets === saved[i])
	);
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
 * Autosave in two object stores: the workspace document, split into a shell
 * and one record per dataset with its photos reduced to metadata, and the
 * photos' Blobs keyed by sha256, each written once. Writes run one at a time
 * over one connection; a write that arrives while one runs replaces any
 * other waiting behind it.
 */
export function createAutosaveStore(
	dbName = "freshcoat",
	opts: AutosaveOptions = {},
): AutosaveStore {
	let last: Workspace | null = null;
	/** each dataset's assets as of the last write that saved its photos */
	let savedAssets: DatasetAsset[][] | null = null;
	/** the dataset each key holds, by identity, or null when written before
	 *  this session; read on the first write */
	let written: Map<string, Dataset | null> | null = null;
	/** shas the assets store is known to hold, read on the first write */
	let stored: Set<string> | null = null;
	let full = false;
	const tabId = opts.tabId ?? TAB_ID;
	/** the generation of this store's last shell write */
	let generation = 0;
	let conn: Promise<IDBDatabase> | null = null;
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

	/** The session's connection, opened on first use and again after it
	 *  closes, forgetting what the store was known to hold. */
	function connect(): Promise<IDBDatabase> {
		if (conn) return conn;
		last = null;
		savedAssets = null;
		written = null;
		stored = null;
		const p: Promise<IDBDatabase> = openDb().then((db) => {
			const drop = () => {
				if (conn === p) conn = null;
			};
			db.onversionchange = () => {
				drop();
				db.close();
			};
			db.onclose = drop;
			return db;
		});
		conn = p;
		p.catch(() => {
			if (conn === p) conn = null;
		});
		return p;
	}

	async function disconnect(): Promise<void> {
		const p = conn;
		conn = null;
		(await p?.catch(() => null))?.close();
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

	async function datasetKeys(docs: IDBObjectStore): Promise<Map<string, null>> {
		const keys = await request(docs.getAllKeys());
		return new Map(
			keys
				.map(String)
				.filter((k) => k.startsWith(DATASET_PREFIX))
				.map((k) => [k, null]),
		);
	}

	function isMine(seen: Stamp): boolean {
		return (
			seen.writer?.tabId === tabId && seen.writer.generation === generation
		);
	}

	function forget(): void {
		written = null;
		stored = null;
		savedAssets = null;
	}

	async function writeNow(
		entry: Omit<Autosave, "savedAt">,
		retried = false,
	): Promise<void> {
		const ws = entry.workspace;
		if (last !== null && sameWorkspace(last, ws)) return;
		const db = await connect();
		let raced = false;
		try {
			const seen = stamp(
				await request(
					db.transaction(DOC_STORE).objectStore(DOC_STORE).get(KEY),
				),
			);
			if (written !== null && !isMine(seen)) forget();
			const assetsChanged =
				savedAssets === null || !sameAssets(savedAssets, ws);
			let assetsSaved = true;
			if (assetsChanged) {
				try {
					await writeAssets(db, ws);
				} catch (err) {
					if (!isQuotaError(err)) throw err;
					assetsSaved = false;
					if (!full) opts.onStorageFull?.();
					full = true;
				}
			}
			const tx = db.transaction(DOC_STORE, "readwrite");
			const docs = tx.objectStore(DOC_STORE);
			// Another tab wrote since the check above, and may have collected
			// photos this write put.
			raced = !sameStamp(seen, stamp(await request(docs.get(KEY))));
			if (raced) forget();
			const before = written ?? (await datasetKeys(docs));
			const now = new Map<string, Dataset>();
			for (const d of ws.datasets) {
				const key = datasetKey(d.id);
				now.set(key, d);
				if (before.get(key) !== d) docs.put(stripAssets(d), key);
			}
			for (const key of before.keys()) if (!now.has(key)) docs.delete(key);
			const doc: StoredAutosave = {
				version: 3,
				workspace: shell(ws),
				fileName: entry.fileName,
				savedAt: Date.now(),
				writer: { tabId, generation: generation + 1 },
			};
			docs.put(doc, KEY);
			await done(tx);
			generation += 1;
			written = now;
			last = ws;
			if (raced) {
				last = null;
				savedAssets = null;
			} else if (assetsSaved) {
				full = false;
				if (assetsChanged) await collect(db, ws);
				savedAssets = ws.datasets.map((d) => d.assets);
			} else {
				// Retry the photos on the next write, even if nothing changed.
				last = null;
				savedAssets = null;
			}
		} catch (err) {
			await disconnect();
			throw err;
		}
		if (raced && !retried && waiting === null) await writeNow(entry, true);
	}

	/** Rewrites a single-record autosave as the shell and one record per
	 *  dataset, unless a write replaced it meanwhile. */
	async function migrate(
		db: IDBDatabase,
		v: SingleRecordAutosave,
	): Promise<void> {
		const tx = db.transaction(DOC_STORE, "readwrite");
		const docs = tx.objectStore(DOC_STORE);
		const now = (await request(docs.get(KEY))) as
			| { version?: number }
			| undefined;
		if (now?.version !== 2) return;
		for (const d of v.workspace.datasets) docs.put(d, datasetKey(d.id));
		const doc: StoredAutosave = {
			version: 3,
			workspace: shell(v.workspace),
			fileName: v.fileName,
			savedAt: v.savedAt,
		};
		docs.put(doc, KEY);
		await done(tx);
		written = null;
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
				const db = await connect();
				const tx = db.transaction([DOC_STORE, ASSET_STORE]);
				const docs = tx.objectStore(DOC_STORE);
				const v = (await request(docs.get(KEY))) as
					| StoredAutosave
					| SingleRecordAutosave
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
				let saved: StoredDataset[];
				let missingDatasets = 0;
				if (v.version === 2) {
					saved = v.workspace.datasets;
				} else {
					saved = [];
					for (const id of v.workspace.datasets) {
						const d = (await request(docs.get(datasetKey(id)))) as
							| StoredDataset
							| undefined;
						if (d) saved.push(d);
						else missingDatasets += 1;
					}
				}
				const blobs = tx.objectStore(ASSET_STORE);
				let missing = 0;
				const datasets: Dataset[] = [];
				for (const d of saved) {
					const assets: DatasetAsset[] = [];
					for (const meta of d.assets) {
						const blob = (await request(blobs.get(meta.sha256))) as
							| Blob
							| undefined;
						if (blob) assets.push({ ...meta, blob });
						else missing += 1;
					}
					datasets.push({ ...d, assets });
				}
				if (v.version === 2) await migrate(db, v).catch(() => {});
				const out: Autosave = {
					workspace: { ...v.workspace, datasets },
					fileName: v.fileName,
					savedAt: v.savedAt,
				};
				if (missing) out.missingAssets = missing;
				if (missingDatasets) out.missingDatasets = missingDatasets;
				return out;
			} catch {
				await disconnect();
				return null;
			}
		},

		async clear() {
			last = null;
			savedAssets = null;
			written = null;
			try {
				const db = await connect();
				const tx = db.transaction([DOC_STORE, ASSET_STORE], "readwrite");
				tx.objectStore(DOC_STORE).clear();
				tx.objectStore(ASSET_STORE).clear();
				await done(tx);
				stored = new Set();
				written = new Map();
			} catch {
				await disconnect();
			}
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
