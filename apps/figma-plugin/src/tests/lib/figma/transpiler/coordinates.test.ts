import { describe, expect, it } from "vitest";
import {
	placeRasterIn,
	renderBoundsOf,
	roundHalfPx,
	toAuthorSpace,
} from "~/lib/figma/transpiler/coordinates";

describe("roundHalfPx", () => {
	it("rounds to 0.5 increments", () => {
		expect(roundHalfPx(1.2)).toBe(1);
		expect(roundHalfPx(1.3)).toBe(1.5);
		expect(roundHalfPx(1.74)).toBe(1.5);
		expect(roundHalfPx(1.76)).toBe(2);
	});

	it("uses round-half-to-even on 0.25 boundaries", () => {
		expect(roundHalfPx(1.25)).toBe(1);
		expect(roundHalfPx(1.75)).toBe(2);
		expect(roundHalfPx(2.25)).toBe(2);
		expect(roundHalfPx(2.75)).toBe(3);
	});
});

describe("toAuthorSpace", () => {
	const frame = { x: 100, y: 200, width: 800, height: 500 };
	const scale = 1017 / 800;

	it("converts world bounds to frame-local + scale", () => {
		const result = toAuthorSpace(
			{ x: 132, y: 232, width: 200, height: 80 },
			frame,
			scale,
		);
		expect(result.pos.x).toBe(roundHalfPx(32 * scale));
		expect(result.pos.y).toBe(roundHalfPx(32 * scale));
		expect(result.size.width).toBe(roundHalfPx(200 * scale));
		expect(result.size.height).toBe(roundHalfPx(80 * scale));
	});

	it("zero offset at frame origin", () => {
		const result = toAuthorSpace(
			{ x: 100, y: 200, width: 50, height: 50 },
			frame,
			scale,
		);
		expect(result.pos).toEqual({ x: 0, y: 0 });
	});
});

describe("placeRasterIn", () => {
	// A frame 100×200 in its own space, turned −90° so it lies across the card
	// as 200×100 at (50, 60).
	const rotatedPanel = {
		box: { x: 50, y: 60, width: 200, height: 100 },
		transform: [
			[0, 1, 50],
			[-1, 0, 160],
		] as [[number, number, number], [number, number, number]],
		rotation: -90,
	};

	it("re-anchors to the frame box when the frame is upright", () => {
		const placed = placeRasterIn(
			{ x: 100, y: 80, width: 40, height: 20 },
			{ box: { x: 50, y: 60, width: 200, height: 100 }, rotation: 0 },
			1,
		);
		expect(placed).toEqual({
			pos: { x: 50, y: 20 },
			size: { width: 40, height: 20 },
			rotation: 0,
		});
	});

	it("counter-rotates inside a rotated frame so the bitmap lands upright", () => {
		const placed = placeRasterIn(
			{ x: 100, y: 80, width: 40, height: 20 },
			rotatedPanel,
			1,
		);
		// Undoing the frame's −90° leaves the raster world-axis-aligned, which is
		// how Figma exported its pixels.
		expect(placed.rotation).toBe(90);
		expect(placed.size).toEqual({ width: 40, height: 20 });
		// Centre back-projected into frame-local space is (70, 70); pos is that
		// centre minus half the UNROTATED size.
		expect(placed.pos).toEqual({ x: 50, y: 60 });
	});

	it("scales the frame-local placement with the author scale", () => {
		const placed = placeRasterIn(
			{ x: 100, y: 80, width: 40, height: 20 },
			rotatedPanel,
			2,
		);
		expect(placed.size).toEqual({ width: 80, height: 40 });
		expect(placed.pos).toEqual({ x: 100, y: 120 });
	});
});

describe("renderBoundsOf", () => {
	it("prefers absoluteRenderBounds (the actual exported region) over geometry", () => {
		const r = renderBoundsOf({
			absoluteBoundingBox: { x: 50, y: 80, width: 600, height: 600 },
			absoluteRenderBounds: { x: 100, y: 120, width: 400, height: 300 },
		});
		expect(r).toEqual({ x: 100, y: 120, width: 400, height: 300 });
	});

	it("falls back to absoluteBoundingBox when render bounds are null", () => {
		const r = renderBoundsOf({
			absoluteBoundingBox: { x: 50, y: 80, width: 600, height: 600 },
			absoluteRenderBounds: null,
		});
		expect(r).toEqual({ x: 50, y: 80, width: 600, height: 600 });
	});

	it("falls back to absoluteBoundingBox when render bounds are absent", () => {
		const r = renderBoundsOf({
			absoluteBoundingBox: { x: 50, y: 80, width: 600, height: 600 },
		});
		expect(r).toEqual({ x: 50, y: 80, width: 600, height: 600 });
	});

	it("falls back when render bounds are flat on one axis", () => {
		// Figma reports a flat render box for a node it treats as drawing nothing
		// on its own; the geometry box is the only usable placement left.
		const r = renderBoundsOf({
			absoluteBoundingBox: { x: 50, y: 80, width: 600, height: 600 },
			absoluteRenderBounds: { x: 100, y: 120, width: 400, height: 0 },
		});
		expect(r).toEqual({ x: 50, y: 80, width: 600, height: 600 });
	});

	it("inflates a zero-thickness geometry box by the stroke that paints it", () => {
		// A horizontal LINE: the geometry box has no height at all, so placing the
		// raster there emits a zero-area element that draws nothing. The 6px stroke
		// hangs 3px off each side of the path.
		const r = renderBoundsOf({
			absoluteBoundingBox: { x: 10, y: 40, width: 63, height: 0 },
			absoluteRenderBounds: null,
			strokeWeight: 6,
		});
		expect(r).toEqual({ x: 10, y: 37, width: 63, height: 6 });
	});

	it("leaves a zero-thickness box flat when no stroke paints it", () => {
		// Nothing to inflate by, so it stays degenerate and the caller drops it
		// rather than emitting an invisible element.
		const r = renderBoundsOf({
			absoluteBoundingBox: { x: 10, y: 40, width: 63, height: 0 },
			absoluteRenderBounds: null,
		});
		expect(r).toEqual({ x: 10, y: 40, width: 63, height: 0 });
	});
});
