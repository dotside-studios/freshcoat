// Measurement charts — the printed half of characterizing a card printer.
//
// A chart is a SPEC first: patch geometry plus the RGB that was sent to the
// printer for each one. The spec is what makes a captured photo readable, so it
// is shared by both ends — `chartScene` renders it to a card, `readChart`
// (./measure) samples the same patches back out of a photograph. Nothing about
// the chart's layout is written down twice.
//
// Building a freshcoat node tree is data, not rasterizing: for-print still owns
// no canvas. The caller paints the tree.

import {
	createFrame,
	createRect,
	type GroupNode,
	type Node,
} from "@freshcoat-js/engine";
import { CR80_LONG, CR80_SHORT } from "./geometry";

export type RGB = [number, number, number];

export type Box = { x: number; y: number; width: number; height: number };

// What a patch is FOR, which decides how the reader treats it.
//   measure  — a color under test
//   stock    — deliberately unprinted. On a dye-sub ribbon white means "lay down
//              no dye", so this reads the bare card: the reader's white reference
//              and the thing that cancels the camera's own cast
//   fiducial — a registration mark, not a measurement
export type PatchRole = "measure" | "stock" | "fiducial";

export type ChartPatch = Box & {
	id: string;
	rgb: RGB;
	role: PatchRole;
	// Set when this patch repeats another's color elsewhere on the card. Comparing
	// the two is how a sheet reports its own evenness — a printer that drifts
	// across the card says so here rather than in the profile built from it.
	repeatOf?: string;
};

export type ChartSpec = {
	id: string;
	name: string;
	// What reading this chart tells you, in one line — the tool shows it.
	purpose: string;
	width: number;
	height: number;
	patches: ChartPatch[];
	// Fiducial centers in chart coordinates, clockwise from top-left. The reader
	// maps these onto the four points picked in a photo.
	registration: [Point, Point, Point, Point];
};

export type Point = { x: number; y: number };

// 3mm margin, a 2.5mm fiducial and a hairline gutter, all at 300dpi. The patch
// field starts inside the fiducial band so a corner mark is never half a patch.
const MARGIN = 36;
const FIDUCIAL = 30;
const GUTTER = 6;

function innerArea(width: number, height: number): Box {
	const inset = MARGIN + FIDUCIAL + GUTTER;
	return {
		x: inset,
		y: inset,
		width: width - inset * 2,
		height: height - inset * 2,
	};
}

// Lay `count` cells into `area`, choosing the column count whose cell aspect sits
// closest to square. Cells fill the area, so patches are as large as the card
// allows — a bigger patch survives a phone camera's noise and a slight misclick.
export function layoutGrid(count: number, area: Box, gutter = GUTTER): Box[] {
	if (count <= 0) return [];
	let best = { cols: 1, score: Number.POSITIVE_INFINITY };
	for (let cols = 1; cols <= count; cols++) {
		const rows = Math.ceil(count / cols);
		const w = (area.width - gutter * (cols - 1)) / cols;
		const h = (area.height - gutter * (rows - 1)) / rows;
		if (w <= 0 || h <= 0) continue;
		// Distance from square, plus a nudge against layouts that leave a ragged
		// final row — a half-empty row wastes patch size for nothing.
		const score = Math.abs(Math.log(w / h)) + (cols * rows - count) / count;
		if (score < best.score) best = { cols, score };
	}
	const cols = best.cols;
	const rows = Math.ceil(count / cols);
	const w = (area.width - gutter * (cols - 1)) / cols;
	const h = (area.height - gutter * (rows - 1)) / rows;
	return Array.from({ length: count }, (_, i) => ({
		x: area.x + (i % cols) * (w + gutter),
		y: area.y + Math.floor(i / cols) * (h + gutter),
		width: w,
		height: h,
	}));
}

