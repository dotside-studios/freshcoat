// @vitest-environment node
import "fake-indexeddb/auto";
import { subtleSha256 } from "@freshcoat-js/coatfile";
import type { DatasetAsset, Workspace } from "@freshcoat-js/workspace";
import { unpackWorkspace } from "@freshcoat-js/workspace/archive";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createAutosaveStore } from "~/app/autosave";
import { EditorController } from "~/app/controller";
import * as download from "~/app/download";
import {
	createSourceAssets,
	reportSourceChanged,
	SourceChangedError,
	stopSourceAssets,
	trackSourceAssets,
} from "~/app/source-assets";
import { singleTemplateWorkspace } from "~/state/workspace";
import { doc } from "./doc-fixture";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@freshcoat-js/ui/toast", async (actual) => ({
	...(await actual<object>()),
	toast,
}));

vi.stubGlobal("requestAnimationFrame", () => 0);

afterEach(() => {
	stopSourceAssets();
	vi.restoreAllMocks();
	toast.mockClear();
});

/** A slice of a picked file: readable until the file changes on disk. */
class FileSlice extends Blob {
	changed = false;

	private check(): void {
		if (this.changed)
			throw new DOMException("the file changed", "NotReadableError");
	}

	override async arrayBuffer(): Promise<ArrayBuffer> {
		this.check();
		return super.arrayBuffer();
	}

	override async text(): Promise<string> {
		this.check();
		return super.text();
	}

	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		this.check();
		return super.stream();
	}

	override slice(start?: number, end?: number, type?: string): Blob {
		this.check();
		return super.slice(start, end, type);
	}
}

async function photo(text: string): Promise<{
	asset: DatasetAsset;
	source: FileSlice;
	bytes: Uint8Array;
}> {
	const bytes = new TextEncoder().encode(text);
	const source = new FileSlice([bytes as BlobPart], { type: "image/png" });
	return {
		asset: {
			sha256: await subtleSha256(bytes),
			contentType: "image/png",
			name: `${text}.png`,
			size: bytes.length,
			blob: source,
		},
		source,
		bytes,
	};
}

function workspaceOf(assets: DatasetAsset[]): Workspace {
	const ws = singleTemplateWorkspace(doc(), "a.coat");
	ws.datasets = [
		{ id: "d1", name: "People", columns: [], records: [], assets },
	];
	return ws;
}

const never = () => {};

async function bytesOf(blob: Blob): Promise<string> {
	return new TextDecoder().decode(await blob.arrayBuffer());
}

