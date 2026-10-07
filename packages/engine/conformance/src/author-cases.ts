// Authors the JSON corpus. The JSON in ../cases is the source of truth the
// harness reads (and a harness in another language could read); this file is the
// ergonomic way to write it. Run: bun run conformance/src/author-cases.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdjust, identityLut3d, saturationMatrix } from "../../src/adjust";
import type { Node } from "../../src/node";
import {
	createBitmap,
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createMask,
	createPath,
	createRect,
	createText,
} from "../../src/node";
import { CHECKER_A, CHECKER_B, CHECKER_SRC, checkerPixels } from "./assets";
import { CASES_DIR } from "./corpus";
import { stringifyCase } from "./json";
import type { Assertion, Case, Profile } from "./types";

const W = 160;
const H = 120;
const FAMILY = "ConformanceFont";
const WHITE = "#ffffff";

const box = (x: number, y: number, w: number, h: number) => ({
	pos: { x, y },
	size: { width: w, height: h },
});
const solid = (color: string) => [{ kind: "solid" as const, color }];
const table = (f: (i: number) => number) =>
	Uint8Array.from({ length: 256 }, (_, i) => f(i));

// Every case paints on the same opaque white ground, so an untouched sample is
// (255,255,255,255) in each of them and "the backend drew nothing here" is one
// assertion rather than a per-case constant.
const ground = () => createRect({ ...box(0, 0, W, H), fills: solid(WHITE) });

const frame = (children: Node[]): Node =>
	createFrame({ ...box(0, 0, W, H), background: ground(), children });

const px = (
	at: [number, number],
	expect: [number, number, number, number],
	why?: string,
	tolerance?: number,
): Assertion => ({
	kind: "pixel",
	at,
	expect,
	...(why ? { why } : {}),
	...(tolerance ? { tolerance } : {}),
});

// r=109 g=79 b=209; hue 60*((r-g)/d + 4) with d=130 is 253.8.
const VIOLET = "#6d4fd1";
const VIOLET_HUE = 253.8;
const BOOST = { saturation: 1.6, contrast: 1.3 };

// The identity cube with its R and B triplets exchanged.
function swappedCube() {
	const cube = identityLut3d(2);
	for (let i = 0; i < cube.data.length; i += 3) {
		const red = cube.data[i];
		cube.data[i] = cube.data[i + 2];
		cube.data[i + 2] = red;
	}
	return cube;
}

// A saturation matrix with alpha feeding the red row, which the shader cannot carry.
function alphaTermMatrix(): number[] {
	const m = saturationMatrix(1.6).slice();
	m[3] = 0.2;
	return m;
}

const cases: Case[] = [];
const add = (
	id: string,
	title: string,
	profile: Profile,
	requires: string[],
	scene: Node,
	assertions: Assertion[],
	compile?: Case["compile"],
) =>
	cases.push({
		id,
		title,
		profile,
		requires,
		width: W,
		height: H,
		...(compile ? { compile } : {}),
		scene,
		assertions,
	});

// ─── fills ────────────────────────────────────────────────────────────────────

add(
	"fill-solid",
	"a solid fill covers its box and nothing else",
	"core",
	["fill.solid"],
	frame([createRect({ ...box(40, 30, 80, 60), fills: solid("#2f6fed") })]),
	[
		px([80, 60], [47, 111, 237, 255], "inside the rect"),
		px([10, 10], [255, 255, 255, 255], "outside it, the untouched ground"),
		px([80, 20], [255, 255, 255, 255], "above its top edge"),
	],
);

// Endpoints are in [0,1] of the box, so the stop colors land at known corners
// whatever the backend's gradient implementation.
add(
	"fill-linear",
	"a linear gradient reaches its stop colors at its endpoints",
	"core",
	["fill.linear"],
	frame([
		createRect({
			...box(0, 0, W, H),
			fills: [
				{
					kind: "linear",
					from: { x: 0, y: 0 },
					to: { x: 1, y: 0 },
					stops: [
						{ offset: 0, color: "#000000" },
						{ offset: 1, color: "#ffffff" },
					],
				},
			],
		}),
	]),
	[
		px([0, 60], [0, 0, 0, 255], "the `from` endpoint is the first stop", 2),
		px(
			[W - 1, 60],
			[255, 255, 255, 255],
			"the `to` endpoint is the last stop",
			2,
		),
		px(
			[W / 2, 60],
			[128, 128, 128, 255],
			"the midpoint is halfway between them",
			4,
		),
	],
);

add(
	"fill-radial",
	"a radial gradient is its first stop at the centre",
	"core",
	["fill.radial"],
	frame([
		createRect({
			...box(0, 0, W, H),
			fills: [
				{
					kind: "radial",
					center: { x: 0.5, y: 0.5 },
					radius: 0.5,
					stops: [
						{ offset: 0, color: "#ff0000" },
						{ offset: 1, color: "#0000ff" },
					],
				},
			],
		}),
	]),
	[
		px([W / 2, H / 2], [255, 0, 0, 255], "the centre is the first stop", 2),
		px([2, 2], [0, 0, 255, 255], "the far corner is past the last stop", 6),
	],
);

// The fill a second backend is likeliest to lack: several 2D vocabularies have
// axial and radial gradients and no angular one, so this is a natural
// "approximated" rather than "native".
add(
	"fill-angular",
	"an angular gradient sweeps from the top, clockwise",
	"core",
	["fill.angular"],
	frame([
		createRect({
			...box(0, 0, W, H),
			fills: [
				{
					kind: "angular",
					center: { x: 0.5, y: 0.5 },
					rotation: 0,
					stops: [
						{ offset: 0, color: "#ff0000" },
						{ offset: 0.5, color: "#00ff00" },
						{ offset: 1, color: "#ff0000" },
					],
				},
			],
		}),
	]),
	[
		px(
			[W / 2, 8],
			[255, 0, 0, 255],
			"0 degrees is 12 o'clock, the first stop",
			8,
		),
		px(
			[W / 2, H - 8],
			[0, 255, 0, 255],
			"half a sweep later is the middle stop",
			8,
		),
	],
);

// ─── compositing ──────────────────────────────────────────────────────────────

// multiply is a*b/255 per channel, so ground (255,128,0) under (0,255,0) is
// (0,128,0) in any correct implementation.
add(
	"blend-multiply",
	"multiply is the per-channel product",
	"core",
	["blend.multiply"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#ff8000") }),
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#00ff00"),
			blendMode: "multiply",
		}),
	]),
	[
		px([80, 60], [0, 128, 0, 255], "inside the blended rect", 2),
		px([10, 10], [255, 128, 0, 255], "the ground, unblended", 2),
	],
);

