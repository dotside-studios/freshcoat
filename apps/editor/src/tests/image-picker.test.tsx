import type { DatasetAsset } from "@freshcoat-js/workspace";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePicker } from "~/data/cells";
import {
	setThumbnailBackend,
	THUMBNAIL_LIMITS,
	thumbnailStats,
	thumbnailUrl,
	useThumbnail,
} from "~/data/thumbnails";

function asset(n: number): DatasetAsset {
	return {
		sha256: `sha${n}`,
		contentType: "image/jpeg",
		name: `p${n}.jpg`,
		size: 10,
		width: 600,
		height: 400,
		blob: new Blob([new Uint8Array([n % 256])]),
	};
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

let urls = 0;
const revoked = new Set<string>();
const backend = vi.fn(
	async (_req: { blob: Blob }): Promise<Blob> => new Blob([new Uint8Array(4)]),
);
let restore: (() => void)[] = [];

beforeEach(() => {
	urls = 0;
	revoked.clear();
	backend.mockClear();
	URL.createObjectURL = vi.fn(() => `blob:thumb-${++urls}`);
	URL.revokeObjectURL = vi.fn((url: string) => {
		revoked.add(url);
	});
	setThumbnailBackend(backend);
	// jsdom lays nothing out; the virtualizer needs a viewport to fill.
	const w = vi
		.spyOn(HTMLElement.prototype, "offsetWidth", "get")
		.mockImplementation(() => 272);
	const h = vi
		.spyOn(HTMLElement.prototype, "offsetHeight", "get")
		.mockImplementation(() => 240);
	restore = [() => w.mockRestore(), () => h.mockRestore()];
});

afterEach(() => {
	cleanup();
	for (const r of restore) r();
	setThumbnailBackend(null);
});

const tiles = () => document.querySelectorAll("button[aria-label$='.jpg']");
const shownUrls = () =>
	[...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));

describe("ImagePicker", () => {
	it("mounts and asks thumbnails for the rows in view only", async () => {
		const assets = Array.from({ length: 2000 }, (_, i) => asset(i));
		render(
			<ImagePicker
				dataset={{ assets }}
				importPhotos={() => {}}
				value=""
				onPick={() => {}}
			/>,
		);
		for (let i = 0; i < 20; i++) await settle();
		expect(tiles().length).toBeGreaterThan(0);
		expect(tiles().length).toBeLessThanOrEqual(40);
		expect(backend.mock.calls.length).toBe(tiles().length);
		expect(screen.getByRole("button", { name: "p0.jpg" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "p1999.jpg" })).toBeNull();
	});

	it("filters, and picks a photo by its reference", async () => {
		const assets = Array.from({ length: 2000 }, (_, i) => asset(i));
		const onPick = vi.fn();
		render(
			<ImagePicker
				dataset={{ assets }}
				importPhotos={() => {}}
				value=""
				onPick={onPick}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Filter photos"), {
			target: { value: "p1999" },
		});
		await settle();
		expect(tiles()).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "p1999.jpg" }));
		expect(onPick).toHaveBeenCalledWith("ws:sha1999");
	});

	it("never revokes a thumbnail it shows, however many others are made", async () => {
		const assets = Array.from({ length: 2000 }, (_, i) => asset(i));
		render(
			<ImagePicker
				dataset={{ assets }}
				importPhotos={() => {}}
				value=""
				onPick={() => {}}
			/>,
		);
		for (let i = 0; i < 20; i++) await settle();
		const shown = shownUrls();
		expect(shown.length).toBe(tiles().length);
		await act(async () => {
			const others: Promise<string>[] = [];
			for (let i = 0; i < THUMBNAIL_LIMITS.entries + 50; i++)
				others.push(thumbnailUrl(asset(10_000 + i), 160));
			await Promise.all(others);
		});
		expect(shown.filter((url) => url && revoked.has(url))).toEqual([]);
		expect(shownUrls()).toEqual(shown);
	});
});

describe("useThumbnail", () => {
	it("holds its thumbnail in the cache while mounted, and lets it go after", async () => {
		const a = asset(1);
		const { result, unmount } = renderHook(() => useThumbnail(a));
		await settle();
		const url = result.current;
		expect(url).toBe("blob:thumb-1");
		for (let i = 0; i < THUMBNAIL_LIMITS.entries + 5; i++)
			await thumbnailUrl(asset(100 + i), 160);
		expect(revoked.has(url as string)).toBe(false);
		expect(thumbnailStats().entries).toBe(THUMBNAIL_LIMITS.entries);
		unmount();
		await thumbnailUrl(asset(5000), 160);
		expect(revoked.has(url as string)).toBe(true);
	});
});
