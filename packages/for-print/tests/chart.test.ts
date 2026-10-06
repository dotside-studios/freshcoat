// Chart specs: geometry that fits the card, colors that sweep the axis they
// claim to, and a spec the reader can round-trip against.
import { describe, expect, test } from "vitest";
import {
	chartScene,
	chromaRampChart,
	DIAGNOSTIC_CHARTS,
	grayBalanceChart,
	hslToRgb,
	hueSweepChart,
	latticeCharts,
	layoutGrid,
	toneWedgeChart,
} from "../src/chart";
import { CR80_LONG, CR80_SHORT } from "../src/geometry";

describe("layoutGrid", () => {
	const area = { x: 10, y: 20, width: 400, height: 200 };

	test("lays every cell inside the area", () => {
		for (const count of [1, 7, 48, 100]) {
			for (const box of layoutGrid(count, area)) {
				expect(box.x).toBeGreaterThanOrEqual(area.x - 1e-6);
				expect(box.y).toBeGreaterThanOrEqual(area.y - 1e-6);
				expect(box.x + box.width).toBeLessThanOrEqual(
					area.x + area.width + 1e-6,
				);
				expect(box.y + box.height).toBeLessThanOrEqual(
					area.y + area.height + 1e-6,
				);
			}
		}
	});

	test("cells do not overlap", () => {
		const boxes = layoutGrid(24, area);
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i];
				const b = boxes[j];
				const disjoint =
					a.x + a.width <= b.x + 1e-6 ||
					b.x + b.width <= a.x + 1e-6 ||
					a.y + a.height <= b.y + 1e-6 ||
					b.y + b.height <= a.y + 1e-6;
				expect(disjoint).toBe(true);
			}
		}
	});

	test("picks a roughly square cell rather than a strip", () => {
		const [box] = layoutGrid(48, area);
		expect(box.width / box.height).toBeGreaterThan(0.4);
		expect(box.width / box.height).toBeLessThan(2.5);
	});

	test("no cells for no patches", () => {
		expect(layoutGrid(0, area)).toEqual([]);
	});
});

describe("hslToRgb", () => {
	test("hits the primaries and stays in range", () => {
		expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
		expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
		expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
		// Zero saturation is neutral at any hue.
		const [r, g, b] = hslToRgb(200, 0, 0.5);
		expect(r).toBe(g);
		expect(g).toBe(b);
	});

	test("wraps hue instead of clipping it", () => {
		expect(hslToRgb(360, 1, 0.5)).toEqual(hslToRgb(0, 1, 0.5));
		expect(hslToRgb(-120, 1, 0.5)).toEqual(hslToRgb(240, 1, 0.5));
	});
});