// screen is 255 - (255-a)(255-b)/255: the same pair gives (255,255,0).
add(
	"blend-screen",
	"screen is the per-channel inverse product",
	"core",
	["blend.screen"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#ff8000") }),
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#00ff00"),
			blendMode: "screen",
		}),
	]),
	[px([80, 60], [255, 255, 0, 255], "inside the blended rect", 2)],
);

add(
	"opacity",
	"opacity composites the layer against what is under it",
	"core",
	["transform.opacity"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#000000"),
			opacity: 0.5,
		}),
	]),
	[
		px([80, 60], [128, 128, 128, 255], "half black over white ground", 3),
		px([10, 10], [255, 255, 255, 255], "outside the layer"),
	],
);

// ─── clipping and masking ─────────────────────────────────────────────────────

// A shape clip in the Node IR is a mask node whose mask is that shape; the
// painter fast-paths a single opaque vector mask to clipPath. Child boxes are in
// PARENT space, so the mask and its content sit at the node's own origin.
add(
	"clip-circle",
	"a circle mask keeps the centre and drops the corners",
	"core",
	["clip.circle"],
	frame([
		createMask(
			createEllipse({ ...box(0, 0, 100, 100), fills: solid("#000000") }),
			[createRect({ ...box(0, 0, 100, 100), fills: solid("#2f6fed") })],
			{ ...box(30, 10, 100, 100) },
		),
	]),
	[
		px([80, 60], [47, 111, 237, 255], "the circle's centre"),
		px(
			[33, 13],
			[255, 255, 255, 255],
			"a corner of the box the circle does not reach",
		),
	],
);

add(
	"mask-alpha",
	"an alpha mask keeps what the mask covers",
	"core",
	["mask.alpha"],
	frame([
		createMask(
			createRect({ ...box(0, 0, 50, 100), fills: solid("#000000") }),
			[createRect({ ...box(0, 0, 100, 100), fills: solid("#2f6fed") })],
			{ ...box(30, 10, 100, 100), channel: "alpha" },
		),
	]),
	[
		px([50, 60], [47, 111, 237, 255], "under the mask's left half"),
		px([110, 60], [255, 255, 255, 255], "past its right edge, masked out"),
	],
);

add(
	"corner-radius",
	"a corner radius rounds the drawn shape",
	"core",
	["shape.cornerRadius"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#2f6fed"),
			cornerRadius: 20,
		}),
	]),
	[
		px([80, 60], [47, 111, 237, 255], "the centre is filled"),
		px([42, 32], [255, 255, 255, 255], "the rounded corner is not"),
	],
);

// ─── raster primitives ────────────────────────────────────────────────────────

// Nearest-neighbour is the point: a smoothly resampled bitmap fails on the block
// centre, not merely on the edge between blocks.
add(
	"bitmap-nearest",
	"a bitmap scales without resampling its blocks",
	"core",
	["draw.bitmap"],
	frame([
		createBitmap({
			...box(40, 20, 80, 80),
			pixels: checkerPixels(4),
			pixelWidth: 4,
			pixelHeight: 4,
		}),
	]),
	[
		px([50, 30], [...CHECKER_A, 255], "the first block, flat"),
		px([70, 30], [...CHECKER_B, 255], "its neighbour, flat and different"),
	],
);

// An image is RESAMPLED where a bitmap is not, so a block centre carries some of
// its neighbours and the exact value is the resampling kernel's, which is a
// legitimate difference between backends. The slack is wide on purpose: this
// case grades where the image landed and which way up, not how it was filtered.
add(
	"image-cover",
	"an image with fit cover fills the box",
	"core",
	["draw.image", "image.cover"],
	frame([
		createImage({ ...box(40, 20, 80, 80), src: CHECKER_SRC, fit: "cover" }),
	]),
	[
		px([50, 30], [...CHECKER_A, 255], "the first block of the source", 45),
		px([70, 30], [...CHECKER_B, 255], "its neighbour, the other colour", 45),
		px([10, 10], [255, 255, 255, 255], "outside the image box"),
	],
);

add(
	"group-fills",
	"a group's own fill paints behind its children",
	"core",
	["group.fills"],
	frame([
		createGroup(
			[createRect({ ...box(20, 15, 40, 30), fills: solid("#ff0000") })],
			{
				...box(40, 30, 80, 60),
				fills: solid("#00ff00"),
			},
		),
	]),
	[
		px([80, 60], [255, 0, 0, 255], "the child, on top"),
		px([45, 35], [0, 255, 0, 255], "the group's own fill, behind it"),
	],
);

// A multiply child over the group's own (128,128,255) and over nothing the group
// drew, on a (255,128,0) ground. Isolated, the empty part has only the child to
// mix with; passed through, it multiplies the ground.
const isolationScene = (isolate: boolean) =>
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#ff8000") }),
		createGroup(
			[
				createRect({ ...box(0, 0, 80, H), fills: solid("#8080ff") }),
				createRect({
					...box(40, 30, 80, 60),
					fills: solid("#00ff00"),
					blendMode: "multiply",
				}),
			],
			{ ...box(0, 0, W, H), ...(isolate ? { isolate: true } : {}) },
		),
	]);

add(
	"group-isolate",
	"an isolated group's blended child mixes only with the group's content",
	"core",
	["group.isolate", "blend.multiply"],
	isolationScene(true),
	[
		px([60, 60], [0, 128, 0, 255], "over the group's own content", 2),
		px([100, 60], [0, 255, 0, 255], "over nothing the group drew", 2),
		px([140, 10], [255, 128, 0, 255], "the ground, outside the child"),
	],
);

add(
	"group-pass-through",
	"a group without isolation lets a blended child mix with the ground",
	"core",
	["blend.multiply"],
	isolationScene(false),
	[
		px([60, 60], [0, 128, 0, 255], "over the group's own content", 2),
		px([100, 60], [0, 128, 0, 255], "over the ground", 2),
	],
);

// Per-corner radii on a group's clip: only the top-left corner is rounded.
add(
	"clip-per-corner",
	"a clipping group honors per-corner radii",
	"core",
	["group.clip", "shape.perCornerRadius"],
	frame([
		createGroup(
			[createRect({ ...box(0, 0, 80, 60), fills: solid("#000000") })],
			{ ...box(40, 30, 80, 60), clip: true, cornerRadius: [30, 0, 0, 0] },
		),
	]),
	[
		px([42, 32], [255, 255, 255, 255], "the rounded top-left corner"),
		px([118, 32], [0, 0, 0, 255], "the square top-right corner"),
		px([80, 60], [0, 0, 0, 255], "the interior"),
	],
);

// ─── D6: the semantics that live only in the painter ──────────────────────────

