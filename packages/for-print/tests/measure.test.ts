// Reading a chart back: the perspective fit, the patch sampling, and the
// bare-stock correction that cancels the camera. The round-trip test is the one
// that matters — a synthetic "photograph" of a known chart, read back through the
// real path, has to return what was printed.
import { describe, expect, test } from "vitest";
import {
	type ChartSpec,
	grayBalanceChart,
	type Point,
	type RGB,
} from "../src/chart";
import {
	applyHomography,
	grayCast,
	homographyFrom,
	readChart,
	readingToCsv,
	repeatSpread,
} from "../src/measure";
import type { PixelData } from "../src/types";

const SQUARE: [Point, Point, Point, Point] = [
	{ x: 0, y: 0 },
	{ x: 10, y: 0 },
	{ x: 10, y: 10 },
	{ x: 0, y: 10 },
];

describe("homography", () => {
	test("recovers a plain scale-and-shift", () => {
		const to: [Point, Point, Point, Point] = [
			{ x: 100, y: 50 },
			{ x: 300, y: 50 },
			{ x: 300, y: 250 },
			{ x: 100, y: 250 },
		];
		const h = homographyFrom(SQUARE, to);
		if (!h) throw new Error("no homography");
		for (let i = 0; i < 4; i++) {
			const p = applyHomography(h, SQUARE[i]);
			expect(p.x).toBeCloseTo(to[i].x, 6);
			expect(p.y).toBeCloseTo(to[i].y, 6);
		}
		// And the middle lands in the middle.
		const mid = applyHomography(h, { x: 5, y: 5 });
		expect(mid.x).toBeCloseTo(200, 6);
		expect(mid.y).toBeCloseTo(150, 6);
	});

	test("handles a real perspective — a card photographed at an angle", () => {
		const to: [Point, Point, Point, Point] = [
			{ x: 120, y: 60 },
			{ x: 380, y: 95 },
			{ x: 350, y: 260 },
			{ x: 90, y: 210 },
		];
		const h = homographyFrom(SQUARE, to);
		if (!h) throw new Error("no homography");
		for (let i = 0; i < 4; i++) {
			const p = applyHomography(h, SQUARE[i]);
			expect(p.x).toBeCloseTo(to[i].x, 6);
			expect(p.y).toBeCloseTo(to[i].y, 6);
		}
	});

	// Each of these has a perfectly solvable linear system behind it, and each maps
	// every patch somewhere inside the image — so without an explicit check the
	// reader would return confident nonsense rather than refusing.
	test("refuses picks that do not describe a card", () => {
		const cases: Record<string, [Point, Point, Point, Point]> = {
			// Squashed onto a horizontal line: the map that collapses the plane.
			collinear: [
				{ x: 0, y: 50 },
				{ x: 10, y: 50 },
				{ x: 20, y: 50 },
				{ x: 30, y: 50 },
			],
			// Corners clicked out of order — the card folded through itself.
			"bow tie": [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 0, y: 100 },
				{ x: 100, y: 100 },
			],
			// The same point four times.
			coincident: [
				{ x: 5, y: 5 },
				{ x: 5, y: 5 },
				{ x: 5, y: 5 },
				{ x: 5, y: 5 },
			],
			// A sliver: real extent, no area.
			sliver: [
				{ x: 0, y: 0 },
				{ x: 200, y: 0 },
				{ x: 200, y: 1 },
				{ x: 0, y: 1 },
			],
		};
		for (const [name, to] of Object.entries(cases)) {
			expect(homographyFrom(SQUARE, to), name).toBeNull();
		}
	});

	test("still accepts a card seen at a steep angle", () => {
		// Convex and in order, just heavily foreshortened — a real photo, not a bad
		// pick. The check must not be so strict it refuses these.
		const steep: [Point, Point, Point, Point] = [
			{ x: 100, y: 100 },
			{ x: 400, y: 140 },
			{ x: 380, y: 220 },
			{ x: 120, y: 190 },
		];
		expect(homographyFrom(SQUARE, steep)).not.toBeNull();
	});
});

