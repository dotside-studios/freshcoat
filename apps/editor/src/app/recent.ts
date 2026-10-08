import type { Autosave } from "./autosave";

/** What a workspace was opened from. A sample or a starter opens again by
 *  its id; anything else only through the autosave it wrote. */
export type RecentSource =
	| { kind: "sample" | "starter"; id: string }
	| { kind: "workspace" };

export type RecentEntry = {
	id: string;
	name: string;
	openedAt: number;
	source: RecentSource;
	thumbnail?: Blob;
	/** the autosave's `savedAt` the thumbnail was drawn from */
	thumbnailFor?: number;
};

/** How an entry opens again: by restoring the autosave, or by its id. */
export type RecentItem = {
	entry: RecentEntry;
	reopen:
		| { kind: "restore"; saved: Autosave }
		| { kind: "sample" | "starter"; id: string };
};

const DB_NAME = "freshcoat-recent";
const STORE = "recent";
const KEEP = 20;

function open(dbName: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined")
			return reject(new Error("no IndexedDB"));
		const req = indexedDB.open(dbName, 1);
		req.onupgradeneeded = () =>
			req.result.createObjectStore(STORE, { keyPath: "id" });
		req.onsuccess = () => {
			resolve(req.result);
		};
		req.onerror = () => reject(req.error);
	});
}

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

export type RecentStore = {
	/** Newest first. */
	list(): Promise<RecentEntry[]>;
	/** Adds an entry, or updates its name and time and keeps the rest, and
	 *  forgets the oldest past the last 20. */
	record(entry: Omit<RecentEntry, "thumbnail" | "thumbnailFor">): Promise<void>;
	setThumbnail(
		id: string,
		thumbnail: Blob,
		thumbnailFor: number,
	): Promise<void>;
	remove(id: string): Promise<void>;
};

export function createRecentStore(dbName = DB_NAME): RecentStore {
	let conn: Promise<IDBDatabase> | null = null;

	function db(): Promise<IDBDatabase> {
		if (conn) return conn;
		const p = open(dbName).then((d) => {
			d.onversionchange = () => {
				d.close();
				if (conn === p) conn = null;
			};
			return d;
		});
		conn = p;
		p.catch(() => {
			if (conn === p) conn = null;
		});
		return p;
	}

	async function list(): Promise<RecentEntry[]> {
		const store = (await db()).transaction(STORE).objectStore(STORE);
		const all = (await request(store.getAll())) as RecentEntry[];
		return all.sort((a, b) => b.openedAt - a.openedAt);
	}

	async function update(
		id: string,
		change: (had: RecentEntry | undefined) => RecentEntry | null,
	): Promise<void> {
		const tx = (await db()).transaction(STORE, "readwrite");
		const store = tx.objectStore(STORE);
		const next = change(
			(await request(store.get(id))) as RecentEntry | undefined,
		);
		if (next) store.put(next);
		await done(tx);
	}

	return {
		list: () => list().catch(() => []),
		async record(entry) {
			try {
				await update(entry.id, (had) =>
					had ? { ...had, name: entry.name, openedAt: entry.openedAt } : entry,
				);
				const stale = (await list()).slice(KEEP);
				if (stale.length === 0) return;
				const tx = (await db()).transaction(STORE, "readwrite");
				for (const e of stale) tx.objectStore(STORE).delete(e.id);
				await done(tx);
			} catch {}
		},
		async setThumbnail(id, thumbnail, thumbnailFor) {
			try {
				await update(id, (had) =>
					had ? { ...had, thumbnail, thumbnailFor } : null,
				);
			} catch {}
		},
		async remove(id) {
			try {
				const tx = (await db()).transaction(STORE, "readwrite");
				tx.objectStore(STORE).delete(id);
				await done(tx);
			} catch {}
		},
	};
}

/**
 * The entries that can still be opened, newest first: the one the autosave
 * was written for, and samples and starters that still exist, each once.
 */
export function reopenable(
	entries: RecentEntry[],
	saved: Autosave | null,
	exists: (source: { kind: "sample" | "starter"; id: string }) => boolean,
): RecentItem[] {
	const items: RecentItem[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (saved?.recentId === entry.id) {
			items.push({
				entry: { ...entry, name: saved.workspace.name },
				reopen: { kind: "restore", saved },
			});
			continue;
		}
		const { source } = entry;
		if (source.kind === "workspace" || !exists(source)) continue;
		const key = `${source.kind}:${source.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({ entry, reopen: source });
	}
	return items;
}

let shared: RecentStore | null = null;

export function recentStore(): RecentStore {
	shared ??= createRecentStore();
	return shared;
}