// rotation is applied to the canvas matrix OUTSIDE the layer, so the layer and
// every filter on it work in rotated space and a shadow's offset rotates with the
// element. At 90 degrees a (0, +12) shadow falls to the element's LEFT on screen.
add(
	"rotation-rotates-the-shadow",
	"a rotated element's shadow offset rotates with it",
	"core",
	["transform.rotation", "effect.shadow"],
	frame([
		createRect({
			...box(55, 35, 50, 50),
			fills: solid("#2f6fed"),
			rotation: 90,
			shadow: { color: "#000000", dx: 0, dy: 14, blur: 0 },
		}),
	]),
	[
		px(
			[48, 60],
			[0, 0, 0, 255],
			"the shadow landed LEFT of the element, rotated with it",
		),
		px(
			[80, 60],
			[47, 111, 237, 255],
			"the element itself, over its own shadow",
		),
		px(
			[80, 92],
			[255, 255, 255, 255],
			"nothing below it: an UNROTATED shadow would be here",
		),
	],
);

// clip is applied INSIDE saveLayer, so the shadow is cast from the clipped
// silhouette. A backend that clips outside the layer casts a rectangular shadow.
add(
	"clip-shapes-the-shadow",
	"a clip shapes the silhouette the shadow is cast from",
	"core",
	["clip.circle", "effect.shadow"],
	frame([
		createMask(
			createEllipse({ ...box(0, 0, 100, 100), fills: solid("#000000") }),
			[createRect({ ...box(0, 0, 100, 100), fills: solid("#2f6fed") })],
			{
				...box(30, 10, 100, 100),
				shadow: { color: "#000000", dx: 14, dy: 0, blur: 0 },
			},
		),
	]),
	[
		px(
			[46, 12],
			[255, 255, 255, 255],
			"no shadow at a box corner the circle never covers; a shadow cast from the UNMASKED box would reach here",
		),
		px([94, 60], [47, 111, 237, 255], "the masked shape"),
		px([140, 60], [0, 0, 0, 255], "the shadow, offset right of the circle"),
	],
);

// Pins LAYER_BLUR_SIGMA = blur / 2.2727. A step edge blurred by sigma reads half
// intensity AT the edge whatever sigma is, and about 84% one sigma inside it. A
// backend passing `blur` straight to a Gaussian (sigma 20 rather than 8.8) is
// still near 66% at that distance, so the band below separates them.
add(
	"blur-sigma",
	"layer blur uses Figma's radius, not the Gaussian sigma",
	"core",
	["effect.blur"],
	frame([
		createRect({ ...box(80, 0, 80, H), fills: solid("#000000"), blur: 20 }),
	]),
	[
		px(
			[80, 60],
			[128, 128, 128, 255],
			"half intensity at the edge, whatever the sigma",
			22,
		),
		px(
			[71, 60],
			[216, 216, 216, 255],
			"one sigma (8.8px) outside: ~85% of the way back to white",
			20,
		),
	],
);

// ─── raster profile ───────────────────────────────────────────────────────────

add(
	"finish-white-clamp",
	"whiteClamp snaps every channel above the threshold to white",
	"raster",
	["finish.whiteClamp"],
	frame([createRect({ ...box(0, 0, W, H), fills: solid("#fbfbfb") })]),
	[px([80, 60], [255, 255, 255, 255], "251 is above the 248 threshold")],
	{ finish: { whiteClamp: 248 } },
);

add(
	"finish-black-extract",
	"blackExtract snaps every channel below the threshold to black",
	"raster",
	["finish.blackExtract"],
	frame([createRect({ ...box(0, 0, W, H), fills: solid("#0a0a0a") })]),
	[px([80, 60], [0, 0, 0, 255], "10 is below the 30 threshold")],
	{ finish: { blackExtract: 30 } },
);

// Each channel reads its own table, then the threshold sees the curved value:
// 200 maps to 252 on red only, so whiteClamp at 248 leaves the pixel alone.
add(
	"finish-curve",
	"the finish curve maps each channel through its own table first",
	"raster",
	["finish.curve", "finish.whiteClamp"],
	frame([createRect({ ...box(0, 0, W, H), fills: solid("#c8c8c8") })]),
	[px([80, 60], [252, 200, 100, 255], "200 through r, g and b tables")],
	{
		finish: {
			curve: {
				r: table((i) => (i === 200 ? 252 : i)),
				g: table((i) => i),
				b: table((i) => (i === 200 ? 100 : i)),
			},
			whiteClamp: 248,
		},
	},
);

// The layout is the compile's at every density: a 2x export is a 2x raster of the
// SAME layout, so the rect's edges land at exactly twice their design coordinates.
add(
	"export-scale",
	"an export scales the raster, not the layout",
	"raster",
	["export.scale"],
	frame([createRect({ ...box(40, 30, 80, 60), fills: solid("#2f6fed") })]),
	[
		px([160, 120], [47, 111, 237, 255], "the design-space centre, at 2x"),
		px(
			[78, 58],
			[255, 255, 255, 255],
			"just outside the scaled top-left corner",
		),
		px([82, 62], [47, 111, 237, 255], "just inside it"),
	],
	{ scale: 2 },
);

add(
	"adjust-per-channel-lut",
	"each channel of an adjust LUT reads its own table",
	"raster",
	["adjust.lut"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#808080"),
			adjust: {
				lut: {
					r: table(() => 200),
					g: table(() => 100),
					b: table(() => 50),
				},
			},
		}),
	]),
	[px([80, 60], [200, 100, 50, 255], "a flat table per channel")],
);

// ─── text ─────────────────────────────────────────────────────────────────────

// Text arrives baked, so this grades placement rather than shaping: the glyphs
// sit inside their box and nothing spills outside it.
add(
	"text-basic",
	"baked text paints inside its box",
	"core",
	["draw.text"],
	frame([
		createText({
			...box(20, 40, 120, 40),
			text: "Hlm",
			font: {
				family: FAMILY,
				weight: 400,
				style: "normal",
				size: 32,
				lineHeight: 38,
			},
			color: "#000000",
		}),
	]),
	[
		px([10, 60], [255, 255, 255, 255], "left of the text box, untouched"),
		px([80, 110], [255, 255, 255, 255], "below it, untouched"),
		{
			kind: "differ",
			at: [24, 55],
			from: [10, 60],
			minDelta: 60,
			why: "the first glyph's stem is darker than the ground",
		},
	],
);

// ─── blend modes (exact per-channel formulas) ─────────────────────────────────

// darken and lighten are per-channel min and max, so the expected value is not
// a matter of interpretation in any implementation.
add(
	"blend-darken",
	"darken is the per-channel minimum",
	"core",
	["blend.darken"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#4080c0") }),
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#ff0000"),
			blendMode: "darken",
		}),
	]),
	[
		px([80, 60], [64, 0, 0, 255], "min of (64,128,192) and (255,0,0)", 2),
		px([10, 10], [64, 128, 192, 255], "the ground, unblended", 2),
	],
);

