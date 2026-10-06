// @vitest-environment node
import "fake-indexeddb/auto";
import type { Dataset, DatasetAsset, Workspace } from "@freshcoat-js/workspace";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type Autosave,
	createAutosaveStore,
	restoreNotices,
} from "~/app/autosave";
import { doc as docFixture } from "./doc-fixture";

let dbCount = 0;
const freshDb = () => `autosave-test-${++dbCount}`;

function asset(n: number, name = `p${n}.png`): DatasetAsset {
	const bytes = new Uint8Array([n, n, n]);
	return {
		sha256: `sha${n}`,
		contentType: "image/png",
		name,
		size: bytes.length,
		blob: new Blob([bytes], { type: "image/png" }),
	};
}

function workspace(assets: DatasetAsset[]): Workspace {
	const dataset: Dataset = {
		id: "d_1",
		name: "Photos",
		columns: [{ key: "photo", type: "image" }],
		records: assets.map((a, i) => ({
			id: `r_${i}`,
			status: "pending",
			values: { photo: `ws:${a.sha256}` },
		})),
		assets,
	};
	return {
		formatVersion: "1.0",
		name: "Test",
		templates: [{ id: "t_1", fileName: "a.coat", template: docFixture() }],
		datasets: [dataset],
		presets: [],
	};
}

