// Reading a printed chart back out of a photograph.
//
// What this produces is CAMERA-SPACE, normalized to the bare card in the same
// shot — not colorimetry. That is deliberate and it is enough for the questions a
// card printer actually raises: is there a cast, where does a ramp stop
// responding, which hues come back turned. Each of those is a comparison between
// patches in one photograph, so the capture device's own response cancels and no
// reference target is needed. Absolute color would need one; these do not.
//
// The bare-stock patches are what make it work. On a dye-sub ribbon white means
// "lay down no dye", so those patches are the unprinted card, photographed under
// exactly the lighting everything else was. Dividing by them cancels the camera's
// white balance and the light's own color at once.

import type { ChartPatch, ChartSpec, Point, RGB } from "./chart";
import type { PixelData } from "./types";

// Maps chart coordinates onto pixel coordinates in a photograph. Eight
// coefficients, because a card photographed by hand is a perspective view of a
// rectangle, not a scaled one.
export type Homography = number[];

// Solve Ax = b by Gaussian elimination with partial pivoting. Small and dense —
// the system here is 8×8.
function solve(a: number[][], b: number[]): number[] | null {
	const n = b.length;
	const m = a.map((row, i) => [...row, b[i]]);
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let r = col + 1; r < n; r++) {
			if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
		}
		if (Math.abs(m[pivot][col]) < 1e-12) return null; // degenerate
		[m[col], m[pivot]] = [m[pivot], m[col]];
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const f = m[r][col] / m[col][col];
			for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
		}
	}
	return m.map((row, i) => row[n] / row[i]);
}

// Whether four points actually describe a card: a convex quadrilateral with real
// area, taken in order.
//
// The linear solve is not enough on its own to reject a bad set of picks. Four
// points on a line have a perfectly good projective map onto them — the one that
// collapses the plane onto that line — so the system solves, every patch samples
// somewhere inside the image, and the reader returns confident nonsense. Same for
// corners clicked out of order: that maps the card onto a bow tie, folded through
// itself, and again every sample lands on real pixels.
//
// Both are checked here instead, where "is this a card" is a question about the
// four points rather than about a matrix.
function isProperQuad(p: [Point, Point, Point, Point]): boolean {
	const xs = p.map((q) => q.x);
	const ys = p.map((q) => q.y);
	const extent = Math.max(
		Math.max(...xs) - Math.min(...xs),
		Math.max(...ys) - Math.min(...ys),
	);
	if (extent <= 0) return false;

	// Shoelace area. Scaled against the extent so the test is about shape, not
	// about how big in the frame the card happened to be.
	let twiceArea = 0;
	for (let i = 0; i < 4; i++) {
		const a = p[i];
		const b = p[(i + 1) % 4];
		twiceArea += a.x * b.y - b.x * a.y;
	}
	if (Math.abs(twiceArea) / 2 < extent * extent * 0.01) return false;

	// Every corner turning the same way — convex, and in order.
	let winding = 0;
	for (let i = 0; i < 4; i++) {
		const a = p[i];
		const b = p[(i + 1) % 4];
		const c = p[(i + 2) % 4];
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (cross === 0) return false;
		const turn = Math.sign(cross);
		if (winding === 0) winding = turn;
		else if (turn !== winding) return false;
	}
	return true;
}

// The transform taking the chart's four registration points to the four points
// picked in the photo, both clockwise from top-left. Null if the picks do not
// describe a card — collinear, out of order, or two of them the same.
export function homographyFrom(
	from: [Point, Point, Point, Point],
	to: [Point, Point, Point, Point],
): Homography | null {
	if (!isProperQuad(from) || !isProperQuad(to)) return null;
	const a: number[][] = [];
	const b: number[] = [];
	for (let i = 0; i < 4; i++) {
		const { x, y } = from[i];
		const { x: u, y: v } = to[i];
		a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
		b.push(u);
		a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
		b.push(v);
	}
	const h = solve(a, b);
	return h ? [...h, 1] : null;
}