// linear burn is max(0, s + d - 1) per channel: (64,128,192) under
// (128,192,255) gives (0,65,192).
add(
	"blend-linear-burn",
	"linear burn adds the channels and subtracts one",
	"core",
	["blend.linear-burn"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#4080c0") }),
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#80c0ff"),
			blendMode: "linear-burn",
		}),
	]),
	[
		px([80, 60], [0, 65, 192, 255], "max(0, s + d - 1) per channel", 2),
		px([10, 10], [64, 128, 192, 255], "the ground, unblended", 2),
	],
);

add(
	"blend-lighten",
	"lighten is the per-channel maximum",
	"core",
	["blend.lighten"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#4080c0") }),
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#ff0000"),
			blendMode: "lighten",
		}),
	]),
	[px([80, 60], [255, 128, 192, 255], "max of (64,128,192) and (255,0,0)", 2)],
);

// overlay branches on the BACKDROP, not the source: 2*b*s below half, and
// 1-2*(1-b)*(1-s) at or above it. Backdrop (64,128,192) under (255,0,0) gives
// (128,1,129), which is distinct from every other mode in this corpus.
add(
	"blend-overlay",
	"overlay branches on the backdrop",
	"core",
	["blend.overlay"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#4080c0") }),
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#ff0000"),
			blendMode: "overlay",
		}),
	]),
	[
		px(
			[80, 60],
			[128, 1, 129, 255],
			"2*b*s on the low channel, the inverse product on the high two",
			3,
		),
	],
);

// difference is |b - s| per channel: backdrop (64,128,192) under (255,0,0)
// gives (191,128,192), which no mode above produces.
add(
	"blend-difference",
	"difference is the per-channel absolute difference",
	"core",
	["blend.difference"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#4080c0") }),
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#ff0000"),
			blendMode: "difference",
		}),
	]),
	[px([80, 60], [191, 128, 192, 255], "|b - s| per channel", 2)],
);

// plus (Figma's linear dodge) adds and clamps: (64,128,192) + (64,64,64) is
// (128,192,255), the blue channel saturating.
add(
	"blend-plus",
	"plus adds the channels and clamps",
	"core",
	["blend.plus"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#4080c0") }),
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#404040"),
			blendMode: "plus",
		}),
	]),
	[px([80, 60], [128, 192, 255, 255], "b + s, clamped at 255", 2)],
);

// ─── shadows ──────────────────────────────────────────────────────────────────

// spread grows the silhouette BEFORE any blur. With blur 0 and no offset the
// shadow is the shape's own outline, grown by exactly `spread` on every side.
add(
	"shadow-spread",
	"spread grows the silhouette the shadow is cast from",
	"core",
	["effect.shadow", "shadow.spread"],
	frame([
		createRect({
			...box(60, 40, 40, 40),
			fills: solid("#2f6fed"),
			shadow: { color: "#000000", dx: 0, dy: 0, blur: 0, spread: 10 },
		}),
	]),
	[
		px(
			[55, 60],
			[0, 0, 0, 255],
			"5px outside the shape, inside the 10px spread",
		),
		px([45, 60], [255, 255, 255, 255], "15px outside, past the spread"),
		px([80, 60], [47, 111, 237, 255], "the shape itself"),
	],
);

// An inset shadow inverts the silhouette, so an offset of +x darkens the shape's
// own LEFT inner edge. A backend treating inset as an ordinary shadow puts ink
// outside the shape instead, where this asserts ground.
add(
	"shadow-inset",
	"an inset shadow falls inward from the shape's edges",
	"core",
	["effect.shadow", "shadow.inset"],
	frame([
		createRect({
			...box(40, 40, 80, 40),
			fills: solid("#ffffff"),
			shadow: { color: "#000000", dx: 12, dy: 0, blur: 0, inset: true },
		}),
	]),
	[
		px(
			[45, 60],
			[0, 0, 0, 255],
			"inside the left edge, where the inverted silhouette lands",
		),
		px([100, 60], [255, 255, 255, 255], "the shape's interior, past the band"),
		px(
			[130, 60],
			[255, 255, 255, 255],
			"outside the shape: an ordinary shadow would be here",
		),
	],
);

// A stack paints bottom-up, so both entries are drawn. A backend reading only a
// single Shadow silently loses one.
add(
	"shadow-stacked",
	"every shadow in a stack is painted",
	"core",
	["effect.shadow", "shadow.stacked"],
	frame([
		createRect({
			...box(70, 50, 40, 40),
			fills: solid("#ffffff"),
			shadow: [
				{ color: "#ff0000", dx: -20, dy: 0, blur: 0 },
				{ color: "#0000ff", dx: 20, dy: 0, blur: 0 },
			],
		}),
	]),
	[
		px([55, 70], [255, 0, 0, 255], "the first entry, offset left"),
		px([125, 70], [0, 0, 255, 255], "the second entry, offset right"),
	],
);

// ─── masking ──────────────────────────────────────────────────────────────────

// A luminance mask reads brightness rather than alpha, so an opaque black-to-
// white ramp is a coverage ramp. A backend using alpha here keeps everything,
// since every pixel of the mask is opaque.
add(
	"mask-luminance",
	"a luminance mask reads brightness, not alpha",
	"core",
	["mask.luminance"],
	frame([
		createMask(
			createRect({
				...box(0, 0, 100, 80),
				fills: [
					{
						kind: "linear",
						from: { x: 0, y: 0 },
						to: { x: 1, y: 0 },
						stops: [
							{ offset: 0, color: "#ffffff" },
							{ offset: 1, color: "#000000" },
						],
					},
				],
			}),
			[createRect({ ...box(0, 0, 100, 80), fills: solid("#2f6fed") })],
			{ ...box(30, 20, 100, 80), channel: "luminance" },
		),
	]),
	[
		px(
			[33, 60],
			[53, 115, 238, 255],
			"97% coverage 3px into a 100px ramp, over white ground",
			3,
		),
		px([127, 60], [249, 250, 254, 255], "3% coverage 3px from its end", 3),
	],
);

// The half of the fast path that is easy to miss: this mask is a single opaque
// shape, so it is exactly what the clipPath fast path is for, and under
// `luminance` its coverage is its COLOUR rather than its geometry. Black is zero
// luminance, so nothing survives. A backend that treats a shape mask as a clip
// keeps the whole rect.
add(
	"mask-luminance-opaque-shape",
	"an opaque black mask under luminance drops everything",
	"core",
	["mask.luminance"],
	frame([
		createMask(
			createRect({ ...box(0, 0, 100, 80), fills: solid("#000000") }),
			[createRect({ ...box(0, 0, 100, 80), fills: solid("#2f6fed") })],
			{ ...box(30, 20, 100, 80), channel: "luminance" },
		),
	]),
	[
		px(
			[80, 60],
			[255, 255, 255, 255],
			"zero luminance masks the content out entirely",
		),
		px(
			[35, 25],
			[255, 255, 255, 255],
			"including where the shape plainly covers it",
		),
	],
);