// Rasterize a chart spec into a fake photograph, optionally through a "printer"
// that shifts the color and a "camera" that casts it. Nearest-neighbour and flat,
// which is all the reader needs — it samples patch interiors.
function photograph(
	spec: ChartSpec,
	opts: {
		scale?: number;
		print?: (rgb: RGB) => RGB;
		cameraGain?: RGB;
	} = {},
): PixelData {
	const scale = opts.scale ?? 0.5;
	const width = Math.round(spec.width * scale);
	const height = Math.round(spec.height * scale);
	const data = new Uint8ClampedArray(width * height * 4);
	// The card ground, so anything unpainted still reads as stock.
	for (let i = 0; i < data.length; i += 4) {
		data[i] = 255;
		data[i + 1] = 255;
		data[i + 2] = 255;
		data[i + 3] = 255;
	}
	const gain = opts.cameraGain ?? [1, 1, 1];
	const put = (x: number, y: number, rgb: RGB) => {
		if (x < 0 || y < 0 || x >= width || y >= height) return;
		const o = (y * width + x) * 4;
		data[o] = rgb[0] * gain[0];
		data[o + 1] = rgb[1] * gain[1];
		data[o + 2] = rgb[2] * gain[2];
	};
	// The ground is stock too, so it takes the camera cast like everything else.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) put(x, y, [255, 255, 255]);
	}
	for (const patch of spec.patches) {
		const printed =
			patch.role === "fiducial"
				? patch.rgb
				: (opts.print ?? ((c: RGB) => c))(patch.rgb);
		const x0 = Math.round(patch.x * scale);
		const y0 = Math.round(patch.y * scale);
		const x1 = Math.round((patch.x + patch.width) * scale);
		const y1 = Math.round((patch.y + patch.height) * scale);
		for (let y = y0; y < y1; y++) {
			for (let x = x0; x < x1; x++) put(x, y, printed);
		}
	}
	return { data, width, height };
}

const cornersOf = (
	spec: ChartSpec,
	scale: number,
): [Point, Point, Point, Point] =>
	spec.registration.map((p) => ({ x: p.x * scale, y: p.y * scale })) as [
		Point,
		Point,
		Point,
		Point,
	];