describe("copying a workspace's photos off its file", () => {
	test("photos copied in the background stay readable after the file changes", async () => {
		const a = await photo("alpha");
		const b = await photo("beta");
		const ws = workspaceOf([a.asset, b.asset]);
		const saved = { ...ws };
		const copies = createSourceAssets(ws, {
			fileName: "w.coatworkspace",
			schedule: (task) => task(),
		});
		await copies.done;
		a.source.changed = true;
		b.source.changed = true;
		expect(copies.pending).toBe(0);
		expect(saved.datasets[0]?.assets[0]).toBe(a.asset);
		expect(a.asset.blob).not.toBe(a.source);
		expect(a.asset.blob.type).toBe("image/png");
		expect(await bytesOf(a.asset.blob)).toBe("alpha");
		expect(await bytesOf(b.asset.blob)).toBe("beta");
	});

	test("prefers autosave's copy over reading the file", async () => {
		const a = await photo("alpha");
		const stored = new Blob(["alpha"], { type: "image/png" });
		const read = vi.spyOn(a.source, "arrayBuffer");
		const copies = createSourceAssets(workspaceOf([a.asset]), {
			fileName: "w.coatworkspace",
			keep: async () => stored,
			schedule: (task) => task(),
		});
		await copies.done;
		expect(a.asset.blob).toBe(stored);
		expect(read).not.toHaveBeenCalled();
	});

	test("a read before the copy falls back to autosave's copy", async () => {
		const a = await photo("alpha");
		const stored = new Blob(["alpha"], { type: "image/png" });
		const copies = createSourceAssets(workspaceOf([a.asset]), {
			fileName: "w.coatworkspace",
			keep: async (x) => (x.sha256 === a.asset.sha256 ? stored : null),
			schedule: never,
		});
		a.source.changed = true;
		await expect(a.asset.blob.arrayBuffer()).rejects.toThrow();
		expect(await copies.recover(a.asset)).toBe(true);
		expect(a.asset.blob).toBe(stored);
		expect(copies.pending).toBe(0);
		expect(await copies.recover(a.asset)).toBe(false);
	});

	test("without a copy, says to reopen the file, once", async () => {
		const a = await photo("alpha");
		const b = await photo("beta");
		const onChanged = vi.fn();
		const copies = createSourceAssets(workspaceOf([a.asset, b.asset]), {
			fileName: "w.coatworkspace",
			keep: async () => null,
			schedule: never,
			onChanged,
		});
		a.source.changed = true;
		b.source.changed = true;
		await expect(copies.recover(a.asset)).rejects.toBeInstanceOf(
			SourceChangedError,
		);
		await expect(copies.recover(b.asset)).rejects.toThrow(/Reopen the file/);
		expect(onChanged).toHaveBeenCalledOnce();
		expect(onChanged.mock.calls[0]?.[0].message).toMatch(
			/^w\.coatworkspace changed on disk/,
		);
		expect(a.asset.blob).toBe(a.source);
		expect(copies.pending).toBe(2);
	});

	test("a copy that lands after stop is not swapped in", async () => {
		const a = await photo("alpha");
		const tasks: (() => void)[] = [];
		const copies = createSourceAssets(workspaceOf([a.asset]), {
			fileName: "w.coatworkspace",
			schedule: (task) => tasks.push(task),
		});
		copies.stop();
		for (const task of tasks) task();
		await copies.done;
		expect(a.asset.blob).toBe(a.source);
	});
});

describe("saving a workspace whose file changed", () => {
	function open(ws: Workspace, backup: (sha: string) => Promise<Blob | null>) {
		const controller = new EditorController();
		controller.openWorkspace(ws, "w.coatworkspace");
		trackSourceAssets(ws, {
			fileName: "w.coatworkspace",
			keep: (x) => backup(x.sha256),
			schedule: never,
		});
		return controller;
	}

	test("refuses to save when a photo can no longer be read", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const a = await photo("alpha");
		const b = await photo("beta");
		const stored = new Blob(["alpha"], { type: "image/png" });
		const controller = open(workspaceOf([a.asset, b.asset]), async (sha) =>
			sha === a.asset.sha256 ? stored : null,
		);
		a.source.changed = true;
		b.source.changed = true;
		expect(await controller.saveWorkspace()).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(controller.dirty).toBe(false);
		expect(toast).toHaveBeenCalledWith(
			expect.stringMatching(
				/^Couldn't save the workspace: w\.coatworkspace changed on disk since it was opened, so 1 photo can no longer be read\. Reopen the file/,
			),
			{ tone: "danger" },
		);
	});

	test("saves every photo from its copy once the file changed", async () => {
		let written: Blob | null = null;
		vi.spyOn(download, "downloadBytes").mockImplementation(async (data) => {
			written = data as Blob;
		});
		const a = await photo("alpha");
		const b = await photo("beta");
		const ws = workspaceOf([a.asset, b.asset]);
		const stored = new Map([
			[a.asset.sha256, new Blob(["alpha"], { type: "image/png" })],
			[b.asset.sha256, new Blob(["beta"], { type: "image/png" })],
		]);
		const controller = open(ws, async (sha) => stored.get(sha) ?? null);
		a.source.changed = true;
		b.source.changed = true;
		expect(await controller.saveWorkspace()).toBe(true);
		expect(written).not.toBeNull();
		const out = await unpackWorkspace(
			new Uint8Array(await (written as unknown as Blob).arrayBuffer()),
		);
		if (!out.ok) throw new Error(out.message);
		const assets = out.workspace.datasets[0]?.assets ?? [];
		expect(assets.map((x) => x.name).sort()).toEqual(["alpha.png", "beta.png"]);
		for (const x of assets)
			expect(await bytesOf(x.blob)).toBe(x.name.replace(".png", ""));
	});

	test("copies photos still readable before packing, leaving none on the file", async () => {
		let written: Blob | null = null;
		vi.spyOn(download, "downloadBytes").mockImplementation(async (data) => {
			written = data as Blob;
		});
		const a = await photo("alpha");
		const controller = open(workspaceOf([a.asset]), async () => null);
		expect(await controller.saveWorkspace()).toBe(true);
		expect(a.asset.blob).not.toBe(a.source);
		a.source.changed = true;
		const out = await unpackWorkspace(
			new Uint8Array(await (written as unknown as Blob).arrayBuffer()),
		);
		if (!out.ok) throw new Error(out.message);
		expect(
			await bytesOf(out.workspace.datasets[0]?.assets[0]?.blob as Blob),
		).toBe("alpha");
	});
});