add(
	"mask-luminance-alpha",
	"a luminance mask's coverage is its luminance times its alpha",
	"core",
	["mask.luminance", "mask.invert"],
	frame([
		createMask(
			createRect({ ...box(0, 0, 50, 80), fills: solid("#ffffff80") }),
			[createRect({ ...box(0, 0, 50, 80), fills: solid("#2f6fed") })],
			{ ...box(30, 20, 50, 80), channel: "luminance" },
		),
		createMask(
			createRect({ ...box(0, 0, 50, 80), fills: solid("#ffffff40") }),
			[createRect({ ...box(0, 0, 50, 80), fills: solid("#2f6fed") })],
			{ ...box(80, 20, 50, 80), channel: "luminance", invert: true },
		),
	]),
	[
		px(
			[55, 60],
			[151, 183, 246, 255],
			"white at 50% alpha keeps 50% of the content, not all of it",
			3,
		),
		px(
			[105, 60],
			[99, 147, 242, 255],
			"inverted white at 25% alpha keeps 75%",
			3,
		),
	],
);

add(
	"mask-invert",
	"invert flips the mask's coverage",
	"core",
	["mask.alpha", "mask.invert"],
	frame([
		createMask(
			createRect({ ...box(0, 0, 50, 100), fills: solid("#000000") }),
			[createRect({ ...box(0, 0, 100, 100), fills: solid("#2f6fed") })],
			{ ...box(30, 10, 100, 100), channel: "alpha", invert: true },
		),
	]),
	[
		px([50, 60], [255, 255, 255, 255], "under the mask, now dropped"),
		px([110, 60], [47, 111, 237, 255], "past its edge, now kept"),
	],
);

// ─── shapes ───────────────────────────────────────────────────────────────────

add(
	"ellipse",
	"an ellipse fills the ellipse inscribed in its box",
	"core",
	["draw.ellipse"],
	frame([createEllipse({ ...box(30, 20, 100, 80), fills: solid("#2f6fed") })]),
	[
		px([80, 60], [47, 111, 237, 255], "the centre"),
		px(
			[34, 24],
			[255, 255, 255, 255],
			"a corner of the box the ellipse does not reach",
		),
	],
);

// The path is authored in a 10x10 viewBox and scaled into an 80x80 box, so the
// hypotenuse runs corner to corner and the two samples sit either side of it.
add(
	"path-viewbox",
	"a viewBox scales path data into the node box",
	"core",
	["draw.path", "path.viewBox"],
	frame([
		createPath({
			...box(40, 20, 80, 80),
			d: "M0 0 H10 V10 Z",
			viewBox: { width: 10, height: 10 },
			fills: solid("#2f6fed"),
		}),
	]),
	[
		px(
			[110, 30],
			[47, 111, 237, 255],
			"above the hypotenuse, inside the triangle",
		),
		px([50, 90], [255, 255, 255, 255], "below it, outside"),
	],
);

// Two squares wound the same way. Under nonzero the inner one is inside twice
// and fills; under evenodd it is inside an even number of times and is a hole.
add(
	"path-fill-rule",
	"evenodd cuts the hole nonzero fills",
	"core",
	["draw.path", "path.fillRule"],
	frame([
		createPath({
			...box(20, 20, 60, 60),
			d: "M0 0 H60 V60 H0 Z M15 15 H45 V45 H15 Z",
			fills: solid("#2f6fed"),
		}),
		createPath({
			...box(90, 20, 60, 60),
			d: "M0 0 H60 V60 H0 Z M15 15 H45 V45 H15 Z",
			fillRule: "evenodd",
			fills: solid("#2f6fed"),
		}),
	]),
	[
		px([50, 50], [47, 111, 237, 255], "nonzero: the inner square fills"),
		px([120, 50], [255, 255, 255, 255], "evenodd: the inner square is a hole"),
		px([95, 25], [47, 111, 237, 255], "evenodd: the ring itself fills"),
	],
);

// Order is [topLeft, topRight, bottomRight, bottomLeft], so only the top-right
// corner is cut. A backend reading the array in another order fails on one of
// these two samples rather than both.
add(
	"corner-radius-per-corner",
	"a per-corner radius rounds only the corners it names",
	"core",
	["shape.cornerRadius", "shape.perCornerRadius"],
	frame([
		createRect({
			...box(40, 20, 80, 80),
			fills: solid("#2f6fed"),
			cornerRadius: [0, 40, 0, 0],
		}),
	]),
	[
		px([42, 22], [47, 111, 237, 255], "top-left, radius 0, square"),
		px([118, 22], [255, 255, 255, 255], "top-right, radius 40, cut away"),
		px([118, 98], [47, 111, 237, 255], "bottom-right, radius 0, square"),
	],
);

// ─── strokes ──────────────────────────────────────────────────────────────────

// The default alignment is centred: an 8px stroke straddles the edge, 4px each
// side. The rect's fill matches the ground so only the stroke is under test.
add(
	"stroke-centered",
	"an unaligned stroke straddles the shape edge",
	"core",
	["draw.stroke"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#ffffff"),
			stroke: { color: "#000000", width: 8 },
		}),
	]),
	[
		px([40, 60], [0, 0, 0, 255], "on the edge, inside the stroke"),
		px([80, 60], [255, 255, 255, 255], "the interior"),
		px([30, 60], [255, 255, 255, 255], "10px outside, past the stroke"),
	],
);

// `inside` moves the whole width within the edge, so the band sits at 40..48
// rather than 36..44. The two samples are exactly what separates the two.
add(
	"stroke-inside",
	"an inside-aligned stroke sits wholly within the edge",
	"core",
	["draw.stroke", "stroke.align"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#ffffff"),
			stroke: { color: "#000000", width: 8, align: "inside" },
		}),
	]),
	[
		px([44, 60], [0, 0, 0, 255], "inside the edge, where the band moved to"),
		px(
			[36, 60],
			[255, 255, 255, 255],
			"outside the edge, where a centred stroke would reach",
		),
	],
);

// `outside` on an ellipse strokes the ellipse outset by half the width, so the
// band at the left edge is 32..40 and the interior next to the edge stays clear.
add(
	"stroke-outside-ellipse",
	"an outside-aligned stroke on an ellipse sits wholly beyond its edge",
	"core",
	["draw.ellipse", "draw.stroke", "stroke.align"],
	frame([
		createEllipse({
			...box(40, 30, 80, 60),
			fills: solid("#ffffff"),
			stroke: { color: "#000000", width: 8, align: "outside" },
		}),
	]),
	[
		px([36, 60], [0, 0, 0, 255], "outside the edge, where the band moved to"),
		px(
			[44, 60],
			[255, 255, 255, 255],
			"inside the edge, where a centred stroke would reach",
		),
	],
);

