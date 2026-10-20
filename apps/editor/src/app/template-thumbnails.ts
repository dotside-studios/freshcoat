import {
	resolveTemplateFonts,
	sampleValues,
	type Template,
} from "@freshcoat-js/coatfile";
import { useEffect, useState } from "react";
import { fontCache } from "~/render/font-cache";
import { once } from "./lazy";

/** Device pixels along a thumbnail's longer edge. */
export const THUMBNAIL_SIZE = 160;

const VERSION = 1;
const DB_NAME = "freshcoat-thumbnails";
const STORE = "thumbnails";

const loadExportPng = once(() => import("./export-png"));

/** The front side in the default variant, filled with sample values. */
export async function renderThumbnail(t: Template): Promise<Blob> {
	const [{ renderSidePng }, { fonts }] = await Promise.all([
		loadExportPng(),
		resolveTemplateFonts(t, { cache: fontCache }),
	]);
	const { png } = await renderSidePng(t, {
		side: 0,
		values: sampleValues(t),
		scale: THUMBNAIL_SIZE / Math.max(t.width, t.height),
		fonts,
	});
	return new Blob([png as BlobPart], { type: "image/png" });
}

/** FNV-1a over the template's JSON, so a changed template is drawn again. */
export function templateHash(t: Template): string {
	const s = `${VERSION}:${THUMBNAIL_SIZE}:${JSON.stringify(t)}`;
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

type Stored = { hash: string; blob: Blob };

let conn: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
	conn ??= new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === "undefined")
			return reject(new Error("no IndexedDB"));
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => {
			req.result.onversionchange = () => {
				req.result.close();
				conn = null;
			};
			resolve(req.result);
		};
		req.onerror = () => reject(req.error);
	});
	conn.catch(() => {
		conn = null;
	});
	return conn;
}

async function readStored(key: string): Promise<Stored | null> {
	try {
		const store = (await db()).transaction(STORE).objectStore(STORE);
		return await new Promise((resolve, reject) => {
			const req = store.get(key);
			req.onsuccess = () => resolve((req.result as Stored | undefined) ?? null);
			req.onerror = () => reject(req.error);
		});
	} catch {
		return null;
	}
}

async function writeStored(key: string, value: Stored): Promise<void> {
	try {
		const tx = (await db()).transaction(STORE, "readwrite");
		tx.objectStore(STORE).put(value, key);
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} catch {}
}

/** Where a thumbnail comes from: a quick read of what was kept, and the
 *  slower check that redraws it when it is missing or stale. */
export type ThumbnailSource = {
	key: string;
	cached(): Promise<Blob | null>;
	fresh(): Promise<Blob | null>;
};

/** A sample's or starter's thumbnail, kept until its template changes. */
export function templateThumbnail(
	key: string,
	load: () => Promise<Template>,
): ThumbnailSource {
	return {
		key,
		cached: async () => (await readStored(key))?.blob ?? null,
		async fresh() {
			const t = await load();
			const hash = templateHash(t);
			const kept = await readStored(key);
			if (kept?.hash === hash) return kept.blob;
			const blob = await renderThumbnail(t);
			await writeStored(key, { hash, blob });
			return blob;
		},
	};
}

const urls = new Map<string, string>();
const checked = new Map<string, Promise<void>>();
const watchers = new Map<string, Set<(url: string) => void>>();

let queue: Promise<void> = Promise.resolve();

function idle(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestIdleCallback === "function")
			requestIdleCallback(() => resolve(), { timeout: 500 });
		else setTimeout(resolve, 0);
	});
}

function show(key: string, blob: Blob): void {
	const old = urls.get(key);
	const url = URL.createObjectURL(blob);
	urls.set(key, url);
	for (const fn of watchers.get(key) ?? []) fn(url);
	if (old) URL.revokeObjectURL(old);
}

/** Checks one source at a time, and skips one nobody shows any more. */
function check(source: ThumbnailSource): void {
	if (checked.has(source.key)) return;
	const run = queue.then(async () => {
		if (!watchers.get(source.key)?.size) {
			checked.delete(source.key);
			return;
		}
		await idle();
		const blob = await source.fresh().catch(() => null);
		if (blob) show(source.key, blob);
	});
	checked.set(source.key, run);
	queue = run;
}

/** An object URL for the source's thumbnail, or null until there is one. */
export function useThumbnail(source: ThumbnailSource | null): string | null {
	const key = source?.key ?? null;
	const [url, setUrl] = useState(() => (key && urls.get(key)) || null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on purpose
	useEffect(() => {
		if (!source) {
			setUrl(null);
			return;
		}
		const { key } = source;
		setUrl(urls.get(key) ?? null);
		let set = watchers.get(key);
		if (!set) {
			set = new Set();
			watchers.set(key, set);
		}
		set.add(setUrl);
		if (!urls.has(key))
			void source.cached().then((blob) => {
				if (blob && !urls.has(key)) show(key, blob);
			});
		check(source);
		return () => {
			set.delete(setUrl);
		};
	}, [key]);

	return url;
}