export function applyHomography(h: Homography, p: Point): Point {
	const w = h[6] * p.x + h[7] * p.y + h[8];
	return {
		x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
		y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
	};
}

const median = (xs: number[]): number => {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((p, q) => p - q);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Fraction of a patch's width/height actually sampled, centered. Keeps the
// reader off the edges, where a patch bleeds into its neighbour and a slight
// misregistration would otherwise mix two colors into one reading.
const SAMPLE_INSET = 0.6;
// Samples per axis inside that window.
const SAMPLE_GRID = 7;

// The median of a patch's samples. Median rather than mean because glossy PVC
// throws specular highlights: a few blown pixels drag a mean a long way and leave
// a median where it was.
function samplePatch(
	image: PixelData,
	h: Homography,
	patch: ChartPatch,
): RGB | null {
	const rs: number[] = [];
	const gs: number[] = [];
	const bs: number[] = [];
	const x0 = patch.x + (patch.width * (1 - SAMPLE_INSET)) / 2;
	const y0 = patch.y + (patch.height * (1 - SAMPLE_INSET)) / 2;
	const w = patch.width * SAMPLE_INSET;
	const hgt = patch.height * SAMPLE_INSET;
	for (let iy = 0; iy < SAMPLE_GRID; iy++) {
		for (let ix = 0; ix < SAMPLE_GRID; ix++) {
			const p = applyHomography(h, {
				x: x0 + (w * (ix + 0.5)) / SAMPLE_GRID,
				y: y0 + (hgt * (iy + 0.5)) / SAMPLE_GRID,
			});
			const px = Math.round(p.x);
			const py = Math.round(p.y);
			if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
			const o = (py * image.width + px) * 4;
			rs.push(image.data[o]);
			gs.push(image.data[o + 1]);
			bs.push(image.data[o + 2]);
		}
	}
	if (rs.length === 0) return null;
	return [median(rs), median(gs), median(bs)];
}

export type PatchReading = {
	id: string;
	role: ChartPatch["role"];
	// What was sent to the printer.
	sent: RGB;
	// What the camera saw, before the stock correction.
	raw: RGB;
	// After it — the number to read. Camera-space, stock-neutral.
	measured: RGB;
	repeatOf?: string;
};

export type ChartReading = {
	chartId: string;
	patches: PatchReading[];
	// The bare card as the camera saw it. Its spread across channels is the
	// combined cast of the light and the camera, which is what got divided out.
	stock: RGB;
	// The bare card came back at the top (or bottom) of the range, so the white
	// reference is a clipped value and the correction built from it is wrong —
	// every channel that blew reads as the same 255 whatever it really was. The
	// fix is at the camera: drop the exposure until the card is bright but not
	// blown. Nothing downstream can recover this, so it is reported, not patched.
	stockClipped: boolean;
	// How much the bare-stock patches disagree with each other, in levels. They are
	// the same unprinted card in different places, so anything here is the LIGHT
	// falling unevenly across the shot, not the print. It bounds what `repeatSpread`
	// can mean: a lamp off to one side reads as a printer that drifts across the
	// sheet, and the two are indistinguishable from the printed patches alone.
	lightSpread: number;
	// Patches whose samples fell outside the image — a bad registration pick.
	missed: string[];
};

// Read every patch of a chart out of a photograph. `corners` are the four
// fiducial centers as picked in the image, clockwise from top-left.
export function readChart(
	image: PixelData,
	spec: ChartSpec,
	corners: [Point, Point, Point, Point],
): ChartReading | null {
	const h = homographyFrom(spec.registration, corners);
	if (!h) return null;

	const raw = new Map<string, RGB>();
	const missed: string[] = [];
	for (const patch of spec.patches) {
		if (patch.role === "fiducial") continue;
		const v = samplePatch(image, h, patch);
		if (v) raw.set(patch.id, v);
		else missed.push(patch.id);
	}

	// The white reference: the median of the bare-stock patches, so one blown or
	// shadowed corner doesn't set the balance for the whole card.
	const stockValues = spec.patches
		.filter((p) => p.role === "stock")
		.map((p) => raw.get(p.id))
		.filter((v): v is RGB => !!v);
	const stock: RGB = stockValues.length
		? [
				median(stockValues.map((v) => v[0])),
				median(stockValues.map((v) => v[1])),
				median(stockValues.map((v) => v[2])),
			]
		: [255, 255, 255];

	// Per-channel gain that lands the bare card on neutral, keeping its level. Any
	// color left in a patch after this is the print's, not the light's.
	const level = (stock[0] + stock[1] + stock[2]) / 3;
	const gain = stock.map((c) => (c > 0 ? level / c : 1)) as RGB;
	const stockClipped = stock.some((c) => c >= 254 || c <= 1);
	// Measured before the gain is applied: the gain is one number for the whole
	// card, so it shifts every stock patch together and cannot change how far apart
	// they are.
	const lightSpread = stockValues.length
		? Math.max(
				...[0, 1, 2].map((c) => {
					const vs = stockValues.map((v) => v[c]);
					return Math.max(...vs) - Math.min(...vs);
				}),
			)
		: 0;

	const patches: PatchReading[] = [];
	for (const patch of spec.patches) {
		if (patch.role === "fiducial") continue;
		const v = raw.get(patch.id);
		if (!v) continue;
		patches.push({
			id: patch.id,
			role: patch.role,
			sent: patch.rgb,
			raw: v,
			measured: [v[0] * gain[0], v[1] * gain[1], v[2] * gain[2]],
			...(patch.repeatOf ? { repeatOf: patch.repeatOf } : {}),
		});
	}
	return {
		chartId: spec.id,
		patches,
		stock,
		stockClipped,
		lightSpread,
		missed,
	};
}

// ── Reading the reading ────────────────────────────────────────────────────

// The color left in patches that were sent neutral, per channel, as a signed
// deviation from their own mean. A printer with no cast reads ~0 across the
// board; the sign says which way each channel runs. This is the number that
// answers "why does everything look magenta".
export function grayCast(reading: ChartReading): RGB {
	const grays = reading.patches.filter(
		(p) =>
			p.role === "measure" &&
			p.sent[0] === p.sent[1] &&
			p.sent[1] === p.sent[2],
	);
	if (grays.length === 0) return [0, 0, 0];
	const sum: RGB = [0, 0, 0];
	for (const p of grays) {
		const mean = (p.measured[0] + p.measured[1] + p.measured[2]) / 3;
		sum[0] += p.measured[0] - mean;
		sum[1] += p.measured[1] - mean;
		sum[2] += p.measured[2] - mean;
	}
	return [sum[0] / grays.length, sum[1] / grays.length, sum[2] / grays.length];
}

// The largest disagreement between any patch and a repeat of it, in levels. This
// is the sheet's evenness, and it bounds what a profile built from the card can
// be worth — a printer that varies more than it corrects is not ready to profile.
export function repeatSpread(reading: ChartReading): number {
	const byId = new Map(reading.patches.map((p) => [p.id, p]));
	let worst = 0;
	for (const p of reading.patches) {
		if (!p.repeatOf) continue;
		const base = byId.get(p.repeatOf);
		if (!base) continue;
		for (let c = 0; c < 3; c++) {
			worst = Math.max(worst, Math.abs(p.measured[c] - base.measured[c]));
		}
	}
	return worst;
}

// Readings as CSV — the handoff to a spreadsheet, or to whoever is building the
// LUT. One row per patch, what went in beside what came back.
export function readingToCsv(reading: ChartReading): string {
	const rows = [
		"patch_id,role,sent_r,sent_g,sent_b,raw_r,raw_g,raw_b,measured_r,measured_g,measured_b",
		...reading.patches.map((p) =>
			[
				p.id,
				p.role,
				...p.sent,
				...p.raw.map((v) => v.toFixed(1)),
				...p.measured.map((v) => v.toFixed(1)),
			].join(","),
		),
	];
	return `${rows.join("\n")}\n`;
}