let dbCount = 0;
const freshDb = () => `source-assets-test-${++dbCount}`;

/** Fails a put of a changed slice the way a browser does. */
function refuseChangedPuts(): void {
	const realPut = IDBObjectStore.prototype.put;
	vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
		this: IDBObjectStore,
		value: unknown,
		key?: IDBValidKey,
	) {
		if (value instanceof FileSlice && value.changed)
			throw new DOMException("the file changed", "NotReadableError");
		return realPut.call(this, value, key);
	});
}

async function storedKeys(name: string): Promise<string[]> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(name);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	try {
		return await new Promise((resolve) => {
			const req = db.transaction("assets").objectStore("assets").getAllKeys();
			req.onsuccess = () => resolve(req.result.map(String));
		});
	} finally {
		db.close();
	}
}

describe("copying a workspace's photos into storage", () => {
	test("swaps in the stored copy without reading the file into memory", async () => {
		const name = freshDb();
		const store = createAutosaveStore(name);
		const a = await photo("alpha");
		const b = await photo("beta");
		const readA = vi.spyOn(a.source, "arrayBuffer");
		const readB = vi.spyOn(b.source, "arrayBuffer");
		const copies = createSourceAssets(workspaceOf([a.asset, b.asset]), {
			fileName: "w.coatworkspace",
			keep: store.keep,
			schedule: (task) => task(),
		});
		await copies.done;
		a.source.changed = true;
		b.source.changed = true;
		expect(copies.pending).toBe(0);
		expect(readA).not.toHaveBeenCalled();
		expect(readB).not.toHaveBeenCalled();
		expect(a.asset.blob).not.toBeInstanceOf(FileSlice);
		expect((await storedKeys(name)).sort()).toEqual(
			[a.asset.sha256, b.asset.sha256].sort(),
		);
		expect(await bytesOf(a.asset.blob)).toBe("alpha");
		expect(await bytesOf(b.asset.blob)).toBe("beta");
	});

	test("does not put a photo autosave already stored", async () => {
		const name = freshDb();
		const store = createAutosaveStore(name);
		const a = await photo("alpha");
		const ws = workspaceOf([a.asset]);
		await store.write({ workspace: ws, fileName: "w.coatworkspace" });
		const put = vi.spyOn(IDBObjectStore.prototype, "put");
		const copies = createSourceAssets(ws, {
			fileName: "w.coatworkspace",
			keep: store.keep,
			schedule: (task) => task(),
		});
		await copies.done;
		expect(put).not.toHaveBeenCalled();
		expect(a.asset.blob).not.toBeInstanceOf(FileSlice);
	});

	test("copies into memory when storage is unavailable", async () => {
		const real = globalThis.indexedDB;
		vi.stubGlobal("indexedDB", undefined);
		try {
			const store = createAutosaveStore(freshDb());
			const a = await photo("alpha");
			const read = vi.spyOn(a.source, "arrayBuffer");
			const copies = createSourceAssets(workspaceOf([a.asset]), {
				fileName: "w.coatworkspace",
				keep: store.keep,
				schedule: (task) => task(),
			});
			await copies.done;
			a.source.changed = true;
			expect(read).toHaveBeenCalledOnce();
			expect(a.asset.blob).not.toBe(a.source);
			expect(await bytesOf(a.asset.blob)).toBe("alpha");
		} finally {
			vi.stubGlobal("indexedDB", real);
		}
	});

	test("saves after the file changes once the photos are stored", async () => {
		let written: Blob | null = null;
		vi.spyOn(download, "downloadBytes").mockImplementation(async (data) => {
			written = data as Blob;
		});
		const store = createAutosaveStore(freshDb());
		const a = await photo("alpha");
		const ws = workspaceOf([a.asset]);
		const controller = new EditorController();
		controller.openWorkspace(ws, "w.coatworkspace");
		await trackSourceAssets(ws, {
			fileName: "w.coatworkspace",
			keep: store.keep,
			schedule: (task) => task(),
		}).done;
		a.source.changed = true;
		expect(await controller.saveWorkspace()).toBe(true);
		const out = await unpackWorkspace(
			new Uint8Array(await (written as unknown as Blob).arrayBuffer()),
		);
		if (!out.ok) throw new Error(out.message);
		expect(
			await bytesOf(out.workspace.datasets[0]?.assets[0]?.blob as Blob),
		).toBe("alpha");
	});

	test("says the file changed when a photo cannot be stored or read", async () => {
		refuseChangedPuts();
		const store = createAutosaveStore(freshDb());
		const a = await photo("alpha");
		const onChanged = vi.fn();
		const copies = createSourceAssets(workspaceOf([a.asset]), {
			fileName: "w.coatworkspace",
			keep: store.keep,
			schedule: never,
			onChanged,
		});
		a.source.changed = true;
		await expect(copies.settle([a.asset])).rejects.toBeInstanceOf(
			SourceChangedError,
		);
		expect(onChanged).toHaveBeenCalledOnce();
		expect(a.asset.blob).toBe(a.source);
	});
});

