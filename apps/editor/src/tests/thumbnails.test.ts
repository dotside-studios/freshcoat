import type { DatasetAsset } from "@freshcoat/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lru } from "~/data/lru";
import {
	previewEdge,
	previewImage,
	referencedAssets,
	requestThumbnail,
	setThumbnailBackend,
	THUMBNAIL_LIMITS,
	thumbnailStats,
	thumbnailUrl,
} from "~/data/thumbnails";

describe("Lru", () => {
	it("evicts the least recently used past the entry bound", () => {
		const evicted: string[] = [];
		const lru = new Lru<string, number>({
			maxEntries: 3,
			onEvict: (k) => evicted.push(k),
		});
		lru.set("a", 1);
		lru.set("b", 2);
		lru.set("c", 3);
		expect(lru.get("a")).toBe(1);
		lru.set("d", 4);
		expect(evicted).toEqual(["b"]);
		expect(lru.keys()).toEqual(["c", "a", "d"]);
		// peek does not refresh
		lru.peek("c");
		lru.set("e", 5);
		expect(evicted).toEqual(["b", "c"]);
	});

	it("evicts past the size bound, keeping the newest even if it alone is over", () => {
		const evicted: string[] = [];
		const lru = new Lru<string, number>({
			maxEntries: 100,
			maxSize: 10,
			sizeOf: (v) => v,
			onEvict: (k) => evicted.push(k),
		});
		lru.set("a", 4);
		lru.set("b", 4);
		expect(lru.totalSize).toBe(8);
		lru.set("c", 4);
		expect(evicted).toEqual(["a"]);
		expect(lru.totalSize).toBe(8);
		lru.set("big", 50);
		expect(lru.keys()).toEqual(["big"]);
		expect(lru.totalSize).toBe(50);
	});

	it("tells onEvict about replaced, deleted and cleared entries", () => {
		const evicted: [string, number][] = [];
		const lru = new Lru<string, number>({
			maxEntries: 5,
			onEvict: (k, v) => evicted.push([k, v]),
		});
		lru.set("a", 1);
		lru.set("a", 2);
		lru.set("b", 3);
		lru.delete("b");
		lru.clear();
		expect(evicted).toEqual([
			["a", 1],
			["b", 3],
			["a", 2],
		]);
		expect(lru.size).toBe(0);
	});
});

function asset(n: number, extra: Partial<DatasetAsset> = {}): DatasetAsset {
	return {
		sha256: `sha${n}`,
		contentType: "image/jpeg",
		name: `p${n}.jpg`,
		size: 10,
		width: 6000,
		height: 4000,
		blob: new Blob([new Uint8Array([n])]),
		...extra,
	};
}