// A path has no inset geometry, so `inside` is the path's own interior. The
// triangle's left edge is x = 40 at mid-height.
add(
	"stroke-inside-path",
	"an inside-aligned stroke on a path stays within the path",
	"core",
	["draw.path", "draw.stroke", "stroke.align"],
	frame([
		createPath({
			...box(40, 20, 80, 80),
			d: "M 0 0 L 80 40 L 0 80 Z",
			fills: solid("#ffffff"),
			stroke: { color: "#000000", width: 8, align: "inside" },
		}),
	]),
	[
		px([44, 60], [0, 0, 0, 255], "inside the left edge"),
		px(
			[36, 60],
			[255, 255, 255, 255],
			"outside the left edge, where a centred stroke would reach",
		),
	],
);

// Under evenodd the hole of a ring is outside the path, so an outside stroke
// lines the hole as well as the outer edge. The ring's body matches the ground.
add(
	"stroke-outside-path-evenodd",
	"an outside-aligned stroke follows the path's fill rule",
	"core",
	["draw.path", "path.fillRule", "draw.stroke", "stroke.align"],
	frame([
		createPath({
			...box(40, 20, 80, 80),
			d: "M 0 0 H 80 V 80 H 0 Z M 20 20 H 60 V 60 H 20 Z",
			fillRule: "evenodd",
			fills: solid("#ffffff"),
			stroke: { color: "#000000", width: 8, align: "outside" },
		}),
	]),
	[
		px([36, 60], [0, 0, 0, 255], "beyond the outer edge"),
		px([64, 60], [0, 0, 0, 255], "inside the hole, along its edge"),
		px([50, 60], [255, 255, 255, 255], "the ring's body"),
		px([80, 60], [255, 255, 255, 255], "the middle of the hole"),
	],
);

// An image's stroke follows its mask, inset by half the width for `inside`.
add(
	"stroke-inside-image-mask",
	"an inside-aligned stroke on a masked image follows the mask inward",
	"core",
	["draw.image", "draw.stroke", "stroke.align"],
	frame([
		createImage({
			...box(40, 20, 80, 80),
			src: CHECKER_SRC,
			fit: "cover",
			mask: { kind: "circle" },
			stroke: { color: "#000000", width: 8, align: "inside" },
		}),
	]),
	[
		px([44, 60], [0, 0, 0, 255], "inside the circle's left edge"),
		px([36, 60], [255, 255, 255, 255], "outside the circle's left edge"),
	],
);

// ─── images ───────────────────────────────────────────────────────────────────

// contain fits the whole source inside the box and letterboxes the rest, so a
// square source in a wide box leaves ground either side.
add(
	"image-contain",
	"fit contain letterboxes rather than cropping",
	"core",
	["draw.image", "image.contain"],
	frame([
		createImage({ ...box(30, 30, 100, 60), src: CHECKER_SRC, fit: "contain" }),
	]),
	[
		px(
			[35, 60],
			[255, 255, 255, 255],
			"the left letterbox band, untouched ground",
		),
		px([125, 60], [255, 255, 255, 255], "the right band"),
		px(
			[57, 37],
			[...CHECKER_A, 255],
			"a block of the fitted image (its CENTRE is a four-block junction)",
			60,
		),
	],
);

// A source that cannot be loaded must warn AND still paint something, so a
// failed image is visible rather than a hole the layout does not account for.
add(
	"image-missing",
	"a failed image warns and paints a placeholder",
	"core",
	["draw.image", "image.placeholder"],
	frame([
		createImage({
			...box(40, 20, 80, 80),
			src: "conformance:missing",
			fit: "cover",
		}),
	]),
	[
		{
			kind: "warning",
			warning: "image_load_failed",
			why: "the src could not be loaded",
		},
		{
			kind: "differ",
			at: [80, 60],
			from: [10, 10],
			minDelta: 8,
			why: "a placeholder is drawn, not nothing",
		},
	],
);

// ─── adjust ───────────────────────────────────────────────────────────────────

// The matrix is 4x5, row-major, RGBA rows plus a bias column. This one swaps R
// and B, which is unambiguous: a backend reading the matrix column-major or
// transposed produces something else.
add(
	"adjust-color-matrix",
	"a colorMatrix is row-major RGBA rows plus bias",
	"core",
	["adjust.colorMatrix"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#2f6fed"),
			adjust: {
				colorMatrix: [
					0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0,
				],
			},
		}),
	]),
	[px([80, 60], [237, 111, 47, 255], "(47,111,237) with R and B exchanged", 2)],
);

// out = round(255*(i/255)^gamma), so 128 at gamma 2 is 64. The LUT runs through
// an offscreen shader pass rather than a color filter, which is the part a
// second backend is likeliest to implement differently.
add(
	"adjust-gamma-lut",
	"a gamma LUT is a per-channel transfer curve",
	"raster",
	["adjust.lut"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#808080"),
			adjust: buildAdjust({ gamma: 2 }),
		}),
	]),
	[
		px([80, 60], [64, 64, 64, 255], "128 at gamma 2 is 64", 2),
		px(
			[10, 10],
			[255, 255, 255, 255],
			"the ground is outside the adjusted layer",
		),
	],
);

// ─── text ─────────────────────────────────────────────────────────────────────

add(
	"text-align-right",
	"align right pushes the line to the box's right edge",
	"core",
	["draw.text", "text.align"],
	frame([
		createText({
			...box(20, 40, 120, 40),
			text: "Hlm",
			font: {
				family: FAMILY,
				weight: 400,
				style: "normal",
				size: 32,
				lineHeight: 38,
			},
			color: "#000000",
			align: "right",
		}),
	]),
	[
		px([24, 55], [255, 255, 255, 255], "the left of the box is now empty"),
		{
			kind: "differ",
			at: [84, 55],
			from: [10, 60],
			minDelta: 60,
			why: "the line moved right: its first stem is at 84, where the left-aligned case has its at 24",
		},
	],
);

// Justify stretches the first line's word gaps until its last glyph meets the
// box's right edge; the last line keeps its natural, left-aligned width.
add(
	"text-align-justify",
	"justify spreads a wrapped line to both edges of the box",
	"core",
	["draw.text", "text.align", "text.justify"],
	frame([
		createText({
			...box(10, 10, 140, 100),
			text: "Hl Hl Hl Hl Hl Hlm Hl",
			font: {
				family: FAMILY,
				weight: 400,
				style: "normal",
				size: 24,
				lineHeight: 1.25,
			},
			color: "#000000",
			align: "justify",
		}),
	]),
	[
		{
			kind: "differ",
			at: [146, 18],
			from: [5, 5],
			minDelta: 200,
			why: "the first line's last stem lands on the box's right edge (150)",
		},
		px([146, 48], [255, 255, 255, 255], "the last line keeps its width"),
	],
);

