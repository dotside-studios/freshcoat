import { describe, expect, it } from "vitest";
import { CUT_STYLES, type ItemCuts } from "./cut";
import { cutDxf } from "./cut-dxf";

type Polyline = { layer: string; closed: boolean; points: [number, number][] };
type Dxf = {
	header: Record<string, string>;
	layers: { name: string; color: number }[];
	polylines: Polyline[];
	lines: string[];
};

/** Reads the parts of an R12 DXF that the writer produces. */
function readDxf(text: string): Dxf {
	const rows = text.split(/\r?\n/);
	const pairs: [number, string][] = [];
	for (let i = 0; i + 1 < rows.length; i += 2)
		pairs.push([
			Number((rows[i] as string).trim()),
			(rows[i + 1] as string).trim(),
		]);
	const out: Dxf = { header: {}, layers: [], polylines: [], lines: [] };
	let section = "";
	let variable = "";
	let layer: { name: string; color: number } | undefined;
	let poly: Polyline | undefined;
	let vertex: [number, number] | undefined;
	let entity = "";
	for (const [code, value] of pairs) {
		if (code === 0) {
			if (value === "SECTION") continue;
			if (value === "ENDSEC") section = "";
			if (value === "LAYER") {
				layer = { name: "", color: 0 };
				out.layers.push(layer);
			}
			if (value === "POLYLINE") {
				poly = { layer: "", closed: false, points: [] };
				out.polylines.push(poly);
				vertex = undefined;
			}
			if (value === "VERTEX") {
				vertex = [0, 0];
				poly?.points.push(vertex);
			}
			if (value === "SEQEND") poly = undefined;
			entity = value;
			continue;
		}
		if (code === 2 && !section) {
			section = value;
			continue;
		}
		if (section === "HEADER") {
			if (code === 9) variable = value;
			else out.header[variable] = value;
		} else if (section === "TABLES" && entity === "LAYER") {
			if (!layer) continue;
			if (code === 2) layer.name = value;
			if (code === 62) layer.color = Number(value);
		} else if (section === "ENTITIES") {
			if (entity === "POLYLINE" && poly) {
				if (code === 8) poly.layer = value;
				if (code === 70) poly.closed = (Number(value) & 1) === 1;
			} else if (entity === "VERTEX" && vertex) {
				if (code === 10) vertex[0] = Number(value);
				if (code === 20) vertex[1] = Number(value);
			} else if (entity !== "SEQEND") out.lines.push(entity);
		}
	}
	return out;
}

const square: ItemCuts = {
	width: 100,
	height: 60,
	lines: [
		{
			kind: "through",
			name: "box",
			path: "M10 10L40 10L40 30L10 30Z",
			fillRule: "nonzero",
		},
		{ kind: "score", name: "fold", path: "M0 45L100 45", fillRule: "nonzero" },
	],
};

const mmPerUnit = 25.4 / 300;

