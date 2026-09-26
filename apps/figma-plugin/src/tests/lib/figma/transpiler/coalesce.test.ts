import { describe, expect, it } from "vitest";
import {
	dedupeFlattenMarkers,
	type FlattenMarker,
} from "~/lib/figma/transpiler/coalesce";

const marker = (
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	rotation = 0,
): FlattenMarker => ({
	nodeId: id,
	pos: { x, y },
	size: { width: w, height: h },
	reason: "vector_flattened",
	rotation,
});

describe("dedupeFlattenMarkers", () => {
	it("returns input unchanged when no overlaps", () => {
		const a = marker("a", 0, 0, 100, 100);
		const b = marker("b", 200, 0, 100, 100);
		expect(dedupeFlattenMarkers([a, b])).toEqual([a, b]);
	});

	it("keeps a marker whose box sits inside another marker's box", () => {
		// Sibling flatten regions are exported independently: the big one's bitmap
		// does NOT contain the small one's pixels, so dropping the small one on
		// geometry alone deletes a shape nothing else draws.
		const big = marker("big", 0, 0, 400, 400);
		const small = marker("small", 50, 50, 100, 100);
		expect(dedupeFlattenMarkers([big, small])).toEqual([big, small]);
		expect(dedupeFlattenMarkers([small, big])).toEqual([small, big]);
	});

	it("keeps every marker of a nested-looking stack", () => {
		const huge = marker("huge", 0, 0, 1000, 1000);
		const big = marker("big", 100, 100, 500, 500);
		const small = marker("small", 200, 200, 100, 100);
		expect(dedupeFlattenMarkers([huge, big, small])).toEqual([
			huge,
			big,
			small,
		]);
	});

	it("keeps identically-boxed markers from different nodes", () => {
		const a = marker("a", 0, 0, 100, 100);
		const b = marker("b", 0, 0, 100, 100);
		expect(dedupeFlattenMarkers([a, b])).toEqual([a, b]);
	});

	it("keeps overlapping markers when neither contains the other", () => {
		const a = marker("a", 0, 0, 100, 100);
		const b = marker("b", 50, 50, 100, 100);
		expect(dedupeFlattenMarkers([a, b])).toEqual([a, b]);
	});

	it("keeps markers with differing rotation", () => {
		const big = marker("big", 0, 0, 400, 400, 0);
		const small = marker("small", 50, 50, 100, 100, 45);
		expect(dedupeFlattenMarkers([big, small])).toEqual([big, small]);
	});

	it("drops a repeated node id, keeping the first", () => {
		const first = marker("dup", 0, 0, 100, 100);
		const again = marker("dup", 10, 10, 20, 20);
		expect(dedupeFlattenMarkers([first, again])).toEqual([first]);
	});

	it("preserves extra fields the transpiler hangs off a marker", () => {
		const slotted = { ...marker("a", 0, 0, 10, 10), slot: { index: 3 } };
		expect(dedupeFlattenMarkers([slotted])[0].slot).toEqual({ index: 3 });
	});
});