// A right-to-left line is shaped in that direction: the trailing "!" is
// reordered to the line's left, ahead of "Hl".
add(
	"text-direction-rtl",
	"an RTL line orders its runs right to left",
	"core",
	["draw.text", "text.direction"],
	frame([
		createText({
			...box(20, 40, 120, 40),
			text: "Hl!",
			font: {
				family: FAMILY,
				weight: 400,
				style: "normal",
				size: 32,
				lineHeight: 1.2,
			},
			color: "#000000",
			direction: "rtl",
			align: "left",
		}),
	]),
	[
		{
			kind: "differ",
			at: [23, 45],
			from: [10, 60],
			minDelta: 200,
			why: "the reordered ! stands at the line's left",
		},
		px([23, 57], [255, 255, 255, 255], "the gap between the ! and its dot"),
		px(
			[27, 51],
			[255, 255, 255, 255],
			"between the ! and the H, where a left-to-right line has the H's crossbar",
		),
	],
);

// tnum gives Geist's narrow "1" a figure-wide advance, so four of them run
// much further right than the proportional four would.
add(
	"text-font-features",
	"OpenType features are applied when the line is shaped",
	"core",
	["draw.text", "text.fontFeatures"],
	frame([
		createText({
			...box(20, 40, 120, 40),
			text: "1111",
			font: {
				family: FAMILY,
				weight: 400,
				style: "normal",
				size: 32,
				lineHeight: 1.2,
				features: { tnum: 1 },
			},
			color: "#000000",
		}),
	]),
	[
		{
			kind: "differ",
			at: [86, 55],
			from: [10, 60],
			minDelta: 200,
			why: "the fourth tabular 1 stands at 86; the proportional four end near 63",
		},
		px(
			[40, 55],
			[255, 255, 255, 255],
			"where the second proportional 1 would be",
		),
	],
);

// maxLines truncates after wrapping, so the second line's band stays ground.
add(
	"text-max-lines",
	"maxLines truncates the wrapped paragraph",
	"core",
	["draw.text", "text.maxLines"],
	frame([
		createText({
			...box(10, 10, 140, 100),
			text: "Hlm Hlm Hlm Hlm Hlm Hlm Hlm Hlm",
			font: {
				family: FAMILY,
				weight: 400,
				style: "normal",
				size: 28,
				lineHeight: 34,
			},
			color: "#000000",
			maxLines: 1,
		}),
	]),
	[
		px([20, 80], [255, 255, 255, 255], "the second line's band is empty"),
		{
			kind: "differ",
			at: [14, 25],
			from: [10, 100],
			minDelta: 60,
			why: "the first line is drawn",
		},
	],
);

// ─── raster density ───────────────────────────────────────────────────────────

// supersample raises the sample count without changing the output size, so the
// geometry is exactly the 1x geometry: a backend that forgot to reduce would
// land these samples somewhere else entirely.
add(
	"supersample",
	"supersampling changes samples, not output geometry",
	"raster",
	["export.supersample"],
	frame([createRect({ ...box(40, 30, 80, 60), fills: solid("#2f6fed") })]),
	[
		px(
			[80, 60],
			[47, 111, 237, 255],
			"the centre, at the design-space coordinate",
		),
		px([10, 10], [255, 255, 255, 255], "outside the rect"),
	],
	{ supersample: 2 },
);

// Dither exists to break banding, so its signature is that a flat field stops
// being flat. Seeded, so the pattern is reproducible.
add(
	"finish-dither",
	"dither perturbs a flat field",
	"raster",
	["finish.dither"],
	frame([createRect({ ...box(0, 0, W, H), fills: solid("#808080") })]),
	[
		{
			kind: "differ",
			at: [40, 60],
			from: [41, 60],
			minDelta: 1,
			why: "adjacent pixels of a flat fill differ once dithered",
		},
	],
	{ finish: { dither: { amount: 16, seed: 0, mode: "monochrome" } } },
);

// ─── adjust, migrated from tests/adjust.test.ts ───────────────────────────────
//
// Those tests rendered twice and compared the two PNGs. Here each case is one
// scene carrying both the adjusted layer and an unadjusted control, which is
// what makes the expectation a fixed value rather than a relation between two
// runs. The colour MATH stays in that file: buildAdjust producing the right
// matrix is compile-side and needs no painter.

// saturation 0 collapses a layer to its own luma, Rec.709 weighted:
// 0.2126*204 + 0.7152*51 + 0.0722*51 = 84.
add(
	"adjust-saturation-zero",
	"saturation 0 collapses a layer to its luma",
	"core",
	["adjust.colorMatrix"],
	frame([
		createRect({ ...box(20, 30, 50, 60), fills: solid("#cc3333") }),
		createRect({
			...box(90, 30, 50, 60),
			fills: solid("#cc3333"),
			adjust: buildAdjust({ saturation: 0 }),
		}),
	]),
	[
		px([45, 60], [204, 51, 51, 255], "the control keeps its red cast", 2),
		px(
			[115, 60],
			[84, 84, 84, 255],
			"the adjusted layer is neutral at the source luma",
			3,
		),
	],
);

// A 3D cube corrects channels that interact, which three independent 1D curves
// cannot express. This one is the identity cube with its R and B swapped, so
// (200,64,32) comes back (32,64,200) after trilinear sampling.
add(
	"adjust-lut3d",
	"a 3D LUT applies a cross-channel correction",
	"raster",
	["adjust.lut3d"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#c84020"),
			adjust: { lut3d: swappedCube() },
		}),
	]),
	[
		px([80, 60], [32, 64, 200, 255], "R and B exchanged through the cube", 16),
		{
			kind: "warning",
			warning: "adjust_unsupported",
			absent: true,
			why: "the cube is supported, so nothing is dropped",
		},
	],
);

// The offscreen pass composites its snapshot in device coordinates, so it has to
// inherit the canvas transform exactly once. Rotating the child's centre (30,60)
// by 90 degrees about the frame centre (80,60) lands it at (80,10); a pass that
// rotated an already-rotated snapshot again put it at (80,110).
add(
	"adjust-in-rotated-group",
	"an adjusted layer inherits a rotated ancestor exactly once",
	"raster",
	["adjust.lut", "transform.rotation"],
	frame([
		createGroup(
			[
				createRect({
					...box(20, 50, 20, 20),
					fills: solid("#808080"),
					adjust: buildAdjust({ gamma: 2 }),
				}),
			],
			{ ...box(0, 0, W, H), rotation: 90 },
		),
	]),
	[
		px(
			[80, 10],
			[64, 64, 64, 255],
			"where one rotation puts it, gamma-darkened",
			12,
		),
		px(
			[80, 110],
			[255, 255, 255, 255],
			"where rotating the snapshot twice would put it",
		),
	],
);