describe("readChart", () => {
	test("round-trips a perfect print: what went in comes back", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		const reading = readChart(
			photograph(spec, { scale }),
			spec,
			cornersOf(spec, scale),
		);
		if (!reading) throw new Error("no reading");

		expect(reading.missed).toEqual([]);
		for (const p of reading.patches) {
			for (let c = 0; c < 3; c++) {
				expect(Math.abs(p.measured[c] - p.sent[c])).toBeLessThanOrEqual(1);
			}
		}
	});

	test("the bare-stock correction cancels the camera's cast", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		// A warm capture, exposed so the bare card is bright but not blown — the
		// condition the reader needs, and the one it checks for below.
		const cameraGain: RGB = [0.94, 0.84, 0.71];
		const reading = readChart(
			photograph(spec, { scale, cameraGain }),
			spec,
			cornersOf(spec, scale),
		);
		if (!reading) throw new Error("no reading");

		// The raw capture carries the cast...
		expect(reading.stockClipped).toBe(false);
		expect(reading.stock[0]).toBeGreaterThan(reading.stock[2]);
		// ...and after dividing by the stock, the neutrals are neutral again.
		const cast = grayCast(reading);
		for (const c of cast) expect(Math.abs(c)).toBeLessThan(2);
	});

	test("a blown-out bare card is reported, not silently trusted", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		// Over-exposed: the card pins at 255, so the white reference no longer
		// carries the cast it is supposed to cancel.
		const reading = readChart(
			photograph(spec, { scale, cameraGain: [1.2, 1.1, 1.05] }),
			spec,
			cornersOf(spec, scale),
		);
		if (!reading) throw new Error("no reading");
		expect(reading.stockClipped).toBe(true);
	});

	test("a real printer cast survives the correction — that is the point", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		// The printer runs magenta: it lays extra red and blue on everything it
		// prints, but bare stock is untouched, so this must NOT be divided out.
		const print = (rgb: RGB): RGB =>
			rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255
				? rgb
				: [Math.min(255, rgb[0] + 18), rgb[1], Math.min(255, rgb[2] + 12)];
		const reading = readChart(
			photograph(spec, { scale, print }),
			spec,
			cornersOf(spec, scale),
		);
		if (!reading) throw new Error("no reading");

		// Red and blue up, green down against their own mean: the magenta
		// signature, which is exactly what this chart exists to name.
		const [r, g, b] = grayCast(reading);
		expect(r).toBeGreaterThan(5);
		expect(b).toBeGreaterThan(0);
		expect(g).toBeLessThan(-5);
	});

	test("both at once: the camera cancels, the printer does not", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		const print = (rgb: RGB): RGB =>
			rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255
				? rgb
				: [Math.min(255, rgb[0] + 18), rgb[1], Math.min(255, rgb[2] + 12)];
		const reading = readChart(
			photograph(spec, { scale, print, cameraGain: [0.94, 0.84, 0.71] }),
			spec,
			cornersOf(spec, scale),
		);
		if (!reading) throw new Error("no reading");
		// The camera's warmth is gone; the printer's magenta is still there.
		const [r, g, b] = grayCast(reading);
		expect(r).toBeGreaterThan(5);
		expect(b).toBeGreaterThan(0);
		expect(g).toBeLessThan(-5);
	});

	test("reads through a perspective view, not just a square-on one", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		const image = photograph(spec, { scale });
		// Sample with the true corners but a fractional nudge, as a hand-picked
		// corner would be: the patch inset has to absorb it.
		const nudged = cornersOf(spec, scale).map((p, i) => ({
			x: p.x + (i % 2 === 0 ? 1.5 : -1.5),
			y: p.y + (i < 2 ? 1.5 : -1.5),
		})) as [Point, Point, Point, Point];
		const reading = readChart(image, spec, nudged);
		if (!reading) throw new Error("no reading");
		for (const p of reading.patches) {
			for (let c = 0; c < 3; c++) {
				expect(Math.abs(p.measured[c] - p.sent[c])).toBeLessThanOrEqual(3);
			}
		}
	});

	test("an even sheet reports no repeat spread", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		const reading = readChart(
			photograph(spec, { scale }),
			spec,
			cornersOf(spec, scale),
		);
		if (!reading) throw new Error("no reading");
		expect(repeatSpread(reading)).toBeLessThanOrEqual(1);
	});

	test("even light reports no light spread", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		const reading = readChart(
			photograph(spec, { scale }),
			spec,
			cornersOf(spec, scale),
		);
		if (!reading) throw new Error("no reading");
		expect(reading.lightSpread).toBeLessThanOrEqual(1);
	});

	test("a light gradient is reported as light, not as an uneven printer", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		// A lamp off to one side: the whole photo falls off to the right, bare card
		// included. Nothing is wrong with the print.
		const image = photograph(spec, { scale });
		for (let y = 0; y < image.height; y++) {
			for (let x = 0; x < image.width; x++) {
				const o = (y * image.width + x) * 4;
				const falloff = 1 - 0.25 * (x / image.width);
				image.data[o] *= falloff;
				image.data[o + 1] *= falloff;
				image.data[o + 2] *= falloff;
			}
		}
		const reading = readChart(image, spec, cornersOf(spec, scale));
		if (!reading) throw new Error("no reading");
		// The stock patches disagree, which is the tell — they are the same card.
		expect(reading.lightSpread).toBeGreaterThan(5);
		// And the printed repeats disagree by a comparable amount, which without
		// the stock reading would have been read as a drifting printer.
		expect(repeatSpread(reading)).toBeGreaterThan(5);
	});

	test("an uneven sheet reports it", () => {
		const spec = grayBalanceChart(8);
		const scale = 0.5;
		// Density falls off to the right, the classic dye-sub sheet problem. The
		// repeats sit at different x, so they disagree.
		const image = photograph(spec, { scale });
		for (let y = 0; y < image.height; y++) {
			for (let x = 0; x < image.width; x++) {
				const o = (y * image.width + x) * 4;
				const falloff = 1 - 0.25 * (x / image.width);
				image.data[o] *= falloff;
				image.data[o + 1] *= falloff;
				image.data[o + 2] *= falloff;
			}
		}
		const reading = readChart(image, spec, cornersOf(spec, scale));
		if (!reading) throw new Error("no reading");
		expect(repeatSpread(reading)).toBeGreaterThan(5);
	});

	test("null when the corners are degenerate", () => {
		const spec = grayBalanceChart(4);
		const flat: [Point, Point, Point, Point] = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 3, y: 0 },
		];
		expect(readChart(photograph(spec), spec, flat)).toBeNull();
	});
});

describe("readingToCsv", () => {
	test("a header and one row per non-fiducial patch", () => {
		const spec = grayBalanceChart(4);
		const scale = 0.5;
		const reading = readChart(
			photograph(spec, { scale }),
			spec,
			cornersOf(spec, scale),
		);
		if (!reading) throw new Error("no reading");
		const lines = readingToCsv(reading).trim().split("\n");
		expect(lines[0]).toContain("patch_id");
		expect(lines).toHaveLength(reading.patches.length + 1);
	});
});