describe("thumbnails", () => {
	let urls = 0;
	const revoked: string[] = [];
	const backend = vi.fn(
		async (_req: { blob: Blob; maxWidth?: number }): Promise<Blob> =>
			new Blob([new Uint8Array(1024)], { type: "image/webp" }),
	);

	beforeEach(() => {
		urls = 0;
		revoked.length = 0;
		backend.mockReset();
		backend.mockImplementation(
			async () => new Blob([new Uint8Array(1024)], { type: "image/webp" }),
		);
		URL.createObjectURL = vi.fn(() => `blob:thumb-${++urls}`);
		URL.revokeObjectURL = vi.fn((url: string) => {
			revoked.push(url);
		});
		setThumbnailBackend(backend);
	});

	afterEach(() => setThumbnailBackend(null));

	it("makes a thumbnail once per photo and width", async () => {
		const a = asset(1, { orientation: 6 });
		const url = await thumbnailUrl(a, 160);
		expect(url).toBe("blob:thumb-1");
		expect(await thumbnailUrl(a, 160)).toBe(url);
		expect(backend).toHaveBeenCalledTimes(1);
		// The size it plans from is the photo as seen, turned by orientation 6.
		expect(backend.mock.calls[0]?.[0]).toMatchObject({
			kind: "thumb",
			maxWidth: 160,
			width: 4000,
			height: 6000,
		});
		await thumbnailUrl(a, 320);
		expect(backend).toHaveBeenCalledTimes(2);
	});

	it("keeps at most 600 and revokes the URLs it evicts", async () => {
		const all: Promise<string>[] = [];
		for (let i = 0; i < THUMBNAIL_LIMITS.entries + 5; i++)
			all.push(thumbnailUrl(asset(i), 160));
		await Promise.all(all);
		expect(thumbnailStats().entries).toBe(THUMBNAIL_LIMITS.entries);
		expect(revoked).toHaveLength(5);
	});

	it("keeps at most 64 MB of encoded thumbnails", async () => {
		backend.mockImplementation(
			async () =>
				new Blob([new Uint8Array(1024 * 1024)], { type: "image/webp" }),
		);
		for (let i = 0; i < 70; i++) await thumbnailUrl(asset(i), 640);
		expect(thumbnailStats().bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
		expect(thumbnailStats().entries).toBe(64);
		expect(revoked).toHaveLength(6);
	});

	it("never makes a thumbnail nobody waits for any more", async () => {
		const resolvers: (() => void)[] = [];
		backend.mockImplementation(
			() =>
				new Promise<Blob>((resolve) => {
					resolvers.push(() => resolve(new Blob([new Uint8Array(4)])));
				}),
		);
		// Two are made at once; the third waits, and is withdrawn.
		const first = thumbnailUrl(asset(1), 160);
		const second = thumbnailUrl(asset(2), 160);
		const cancel = requestThumbnail(asset(3), 160, () => {});
		expect(backend).toHaveBeenCalledTimes(2);
		cancel();
		for (const resolve of resolvers) resolve();
		await Promise.all([first, second]);
		await new Promise((r) => setTimeout(r, 0));
		expect(backend).toHaveBeenCalledTimes(2);
	});

	it("a request for one being made waits for it, so no shown URL is revoked", async () => {
		const resolvers: (() => void)[] = [];
		backend.mockImplementation(
			() =>
				new Promise<Blob>((resolve) => {
					resolvers.push(() => resolve(new Blob([new Uint8Array(4)])));
				}),
		);
		const a = asset(1);
		// A surface asks, and unmounts while the thumbnail is being made; its
		// replacement asks again.
		const withdraw = requestThumbnail(a, 640, () => {});
		withdraw();
		const again = thumbnailUrl(a, 640);
		expect(backend).toHaveBeenCalledTimes(1);
		for (const resolve of resolvers) resolve();
		const url = await again;
		expect(url).toBe("blob:thumb-1");
		await new Promise((r) => setTimeout(r, 0));
		expect(backend).toHaveBeenCalledTimes(1);
		expect(await thumbnailUrl(a, 640)).toBe(url);
		expect(revoked).toEqual([]);
	});

	it("decodes previews at the preview edge and keeps the last eight", async () => {
		const big = asset(1);
		await previewImage(big, 2048);
		expect(backend).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "preview", maxEdge: 2048 }),
		);
		await previewImage(big, 2048);
		expect(backend).toHaveBeenCalledTimes(1);
		for (let i = 2; i <= 9; i++) await previewImage(asset(i), 2048);
		await previewImage(big, 2048);
		expect(backend).toHaveBeenCalledTimes(10);
	});

	it("uses a photo already small enough as it is", async () => {
		const small = asset(5, { width: 800, height: 600 });
		const bytes = await previewImage(small, 2048);
		expect([...bytes]).toEqual([5]);
		expect(backend).not.toHaveBeenCalled();
	});

	it("sizes the preview edge from the window and the pixel ratio", () => {
		expect(previewEdge({ width: 1440, height: 900 }, 1)).toBe(2048);
		expect(previewEdge({ width: 1440, height: 900 }, 2)).toBe(4096);
		expect(previewEdge({ width: 3000, height: 900 }, 1)).toBe(3000);
		expect(previewEdge({ width: 3000, height: 900 }, 3)).toBe(4096);
	});

	it("finds the photos a record's values show", () => {
		const assets = [asset(1), asset(2)];
		expect(
			referencedAssets(assets, {
				a: "ws:sha2",
				b: "ws:sha2",
				c: "ws:missing",
				d: "text",
			}).map((a) => a.sha256),
		).toEqual(["sha2"]);
	});
});