const hex = ([r, g, b]: RGB): string =>
	`#${[r, g, b]
		.map((v) =>
			Math.max(0, Math.min(255, Math.round(v)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

// HSL → RGB, the generator for the hue and chroma sweeps. Chart colors are
// authored in HSL because the sweeps vary one axis at a time by definition.
// Kept apart from the engine's hslToRgb, whose rounding differs by one in a
// few patches: printed charts are read against these exact values.
export function hslToRgb(h: number, s: number, l: number): RGB {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = (((h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	const [r, g, b] =
		hp < 1
			? [c, x, 0]
			: hp < 2
				? [x, c, 0]
				: hp < 3
					? [0, c, x]
					: hp < 4
						? [0, x, c]
						: hp < 5
							? [x, 0, c]
							: [c, 0, x];
	const m = l - c / 2;
	return [
		Math.round((r + m) * 255),
		Math.round((g + m) * 255),
		Math.round((b + m) * 255),
	];
}

function fiducials(
	width: number,
	height: number,
): {
	patches: ChartPatch[];
	registration: [Point, Point, Point, Point];
} {
	const corners: Array<[string, number, number]> = [
		["tl", MARGIN, MARGIN],
		["tr", width - MARGIN - FIDUCIAL, MARGIN],
		["br", width - MARGIN - FIDUCIAL, height - MARGIN - FIDUCIAL],
		["bl", MARGIN, height - MARGIN - FIDUCIAL],
	];
	const patches = corners.map(([id, x, y]) => ({
		id: `fid-${id}`,
		rgb: [0, 0, 0] as RGB,
		role: "fiducial" as const,
		x,
		y,
		width: FIDUCIAL,
		height: FIDUCIAL,
	}));
	const center = (p: ChartPatch): Point => ({
		x: p.x + p.width / 2,
		y: p.y + p.height / 2,
	});
	return {
		patches,
		registration: [
			center(patches[0]),
			center(patches[1]),
			center(patches[2]),
			center(patches[3]),
		],
	};
}

// Assemble a chart from a list of colors. Stock patches are spliced in at both
// ends and the middle rather than parked in one corner: the white reference has
// to sample the same lighting the measured patches do, and a single corner patch
// under a gradient of window light would bias every reading against it.
function build(
	id: string,
	name: string,
	purpose: string,
	colors: Array<{ id: string; rgb: RGB; repeatOf?: string }>,
	stockCount = 4,
	width = CR80_LONG,
	height = CR80_SHORT,
): ChartSpec {
	const withStock: Array<{
		id: string;
		rgb: RGB;
		repeatOf?: string;
		role: PatchRole;
	}> = [];
	const every = Math.max(
		1,
		Math.floor(colors.length / Math.max(1, stockCount - 1)),
	);
	let stock = 0;
	colors.forEach((c, i) => {
		if (stock < stockCount && i % every === 0) {
			withStock.push({
				id: `stock-${stock}`,
				rgb: [255, 255, 255],
				role: "stock",
			});
			stock++;
		}
		withStock.push({ ...c, role: "measure" });
	});
	while (stock < stockCount) {
		withStock.push({
			id: `stock-${stock}`,
			rgb: [255, 255, 255],
			role: "stock",
		});
		stock++;
	}

	const boxes = layoutGrid(withStock.length, innerArea(width, height));
	const marks = fiducials(width, height);
	return {
		id,
		name,
		purpose,
		width,
		height,
		patches: [
			...withStock.map((c, i) => ({ ...c, ...boxes[i] })),
			...marks.patches,
		],
		registration: marks.registration,
	};
}

const steps = (n: number, f: (t: number) => RGB) =>
	Array.from({ length: n }, (_, i) => f(n === 1 ? 0 : i / (n - 1)));

// ── The four diagnostics ───────────────────────────────────────────────────
//
// None of these needs a reference target. Each is read against the bare stock in
// the same photograph, or against the other patches on the same card, so an
// uncalibrated phone answers all four.

// Neutral in, neutral out — the chart that finds a color cast. Every step is
// printed three times across the card, so an uneven sheet is visible as
// disagreement between the repeats rather than being read as a cast.
export function grayBalanceChart(stepCount = 16): ChartSpec {
	const base = steps(stepCount, (t) => {
		const v = Math.round(t * 255);
		return [v, v, v] as RGB;
	});
	const colors = [0, 1, 2].flatMap((pass) =>
		base.map((rgb, i) => ({
			id: `gray-${i}-p${pass}`,
			rgb,
			...(pass > 0 ? { repeatOf: `gray-${i}-p0` } : {}),
		})),
	);
	return build(
		"gray-balance",
		"Gray balance",
		"Neutral steps printed three times across the card. Any color in these is the printer's cast; disagreement between the three passes is the sheet being uneven.",
		colors,
	);
}

// Per-channel ramps — the printer's transfer curve, one primary at a time.
export function toneWedgeChart(stepCount = 9): ChartSpec {
	const axes: Array<[string, (t: number) => RGB]> = [
		["r", (t) => [Math.round(t * 255), 0, 0]],
		["g", (t) => [0, Math.round(t * 255), 0]],
		["b", (t) => [0, 0, Math.round(t * 255)]],
		["c", (t) => [0, Math.round(t * 255), Math.round(t * 255)]],
		["m", (t) => [Math.round(t * 255), 0, Math.round(t * 255)]],
		["y", (t) => [Math.round(t * 255), Math.round(t * 255), 0]],
	];
	const colors = axes.flatMap(([name, f]) =>
		steps(stepCount, f).map((rgb, i) => ({ id: `${name}-${i}`, rgb })),
	);
	return build(
		"tone-wedge",
		"Tone wedges",
		"Each primary and secondary ramped on its own. Read where a ramp stops getting darker — that is the channel's real transfer curve, not the one the file assumes.",
		colors,
	);
}

// Constant saturation and lightness, hue swept the whole way round. Whichever
// hues come back rotated are the ones a correction has to hold.
export function hueSweepChart(
	hueCount = 24,
	lightnesses = [0.4, 0.55, 0.7],
): ChartSpec {
	const colors = lightnesses.flatMap((l, li) =>
		Array.from({ length: hueCount }, (_, i) => ({
			id: `hue-${Math.round((i * 360) / hueCount)}-l${li}`,
			rgb: hslToRgb((i * 360) / hueCount, 0.75, l),
		})),
	);
	return build(
		"hue-sweep",
		"Hue sweep",
		"One saturation, one lightness, every hue. Hues that come back turned are where the ribbon bends color — this is the chart that shows an indigo drifting toward magenta.",
		colors,
	);
}

// Saturation ramps per hue. The step where a ramp stops getting more saturated is
// the ribbon's gamut edge for that hue — the number a correction cannot guess.
export function chromaRampChart(
	hues = [250, 270, 210, 0, 120, 40],
	stepCount = 10,
): ChartSpec {
	const colors = hues.flatMap((h) =>
		steps(stepCount, (t) => hslToRgb(h, t, 0.5)).map((rgb, i) => ({
			id: `chroma-${h}-${i}`,
			rgb,
		})),
	);
	return build(
		"chroma-ramp",
		"Chroma ramps",
		"Saturation ramped per hue. Where a ramp stops changing is that hue's gamut edge — how much saturation the ribbon can actually hold.",
		colors,
	);
}

// ── The lattice ────────────────────────────────────────────────────────────

// An N×N×N sample of the RGB cube, split across as many cards as it takes. This
// is the input to a 3D LUT; the diagnostics above are for deciding whether you
// need one. `perCard` caps patch count so patches stay big enough to photograph.
export function latticeCharts(size = 5, perCard = 100): ChartSpec[] {
	const colors: Array<{ id: string; rgb: RGB }> = [];
	const at = (i: number) => Math.round((i / (size - 1)) * 255);
	for (let r = 0; r < size; r++) {
		for (let g = 0; g < size; g++) {
			for (let b = 0; b < size; b++) {
				colors.push({
					id: `lat-${r}-${g}-${b}`,
					rgb: [at(r), at(g), at(b)],
				});
			}
		}
	}
	const pages = Math.ceil(colors.length / perCard);
	return Array.from({ length: pages }, (_, p) =>
		build(
			`lattice-${size}-${p + 1}`,
			`Lattice ${size}³ — card ${p + 1} of ${pages}`,
			`Part ${p + 1} of an even ${size}×${size}×${size} sample of the RGB cube. Print and read every card; together they are the measurement a 3D LUT is built from.`,
			colors.slice(p * perCard, (p + 1) * perCard),
		),
	);
}

export const DIAGNOSTIC_CHARTS = (): ChartSpec[] => [
	grayBalanceChart(),
	toneWedgeChart(),
	hueSweepChart(),
	chromaRampChart(),
];

// ── Rendering ──────────────────────────────────────────────────────────────

// The spec as a freshcoat scene. Deliberately flat: solid rects, no gradients,
// no antialiased edges to average into a patch, and a white ground so unprinted
// card reads as unprinted card.
export function chartScene(spec: ChartSpec): GroupNode {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: { width: spec.width, height: spec.height },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: spec.width, height: spec.height },
			fills: [{ kind: "solid", color: "#ffffff" }],
		}),
		children: spec.patches.map(
			(p): Node =>
				createRect({
					pos: { x: p.x, y: p.y },
					size: { width: p.width, height: p.height },
					fills: [{ kind: "solid", color: hex(p.rgb) }],
				}),
		),
	});
}