describe("cutDxf", () => {
	const dxf = readDxf(cutDxf(square, 300));

	it("declares millimetres", () => {
		expect(dxf.header.$INSUNITS).toBe("4");
		expect(dxf.header.$MEASUREMENT).toBe("1");
		expect(dxf.header.$ACADVER).toBe("AC1009");
	});

	it("makes a layer for each kind present, coloured by ACI", () => {
		const real = dxf.layers.filter((l) => l.name !== "0");
		expect(real).toEqual([
			{ name: "THROUGH", color: CUT_STYLES.through.aci },
			{ name: "SCORE", color: CUT_STYLES.score.aci },
		]);
		expect(CUT_STYLES.through.aci).toBe(1);
		expect(CUT_STYLES.kiss.aci).toBe(6);
		expect(CUT_STYLES.score.aci).toBe(5);
		expect(CUT_STYLES.perforate.aci).toBe(3);
	});

	it("writes polylines in millimetres with y up", () => {
		const [box, fold] = dxf.polylines;
		expect(box?.layer).toBe("THROUGH");
		const height = 60 * mmPerUnit;
		expect(box?.points).toHaveLength(4);
		const [first, second, , last] = box?.points ?? [];
		expect(first?.[0]).toBeCloseTo(10 * mmPerUnit, 4);
		expect(first?.[1]).toBeCloseTo(height - 10 * mmPerUnit, 4);
		expect(second?.[0]).toBeCloseTo(40 * mmPerUnit, 4);
		expect(last?.[1]).toBeCloseTo(height - 30 * mmPerUnit, 4);
		expect(fold?.layer).toBe("SCORE");
		expect(fold?.points.map((p) => p[1])).toEqual([
			expect.closeTo(height - 45 * mmPerUnit, 4),
			expect.closeTo(height - 45 * mmPerUnit, 4),
		]);
	});

	it("closes closed subpaths and leaves open ones open", () => {
		expect(dxf.polylines.map((p) => p.closed)).toEqual([true, false]);
	});

	it("writes nothing but polylines as entities", () => {
		expect(dxf.lines).toEqual([]);
	});

	it("ends with EOF and is the same every time", () => {
		const text = cutDxf(square, 300);
		expect(text.trimEnd().endsWith("EOF")).toBe(true);
		expect(cutDxf(square, 300)).toBe(text);
	});

	it("splits a path into one polyline per subpath", () => {
		const two: ItemCuts = {
			width: 10,
			height: 10,
			lines: [
				{
					kind: "kiss",
					name: "pair",
					path: "M0 0L2 0L2 2ZM5 5L8 5L8 8Z",
					fillRule: "nonzero",
				},
			],
		};
		const read = readDxf(cutDxf(two, 300));
		expect(
			read.polylines.map((p) => [p.layer, p.points.length, p.closed]),
		).toEqual([
			["KISS", 3, true],
			["KISS", 3, true],
		]);
	});

	describe("a rounded rectangle", () => {
		// 20 mm at 300 dpi is 236.22 units; a quarter circle of radius r each corner
		const size = 300;
		const r = 60;
		const k = 0.5522847498 * r;
		const path = [
			`M${r} 0`,
			`L${size - r} 0`,
			`C${size - r + k} 0 ${size} ${r - k} ${size} ${r}`,
			`L${size} ${size - r}`,
			`C${size} ${size - r + k} ${size - r + k} ${size} ${size - r} ${size}`,
			`L${r} ${size}`,
			`C${r - k} ${size} 0 ${size - r + k} 0 ${size - r}`,
			`L0 ${r}`,
			`C0 ${r - k} ${r - k} 0 ${r} 0`,
			"Z",
		].join("");
		const rounded = readDxf(
			cutDxf(
				{
					width: size,
					height: size,
					lines: [{ kind: "through", name: "r", path, fillRule: "nonzero" }],
				},
				300,
			),
		);
		const [poly] = rounded.polylines;
		const rMm = r * mmPerUnit;
		const sizeMm = size * mmPerUnit;
		// the first corner circle's centre, with y up
		const centre = [sizeMm - rMm, sizeMm - rMm] as const;

		it("flattens curves to many vertices and closes", () => {
			expect(poly?.closed).toBe(true);
			expect(poly?.points.length).toBeGreaterThan(24);
		});

		it("keeps every vertex on the arc and every chord within 0.05 mm of it", () => {
			const points = poly?.points ?? [];
			let checked = 0;
			points.forEach((p, i) => {
				const q = points[(i + 1) % points.length] as [number, number];
				const inCorner = (a: [number, number]) =>
					a[0] > centre[0] - 1e-6 && a[1] > centre[1] - 1e-6;
				if (!inCorner(p) || !inCorner(q)) return;
				expect(Math.hypot(p[0] - centre[0], p[1] - centre[1])).toBeCloseTo(
					rMm,
					1,
				);
				const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const;
				const sag = rMm - Math.hypot(mid[0] - centre[0], mid[1] - centre[1]);
				expect(sag).toBeLessThanOrEqual(0.05 + 1e-6);
				checked++;
			});
			expect(checked).toBeGreaterThan(4);
		});

		it("does not draw a vertex twice in a row", () => {
			const points = poly?.points ?? [];
			points.forEach((p, i) => {
				const q = points[(i + 1) % points.length] as [number, number];
				expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThan(1e-9);
			});
		});
	});
});