describe("autosave with a photo that cannot be read", () => {
	test("keeps writing the document and says so once", async () => {
		refuseChangedPuts();
		const name = freshDb();
		const onUnreadable = vi.fn();
		const store = createAutosaveStore(name, { onUnreadable });
		const a = await photo("alpha");
		const b = await photo("beta");
		a.source.changed = true;
		const ws = workspaceOf([a.asset, b.asset]);
		await store.write({ workspace: ws, fileName: "w.coatworkspace" });
		expect(await storedKeys(name)).toEqual([b.asset.sha256]);
		let read = await store.read();
		expect(read?.workspace.datasets[0]?.assets).toHaveLength(1);
		expect(read?.missingAssets).toBe(1);

		await store.write({
			workspace: { ...ws, name: "Renamed" },
			fileName: "w.coatworkspace",
		});
		read = await store.read();
		expect(read?.workspace.name).toBe("Renamed");
		expect(onUnreadable).toHaveBeenCalledOnce();
		expect(onUnreadable).toHaveBeenCalledWith(a.asset);
	});

	test("reports through the tracked workspace's message", async () => {
		const a = await photo("alpha");
		const onChanged = vi.fn();
		trackSourceAssets(workspaceOf([a.asset]), {
			fileName: "w.coatworkspace",
			schedule: never,
			onChanged,
		});
		reportSourceChanged();
		reportSourceChanged();
		expect(onChanged).toHaveBeenCalledOnce();
		expect(onChanged.mock.calls[0]?.[0].message).toMatch(
			/^w\.coatworkspace changed on disk/,
		);
	});
});