function openRaw(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function rawGet(name: string, store: string, key?: string) {
	const db = await openRaw(name);
	try {
		const s = db.transaction(store).objectStore(store);
		return await new Promise<unknown>((resolve) => {
			const req = key === undefined ? s.getAllKeys() : s.get(key);
			req.onsuccess = () => resolve(req.result);
		});
	} finally {
		db.close();
	}
}

async function bytes(blob: Blob): Promise<number[]> {
	return [...new Uint8Array(await blob.arrayBuffer())];
}

afterEach(() => vi.restoreAllMocks());

describe("autosave", () => {
	it("keeps photos in their own store and the document without them", async () => {
		const db = freshDb();
		const store = createAutosaveStore(db);
		const ws = workspace([asset(1), asset(2)]);
		await store.write({ workspace: ws, fileName: "a.coatworkspace" });

		expect(((await rawGet(db, "assets")) as string[]).sort()).toEqual([
			"sha1",
			"sha2",
		]);
		const doc = (await rawGet(db, "autosave", "current")) as {
			version: number;
			workspace: { datasets: string[] };
		};
		expect(doc.version).toBe(3);
		expect(doc.workspace.datasets).toEqual(["d_1"]);
		const stored = (await rawGet(db, "autosave", "dataset:d_1")) as Dataset;
		expect(stored.assets[0]).toEqual({
			sha256: "sha1",
			contentType: "image/png",
			name: "p1.png",
			size: 3,
		});

		const read = await createAutosaveStore(db).read();
		expect(read?.fileName).toBe("a.coatworkspace");
		const back = read?.workspace.datasets[0]?.assets ?? [];
		expect(back.map((a) => a.sha256)).toEqual(["sha1", "sha2"]);
		expect(await bytes(back[1]?.blob as Blob)).toEqual([2, 2, 2]);
		expect(read?.missingAssets).toBeUndefined();
	});

	it("writes each photo once and skips a workspace it already wrote", async () => {
		const db = freshDb();
		const store = createAutosaveStore(db);
		const put = vi.spyOn(IDBObjectStore.prototype, "put");
		const ws = workspace([asset(1)]);
		await store.write({ workspace: ws, fileName: "a" });
		expect(put).toHaveBeenCalledTimes(3);
		await store.write({ workspace: { ...ws }, fileName: "a" });
		expect(put).toHaveBeenCalledTimes(3);
		const more = workspace([asset(1), asset(3)]);
		await store.write({ workspace: more, fileName: "a" });
		// the new photo, the dataset and the shell, not the old photo again
		expect(put).toHaveBeenCalledTimes(6);
	});

	it("deletes photos no workspace references after a write", async () => {
		const db = freshDb();
		const store = createAutosaveStore(db);
		await store.write({
			workspace: workspace([asset(1), asset(2)]),
			fileName: "a",
		});
		await store.write({ workspace: workspace([asset(2)]), fileName: "a" });
		expect(await rawGet(db, "assets")).toEqual(["sha2"]);
		await store.clear();
		expect(await rawGet(db, "assets")).toEqual([]);
		expect(await store.read()).toBeNull();
	});

	it("keeps the document when storage is full, says so once, and retries", async () => {
		const db = freshDb();
		const onStorageFull = vi.fn();
		const store = createAutosaveStore(db, { onStorageFull });
		const realPut = IDBObjectStore.prototype.put;
		let full = true;
		vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
			this: IDBObjectStore,
			value: unknown,
			key?: IDBValidKey,
		) {
			if (full && this.name === "assets")
				throw new DOMException("full", "QuotaExceededError");
			return realPut.call(this, value, key);
		});

		const ws = workspace([asset(1), asset(2)]);
		await store.write({ workspace: ws, fileName: "a" });
		await store.write({
			workspace: workspace([asset(1), asset(2), asset(3)]),
			fileName: "a",
		});
		expect(onStorageFull).toHaveBeenCalledTimes(1);
		const read = await store.read();
		expect(read?.workspace.templates).toHaveLength(1);
		expect(read?.workspace.datasets[0]?.records).toHaveLength(3);
		expect(read?.missingAssets).toBe(3);

		full = false;
		const last = workspace([asset(1), asset(2), asset(3)]);
		await store.write({ workspace: last, fileName: "a" });
		expect(((await rawGet(db, "assets")) as string[]).sort()).toEqual([
			"sha1",
			"sha2",
			"sha3",
		]);
		expect((await store.read())?.missingAssets).toBeUndefined();

		full = true;
		await store.write({ workspace: workspace([asset(4)]), fileName: "a" });
		expect(onStorageFull).toHaveBeenCalledTimes(2);
	});

	it("reads a phase 2 autosave with bytes inline and rewrites it on the next save", async () => {
		const db = freshDb();
		// What phase 2 wrote: version 1 of the database, one store.
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open(db, 1);
			req.onupgradeneeded = () => req.result.createObjectStore("autosave");
			req.onsuccess = () => {
				const tx = req.result.transaction("autosave", "readwrite");
				const ws = workspace([]);
				tx.objectStore("autosave").put(
					{
						workspace: {
							...ws,
							datasets: [
								{
									...ws.datasets[0],
									assets: [
										{
											sha256: "old",
											contentType: "image/png",
											name: "old.png",
											bytes: new Uint8Array([7, 7]),
										},
									],
								},
							],
						},
						fileName: "old.coatworkspace",
						savedAt: 1,
					},
					"current",
				);
				tx.oncomplete = () => {
					req.result.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
		});

		const store = createAutosaveStore(db);
		const read = await store.read();
		const old = read?.workspace.datasets[0]?.assets[0];
		expect(old).toMatchObject({ sha256: "old", size: 2, name: "old.png" });
		expect(await bytes(old?.blob as Blob)).toEqual([7, 7]);
		expect("bytes" in (old ?? {})).toBe(false);

		await store.write({
			workspace: read?.workspace as Workspace,
			fileName: read?.fileName as string,
		});
		const doc = (await rawGet(db, "autosave", "current")) as {
			version: number;
		};
		expect(doc.version).toBe(3);
		const stored = (await rawGet(db, "autosave", "dataset:d_1")) as Dataset;
		expect(stored.assets[0]).toEqual({
			sha256: "old",
			contentType: "image/png",
			name: "old.png",
			size: 2,
		});
		expect(await rawGet(db, "assets")).toEqual(["old"]);
	});

	it("reads a phase 1 autosave of one template", async () => {
		const db = freshDb();
		await new Promise<void>((resolve) => {
			const req = indexedDB.open(db, 1);
			req.onupgradeneeded = () => req.result.createObjectStore("autosave");
			req.onsuccess = () => {
				const tx = req.result.transaction("autosave", "readwrite");
				tx.objectStore("autosave").put(
					{ template: docFixture(), fileName: "x.coat", savedAt: 1 },
					"current",
				);
				tx.oncomplete = () => {
					req.result.close();
					resolve();
				};
			};
		});
		const read = await createAutosaveStore(db).read();
		expect(read?.workspace.templates[0]?.fileName).toBe("x.coat");
	});

	it("rewrites only the shell when a template changes", async () => {
		const db = freshDb();
		const store = createAutosaveStore(db);
		const ws = workspace([asset(1)]);
		await store.write({ workspace: ws, fileName: "a" });
		const put = vi.spyOn(IDBObjectStore.prototype, "put");
		const getAllKeys = vi.spyOn(IDBObjectStore.prototype, "getAllKeys");
		const edited: Workspace = {
			...ws,
			templates: [{ id: "t_1", fileName: "a.coat", template: docFixture() }],
		};
		await store.write({ workspace: edited, fileName: "a" });
		expect(put.mock.calls.map((c) => c[1])).toEqual(["current"]);
		expect(getAllKeys).not.toHaveBeenCalled();
		const read = await createAutosaveStore(db).read();
		expect(read?.workspace.datasets[0]?.records).toHaveLength(1);
		expect(read?.workspace.templates[0]?.template).toEqual(
			edited.templates[0]?.template,
		);
	});

	it("deletes the key of a removed dataset", async () => {
		const db = freshDb();
		const ws = workspace([asset(1)]);
		const second: Dataset = {
			...(ws.datasets[0] as Dataset),
			id: "d_2",
			assets: [],
			records: [],
		};
		await createAutosaveStore(db).write({
			workspace: { ...ws, datasets: [...ws.datasets, second] },
			fileName: "a",
		});
		expect(((await rawGet(db, "autosave")) as string[]).sort()).toEqual([
			"current",
			"dataset:d_1",
			"dataset:d_2",
		]);
		// A new session, which learns the keys from the store.
		await createAutosaveStore(db).write({
			workspace: { ...ws, datasets: [second] },
			fileName: "a",
		});
		expect(((await rawGet(db, "autosave")) as string[]).sort()).toEqual([
			"current",
			"dataset:d_2",
		]);
		expect(await rawGet(db, "assets")).toEqual([]);
		const read = await createAutosaveStore(db).read();
		expect(read?.workspace.datasets.map((d) => d.id)).toEqual(["d_2"]);
	});

	it("reads a single-record autosave and migrates it", async () => {
		const db = freshDb();
		const ws = workspace([asset(1)]);
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open(db, 2);
			req.onupgradeneeded = () => {
				req.result.createObjectStore("autosave");
				req.result.createObjectStore("assets");
			};
			req.onsuccess = () => {
				const tx = req.result.transaction(["autosave", "assets"], "readwrite");
				tx.objectStore("assets").put(asset(1).blob, "sha1");
				tx.objectStore("autosave").put(
					{
						version: 2,
						workspace: {
							...ws,
							datasets: ws.datasets.map((d) => ({
								...d,
								assets: d.assets.map(({ blob: _b, ...meta }) => meta),
							})),
						},
						fileName: "old.coatworkspace",
						savedAt: 5,
					},
					"current",
				);
				tx.oncomplete = () => {
					req.result.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
		});

		const read = await createAutosaveStore(db).read();
		expect(read?.fileName).toBe("old.coatworkspace");
		expect(read?.savedAt).toBe(5);
		expect(read?.workspace.datasets[0]?.records).toHaveLength(1);
		expect(read?.workspace.datasets[0]?.assets[0]?.sha256).toBe("sha1");
		expect(read?.missingAssets).toBeUndefined();

		const doc = (await rawGet(db, "autosave", "current")) as {
			version: number;
			savedAt: number;
			workspace: { datasets: string[] };
		};
		expect(doc).toMatchObject({ version: 3, savedAt: 5 });
		expect(doc.workspace.datasets).toEqual(["d_1"]);
		const again = await createAutosaveStore(db).read();
		expect(again?.workspace).toEqual(read?.workspace);
	});

	it("rewrites its datasets after another tab writes over them", async () => {
		const db = freshDb();
		const tabA = createAutosaveStore(db, { tabId: "A" });
		const tabB = createAutosaveStore(db, { tabId: "B" });
		const ws = workspace([asset(1)]);
		await tabA.write({ workspace: ws, fileName: "a" });
		const other = workspace([asset(2)]);
		await tabB.write({
			workspace: {
				...other,
				datasets: [{ ...(other.datasets[0] as Dataset), id: "d_b" }],
			},
			fileName: "b",
		});
		expect(await rawGet(db, "autosave", "dataset:d_1")).toBeUndefined();

		const edited: Workspace = {
			...ws,
			templates: [{ id: "t_1", fileName: "a.coat", template: docFixture() }],
		};
		await tabA.write({ workspace: edited, fileName: "a" });
		expect(((await rawGet(db, "autosave")) as string[]).sort()).toEqual([
			"current",
			"dataset:d_1",
		]);

		const read = await createAutosaveStore(db).read();
		expect(read?.fileName).toBe("a");
		expect(read?.workspace.datasets.map((d) => d.id)).toEqual(["d_1"]);
		expect(read?.workspace.datasets[0]?.records).toHaveLength(1);
		expect(read?.missingDatasets).toBeUndefined();
		expect(read?.missingAssets).toBeUndefined();
	});

	it("restores the rest and says so when a dataset is missing", async () => {
		const db = freshDb();
		const ws = workspace([asset(1)]);
		const second: Dataset = {
			...(ws.datasets[0] as Dataset),
			id: "d_2",
			assets: [],
			records: [],
		};
		await createAutosaveStore(db).write({
			workspace: { ...ws, datasets: [...ws.datasets, second] },
			fileName: "a",
		});
		const raw = await openRaw(db);
		await new Promise<void>((resolve) => {
			const tx = raw.transaction("autosave", "readwrite");
			tx.objectStore("autosave").delete("dataset:d_1");
			tx.oncomplete = () => resolve();
		});
		raw.close();

		const read = await createAutosaveStore(db).read();
		expect(read?.workspace.datasets.map((d) => d.id)).toEqual(["d_2"]);
		expect(read?.missingDatasets).toBe(1);
		expect(restoreNotices(read as Autosave)).toEqual([
			"1 dataset wasn't autosaved. Import it again in Data.",
		]);
	});

	it("reopens after another tab deletes the database", async () => {
		const db = freshDb();
		const store = createAutosaveStore(db);
		await store.write({ workspace: workspace([asset(1)]), fileName: "a" });
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.deleteDatabase(db);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
		await store.write({ workspace: workspace([asset(1)]), fileName: "b" });
		const read = await store.read();
		expect(read?.fileName).toBe("b");
		expect(read?.workspace.datasets[0]?.records).toHaveLength(1);
		expect(read?.missingAssets).toBeUndefined();
	});
});
