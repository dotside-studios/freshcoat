import { describe, expect, it } from "vitest";
import { createImageLru } from "~/export/image-lru";

function lru(max: number) {
	const freed: string[] = [];
	const cache = createImageLru<string>(max, (v) => freed.push(v));
	return { cache, freed };
}

describe("image LRU", () => {
	it("evicts the least recently used down to the pixel budget", () => {
		const { cache, freed } = lru(100);
		cache.set("a", "A", 40);
		cache.set("b", "B", 40);
		expect(cache.get("a")).toBe("A");
		cache.set("c", "C", 40);
		expect(freed).toEqual(["B"]);
		expect(cache.pixels).toBe(80);
		expect(cache.get("b")).toBeUndefined();
	});

	it("never evicts a pinned image, and lets it go once unpinned", () => {
		const { cache, freed } = lru(100);
		cache.pin(["a", "b"]);
		cache.set("a", "A", 80);
		cache.set("b", "B", 80);
		expect(freed).toEqual([]);
		expect(cache.pixels).toBe(160);
		cache.pin([]);
		expect(freed).toEqual(["A"]);
		expect(cache.size).toBe(1);
	});

	it("keeps an item's images while it renders over budget", () => {
		const { cache, freed } = lru(50);
		cache.set("logo", "L", 10);
		cache.pin(["photo"]);
		cache.set("photo", "P", 48);
		// the logo goes, not the photo in use
		expect(freed).toEqual(["L"]);
		expect(cache.get("photo")).toBe("P");
	});

	it("frees a replaced value and everything on clear", () => {
		const { cache, freed } = lru(100);
		cache.set("a", "A1", 10);
		cache.set("a", "A2", 10);
		cache.set("b", "B", 10);
		expect(freed).toEqual(["A1"]);
		cache.clear();
		expect(freed).toEqual(["A1", "A2", "B"]);
		expect(cache.pixels).toBe(0);
	});
});