describe("the diagnostic charts", () => {
	test("every chart fits a CR80 card and carries its registration", () => {
		for (const spec of DIAGNOSTIC_CHARTS()) {
			expect(spec.width).toBe(CR80_LONG);
			expect(spec.height).toBe(CR80_SHORT);
			expect(spec.registration).toHaveLength(4);
			for (const p of spec.patches) {
				expect(p.x).toBeGreaterThanOrEqual(0);
				expect(p.y).toBeGreaterThanOrEqual(0);
				expect(p.x + p.width).toBeLessThanOrEqual(spec.width + 1e-6);
				expect(p.y + p.height).toBeLessThanOrEqual(spec.height + 1e-6);
			}
		}
	});

	test("every chart carries bare stock and four fiducials", () => {
		for (const spec of DIAGNOSTIC_CHARTS()) {
			const stock = spec.patches.filter((p) => p.role === "stock");
			expect(stock.length).toBeGreaterThanOrEqual(3);
			// Stock is unprinted card, which on a dye-sub ribbon means white.
			for (const p of stock) expect(p.rgb).toEqual([255, 255, 255]);
			expect(spec.patches.filter((p) => p.role === "fiducial")).toHaveLength(4);
		}
	});

	test("patch ids are unique within a chart", () => {
		for (const spec of DIAGNOSTIC_CHARTS()) {
			const ids = spec.patches.map((p) => p.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	test("gray balance is neutral throughout, and repeats each step", () => {
		const spec = grayBalanceChart(8);
		const grays = spec.patches.filter((p) => p.role === "measure");
		for (const p of grays) {
			expect(p.rgb[0]).toBe(p.rgb[1]);
			expect(p.rgb[1]).toBe(p.rgb[2]);
		}
		// Three passes: one original and two repeats of each step.
		expect(grays.filter((p) => p.repeatOf).length).toBe(16);
		expect(grays.length).toBe(24);
	});

	test("tone wedges ramp each primary and secondary on its own", () => {
		const spec = toneWedgeChart(5);
		const red = spec.patches.filter((p) => p.id.startsWith("r-"));
		expect(red).toHaveLength(5);
		// Monotonic in red, and the other channels never leave zero.
		for (let i = 1; i < red.length; i++) {
			expect(red[i].rgb[0]).toBeGreaterThan(red[i - 1].rgb[0]);
		}
		for (const p of red) {
			expect(p.rgb[1]).toBe(0);
			expect(p.rgb[2]).toBe(0);
		}
	});

	test("the hue sweep holds saturation while hue travels", () => {
		const spec = hueSweepChart(6, [0.5]);
		const hues = spec.patches.filter((p) => p.id.startsWith("hue-"));
		expect(hues).toHaveLength(6);
		// Same saturation and lightness, so every patch has the same channel spread.
		const spread = (p: (typeof hues)[number]) =>
			Math.max(...p.rgb) - Math.min(...p.rgb);
		const first = spread(hues[0]);
		for (const p of hues)
			expect(Math.abs(spread(p) - first)).toBeLessThanOrEqual(1);
	});

	test("chroma ramps climb from neutral to saturated at a fixed hue", () => {
		const spec = chromaRampChart([250], 6);
		const ramp = spec.patches.filter((p) => p.id.startsWith("chroma-250-"));
		expect(ramp).toHaveLength(6);
		const spread = (p: (typeof ramp)[number]) =>
			Math.max(...p.rgb) - Math.min(...p.rgb);
		expect(spread(ramp[0])).toBe(0); // saturation 0 is neutral
		for (let i = 1; i < ramp.length; i++) {
			expect(spread(ramp[i])).toBeGreaterThan(spread(ramp[i - 1]));
		}
	});

	test("chroma ramp patches match previously printed charts", () => {
		const spec = chromaRampChart();
		const ramp = spec.patches
			.filter((p) => p.id.startsWith("chroma-250-"))
			.map((p) => p.rgb);
		expect(ramp).toEqual([
			[128, 128, 128],
			[118, 113, 142],
			[109, 99, 156],
			[99, 85, 170],
			[90, 71, 184],
			[80, 57, 198],
			[71, 43, 212],
			[61, 28, 227],
			[52, 14, 241],
			[43, 0, 255],
		]);
	});
});

describe("latticeCharts", () => {
	test("covers the cube exactly once across its cards", () => {
		const pages = latticeCharts(5, 100);
		const measured = pages.flatMap((s) =>
			s.patches.filter((p) => p.role === "measure"),
		);
		expect(measured).toHaveLength(125);
		expect(new Set(measured.map((p) => p.rgb.join(","))).size).toBe(125);
		// The corners of the cube are in there, so the ends are measured, not
		// extrapolated.
		const set = new Set(measured.map((p) => p.rgb.join(",")));
		expect(set.has("0,0,0")).toBe(true);
		expect(set.has("255,255,255")).toBe(true);
		expect(set.has("0,0,255")).toBe(true);
	});

	test("splits into as many cards as the per-card cap needs", () => {
		expect(latticeCharts(5, 100)).toHaveLength(2);
		expect(latticeCharts(9, 100)).toHaveLength(8);
		// Every card is independently readable: its own stock and fiducials.
		for (const spec of latticeCharts(5, 100)) {
			expect(spec.patches.some((p) => p.role === "stock")).toBe(true);
			expect(spec.patches.filter((p) => p.role === "fiducial")).toHaveLength(4);
		}
	});
});

describe("chartScene", () => {
	test("paints one rect per patch over a white ground", () => {
		const spec = grayBalanceChart(4);
		const scene = chartScene(spec);
		// background + every patch
		expect(scene.children).toHaveLength(spec.patches.length + 1);
		for (const child of scene.children) expect(child.kind).toBe("rect");
	});

	test("a patch's fill is the color the spec says was sent", () => {
		const spec = chromaRampChart([0], 2);
		const scene = chartScene(spec);
		const patch = spec.patches.find((p) => p.id === "chroma-0-1");
		if (!patch) throw new Error("missing patch");
		// children[0] is the ground, so patch i is at i + 1.
		const index = spec.patches.indexOf(patch) + 1;
		const rect = scene.children[index] as { fills: Array<{ color: string }> };
		const expected = `#${patch.rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
		expect(rect.fills[0].color).toBe(expected);
	});
});