// A saturated violet under a strong boost drives blue past full scale. Clipping
// pins blue while red and green keep moving, which reads as a hue rotation
// toward magenta; preserve-hue gives chroma back instead, so the hue survives.
// Both layers are in one scene at the same source colour, so the two modes are
// compared against the same input rather than across two renders.
add(
	"adjust-preserve-hue",
	"preserve-hue holds the hue a clipping boost rotates",
	"raster",
	["adjust.colorMatrix", "adjust.preserveHue"],
	frame([
		createRect({
			...box(20, 30, 50, 60),
			fills: solid(VIOLET),
			adjust: buildAdjust(BOOST),
		}),
		createRect({
			...box(90, 30, 50, 60),
			fills: solid(VIOLET),
			adjust: buildAdjust({ ...BOOST, preserveHue: true }),
		}),
	]),
	[
		{
			kind: "hue",
			at: [115, 60],
			expect: VIOLET_HUE,
			tolerance: 1.5,
			why: "preserve-hue stays on the source hue",
		},
		{
			kind: "hue",
			at: [45, 60],
			expect: VIOLET_HUE,
			awayBy: 3,
			why: "clipping walks the hue off toward magenta",
		},
		{ kind: "warning", warning: "adjust_unsupported", absent: true },
	],
);

// Matrix and cube-free LUT both run shader-side here, and the LUT indexes 0-255,
// so it only produces a sane colour if the gamut step handed it an in-range one.
add(
	"adjust-preserve-hue-with-lut",
	"preserve-hue composes with a LUT in one pass",
	"raster",
	["adjust.colorMatrix", "adjust.lut", "adjust.preserveHue"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid(VIOLET),
			adjust: buildAdjust({ ...BOOST, gamma: 0.9, preserveHue: true }),
		}),
	]),
	[
		{
			kind: "hue",
			at: [80, 60],
			expect: VIOLET_HUE,
			tolerance: 2,
			why: "the curve ran after the gamut step, not instead of it",
		},
		{ kind: "warning", warning: "adjust_unsupported", absent: true },
	],
);

// The shader carries alpha alongside unpremultiplied RGB, so a matrix feeding
// alpha into a colour row cannot move onto it. The layer still paints, through
// the clipping colour filter, and the warning has to name WHICH component was
// dropped and on WHICH layer — a warning that names neither is barely better
// than silence.
add(
	"adjust-alpha-matrix-falls-back",
	"a matrix with alpha terms drops preserve-hue, and says so",
	"raster",
	["adjust.colorMatrix", "adjust.preserveHue"],
	frame([
		createRect({
			id: "portrait-photo",
			...box(40, 30, 80, 60),
			fills: solid(VIOLET),
			adjust: { colorMatrix: alphaTermMatrix(), gamut: "preserve-hue" },
		}),
	]),
	[
		{
			kind: "warning",
			warning: "adjust_unsupported",
			match: { component: "gamut", layer: "portrait-photo" },
			why: "the dropped component and the layer that lost it",
		},
	],
);

add(
	"adjust-sharpen",
	"sharpen runs as a spatial pass without dropping anything",
	"raster",
	["adjust.sharpen"],
	frame([
		createRect({
			...box(40, 30, 80, 60),
			fills: solid("#cc3333"),
			adjust: buildAdjust({ sharpen: 0.5 }),
		}),
	]),
	[
		px(
			[80, 60],
			[204, 51, 51, 255],
			"a flat interior is unchanged by an unsharp mask",
			6,
		),
		{ kind: "warning", warning: "adjust_unsupported", absent: true },
	],
);

// The LUT is the identity, so the layer still reads as plain multiply: the blend
// meets the real destination, not the transparent offscreen the LUT runs in.
const identityLut = () => ({
	lut: { r: table((i) => i), g: table((i) => i), b: table((i) => i) },
});
add(
	"adjust-lut-keeps-blend",
	"an adjusted layer keeps its blend mode and opacity",
	"raster",
	["adjust.lut", "blend.multiply", "transform.opacity"],
	frame([
		createRect({ ...box(0, 0, W, H), fills: solid("#0000ff") }),
		createRect({
			...box(20, 30, 50, 60),
			fills: solid("#ff0000"),
			blendMode: "multiply",
			adjust: identityLut(),
		}),
		createRect({
			...box(90, 30, 50, 60),
			fills: solid("#ffffff"),
			opacity: 0.5,
			adjust: identityLut(),
		}),
	]),
	[
		px([45, 60], [0, 0, 0, 255], "multiply of red over blue", 2),
		px([115, 60], [128, 128, 255, 255], "half opacity applied once", 2),
		{ kind: "warning", warning: "adjust_unsupported", absent: true },
	],
);

// ─── layer effect order ───────────────────────────────────────────────────────

// Adjust recolors the drawable, not the shadows it casts: a shadow keeps its own
// color, as in Figma. A backend running the adjust over the finished layer
// darkens the shadow to (4,16,144) under the LUT and turns it red under the
// matrix.
add(
	"adjust-lut-keeps-shadow-color",
	"a LUT adjusts the content and leaves the drop shadow's color",
	"raster",
	["adjust.lut", "effect.shadow"],
	frame([
		createRect({
			...box(20, 40, 40, 40),
			fills: solid("#808080"),
			shadow: { color: "#2040c0", dx: 60, dy: 0, blur: 0 },
			adjust: buildAdjust({ gamma: 2 }),
		}),
	]),
	[
		px([40, 60], [64, 64, 64, 255], "128 at gamma 2 is 64", 2),
		px([100, 60], [32, 64, 192, 255], "the shadow in its own color", 2),
	],
);

add(
	"adjust-matrix-keeps-shadow-color",
	"a colorMatrix adjusts the content and leaves the drop shadow's color",
	"core",
	["adjust.colorMatrix", "effect.shadow"],
	frame([
		createRect({
			...box(20, 40, 40, 40),
			fills: solid("#2f6fed"),
			shadow: { color: "#2040c0", dx: 60, dy: 0, blur: 0 },
			adjust: {
				colorMatrix: [
					0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0,
				],
			},
		}),
	]),
	[
		px([40, 60], [237, 111, 47, 255], "(47,111,237) with R and B exchanged", 2),
		px([100, 60], [32, 64, 192, 255], "the shadow in its own color", 2),
	],
);

mkdirSync(CASES_DIR, { recursive: true });
for (const c of cases)
	writeFileSync(join(CASES_DIR, `${c.id}.json`), stringifyCase(c));
console.log(`wrote ${cases.length} cases to ${CASES_DIR}`);
