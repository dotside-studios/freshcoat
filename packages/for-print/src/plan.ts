// The planner — for-print as a consumer of freshcoat's generic adjustment API.
//
// Instead of flattening a card and correcting one image, planScene walks a
// freshcoat Node tree, classifies each layer by print intent, and attaches a
// generic freshcoat `Adjust` so the layer is corrected PER-LAYER as freshcoat
// paints it. Photos get dye-sub compensation; crisp vector/text/QR are left
// pristine — the "protect text" that per-layer planning gives for free (no mask
// needed: you simply don't adjust those layers).
//
// The dependency points at freshcoat only: for-print maps its policy
// (PrintOptimizeOptions) down to freshcoat's math (color matrix + LUT + sharpen).
// freshcoat never learns what "dye-sub" or "K panel" means.

import {
	type Adjust,
	applyAdjustColor,
	composeAdjust,
	type FrameFinish,
	type ImageNode,
	type Node,
} from "@freshcoat-js/engine";
import { analyzePixels, correctionMatrix } from "./analyze";
import { YMCKO_FINISH, YMCKO_PRESET } from "./presets";
import type {
	ChannelBalance,
	ImageAnalysis,
	PixelData,
	PrintOptimizeOptions,
} from "./types";

// Pure channel helpers the tone LUT needs (the raster steps that once held these
// moved to freshcoat's output path).
const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
// Photoshop Overlay blend of a base channel against `blend`.
const overlayBlendChannel = (base: number, blend: number): number =>
	base < 128
		? (2 * base * blend) / 255
		: 255 - (2 * (255 - base) * (255 - blend)) / 255;

// What a layer IS, for the purpose of print correction.
export type LayerIntent = "photo" | "graphic" | "text" | "code" | "container";

// Lets consumers refine the safe node-kind defaults for assets whose file type
// does not describe their print intent: a raster logo is still a graphic, while
// a photographed QR code may need photo handling. Return undefined to retain
// `classifyIntent` for that node.
export type LayerIntentResolver = (node: Node) => LayerIntent | undefined;

// Classify a node by kind. Images are photographic (need dye-sub compensation);
// text and QR/pixel bitmaps are crisp intent that must stay untouched; rect/
// ellipse/path are flat vector graphics whose colors were chosen deliberately;
// group/mask are containers we only recurse into.
export function classifyIntent(node: Node): LayerIntent {
	switch (node.kind) {
		case "image":
			return "photo";
		case "text":
			return "text";
		case "bitmap":
			return "code";
		case "rect":
		case "ellipse":
		case "path":
			return "graphic";
		default:
			return "container"; // group | mask
	}
}

// One channel's tone LUT, folding gamma then the darkness (Overlay-with-black)
// step — both per-channel, so they compose into one 256-entry table. Mirrors the
// order and math of the gamma + darkness pixel steps.
//
// `balance` is this channel's cast exponent and applies LAST, after the tone
// steps: it corrects what the printer does to the finished signal, so it belongs
// at the end of the chain rather than folded into `gamma`. At 1 the table is
// bit-identical to what it was before balance existed.
//
// Equal parameters return the same table, so freshcoat's composed-cube and LUT
// image caches hit by identity across renders. Treat it as read-only.
function toneLut(gamma: number, darkness: number, balance = 1): Uint8Array {
	const key = `${gamma}|${darkness}|${balance}`;
	const hit = toneMemo.get(key);
	if (hit) {
		toneMemo.delete(key);
		toneMemo.set(key, hit);
		return hit;
	}
	const t = buildToneLut(gamma, darkness, balance);
	toneMemo.set(key, t);
	for (const oldest of toneMemo.keys()) {
		if (toneMemo.size <= TONE_MEMO_MAX) break;
		toneMemo.delete(oldest);
	}
	return t;
}

const toneMemo = new Map<string, Uint8Array>();
const TONE_MEMO_MAX = 64;

function buildToneLut(
	gamma: number,
	darkness: number,
	balance: number,
): Uint8Array {
	const t = new Uint8Array(256);
	for (let i = 0; i < 256; i++) {
		// gamma is a rounded integer LUT (like gammaStep); darkness then operates on
		// that rounded value — staging the two rounds so this matches the pixel steps
		// run in sequence to the LSB.
		let v = clamp(255 * (i / 255) ** gamma);
		if (darkness > 0) {
			// darkness = Overlay(base, black) at `darkness` opacity, per channel.
			v = clamp(v * (1 - darkness) + overlayBlendChannel(v, 0) * darkness);
		}
		if (balance !== 1) v = clamp(255 * (v / 255) ** balance);
		t[i] = v;
	}
	return t;
}

const NEUTRAL_BALANCE = (b: ChannelBalance | undefined): boolean =>
	!b || (b.r === 1 && b.g === 1 && b.b === 1);

// Map print correction options to a generic freshcoat Adjust: saturation +
// contrast fold into the color matrix (cross-channel/linear), gamma + darkness
// into the per-channel LUT, sharpness passes through as sharpen. The conjunctive
// white-clamp / black-extraction ops are NOT here — they need all three channels
// together, so they live in freshcoat's whole-frame FrameFinish (YMCKO_FINISH).
export function printAdjust(o: PrintOptimizeOptions): Adjust {
	const adjust: Adjust = {};

	const m = correctionMatrix(o);
	if (m) {
		adjust.colorMatrix = m;
		// Card art is largely saturated brand color, where a boost drives the leading
		// channel past full scale. Clipping it there would rotate the hue — an indigo
		// pins blue and drifts magenta — and flatten the gradient it came from, so the
		// correction gives up saturation instead.
		adjust.gamut = "preserve-hue";
	}

	// One table per channel only when the balance asks for it. With no cast
	// measured, all three are the same table and the same object — the shape
	// freshcoat has always been handed.
	const darkness = o.darkness ?? 0;
	if (NEUTRAL_BALANCE(o.balance)) {
		if (o.gamma !== 1 || darkness > 0) {
			const lut = toneLut(o.gamma, darkness);
			adjust.lut = { r: lut, g: lut, b: lut };
		}
	} else {
		const b = o.balance as ChannelBalance;
		adjust.lut = {
			r: toneLut(o.gamma, darkness, b.r),
			g: toneLut(o.gamma, darkness, b.g),
			b: toneLut(o.gamma, darkness, b.b),
		};
	}

	if (o.sharpness > 0) adjust.sharpen = o.sharpness;
	return adjust;
}

// The whole-frame finish with the printer's measured cast (see ./profile) as its
// curve. The cast belongs to the printer, not to any layer, so it is corrected
// once on the composited card, where it also holds across blends and edges.
export function printFinish(
	balance?: ChannelBalance,
	base: FrameFinish = YMCKO_FINISH,
): FrameFinish {
	if (NEUTRAL_BALANCE(balance)) return base;
	const b = balance as ChannelBalance;
	return {
		...base,
		curve: {
			r: toneLut(1, 0, b.r),
			g: toneLut(1, 0, b.g),
			b: toneLut(1, 0, b.b),
		},
	};
}

// Per-intent correction policy. A value corrects that intent; null leaves it
// untouched. Undefined takes the default: photos are corrected (with the YMCKO
// preset in planScene, by analysis in analyzeScene) and everything else is left
// pristine.
export type PlanPolicy = {
	// Optional semantic override for exceptions to node-kind classification. This
	// is deliberately a resolver rather than a field on freshcoat nodes: intent
	// is print policy, not a rendering concern.
	intentFor?: LayerIntentResolver;
	photo?: PrintOptimizeOptions | null;
	graphic?: PrintOptimizeOptions | null;
	text?: PrintOptimizeOptions | null;
	code?: PrintOptimizeOptions | null;
};

function intentFor(node: Node, policy: PlanPolicy): LayerIntent {
	return policy.intentFor?.(node) ?? classifyIntent(node);
}

function policyFor(
	intent: LayerIntent,
	policy: PlanPolicy,
): PrintOptimizeOptions | null {
	switch (intent) {
		case "photo":
			return policy.photo ?? null;
		case "graphic":
			return policy.graphic ?? null;
		case "text":
			return policy.text ?? null;
		case "code":
			return policy.code ?? null;
		default:
			return null; // container
	}
}

// Attach an adjust to a leaf if the options produce a non-empty one; otherwise
// return the node untouched (no empty `adjust` field).
function withAdjust(node: Node, opts: PrintOptimizeOptions | null): Node {
	if (!opts) return node;
	const adjust = printAdjust(opts);
	if (Object.keys(adjust).length === 0) return node;
	// A layer's own adjustment is part of its design; the correction applies to
	// what it produces.
	return { ...node, adjust: composeAdjust(node.adjust, adjust) };
}

// Walk a tree, mapping every node through `leaf` (for drawables) while recursing
// into group/mask containers. Containers themselves are never adjusted — only
// their leaves — so corrections apply per drawable, not to a composited subtree.
function mapTree(node: Node, leaf: (n: Node) => Node): Node {
	if (node.kind === "group") {
		return { ...node, children: node.children.map((c) => mapTree(c, leaf)) };
	}
	if (node.kind === "mask") {
		return {
			...node,
			mask: mapTree(node.mask, leaf),
			children: node.children.map((c) => mapTree(c, leaf)),
		};
	}
	return leaf(node);
}

// Sync planner: attach a policy-driven Adjust per layer, no image I/O. Photos get
// the policy's photo preset (YMCKO by default); text/QR/graphics are left pristine
// unless the policy opts them in. Returns a new tree; the input is not mutated.
export function planScene(root: Node, policy: PlanPolicy = {}): Node {
	const p = {
		...policy,
		photo: policy.photo === undefined ? YMCKO_PRESET : policy.photo,
	};
	return mapTree(root, (node) =>
		withAdjust(node, policyFor(intentFor(node, p), p)),
	);
}

// Produces the pixel buffer to analyze for an image layer. Receives the whole
// image node (not just its src) so the caller can analyze the layer AS RENDERED —
// honoring fit/crop/size — instead of the raw source file, which over-weights
// regions a `cover` crop discards. Supplied by the caller: freshcoat owns
// decoding/rendering, keeping for-print free of any canvas.
export type ImageSampler = (image: ImageNode) => Promise<PixelData>;

export type AnalysisCache = Map<string, Promise<ImageAnalysis>>;

// An AnalysisCache that keeps at most `maxEntries`, dropping the least recently
// used first.
export function createAnalysisCache(maxEntries: number): AnalysisCache {
	return new BoundedAnalysisCache(maxEntries);
}

class BoundedAnalysisCache extends Map<string, Promise<ImageAnalysis>> {
	readonly maxEntries: number;

	constructor(maxEntries: number) {
		super();
		this.maxEntries = maxEntries;
	}

	override get(key: string): Promise<ImageAnalysis> | undefined {
		const hit = super.get(key);
		if (hit) {
			super.delete(key);
			super.set(key, hit);
		}
		return hit;
	}

	override set(key: string, value: Promise<ImageAnalysis>): this {
		super.delete(key);
		super.set(key, value);
		for (const oldest of this.keys()) {
			if (this.size <= this.maxEntries) break;
			this.delete(oldest);
		}
		return this;
	}
}

export type AnalyzeSceneOptions = {
	policy?: PlanPolicy;
	// Called once per analyzed photo with what analysis found — the gamut pressure
	// especially, which nothing downstream can recover once the render has clamped.
	// Not called for layers a `policy.photo` value opted out of analysis.
	onAnalysis?: (analysis: ImageAnalysis, node: ImageNode) => void;
	// Keeps analyses across calls.
	cache?: AnalysisCache;
	// A short stable key for an image src, such as an asset's sha256. A src it
	// returns undefined for falls back to a hash of any long src.
	srcKey?: (src: string) => string | undefined;
};

const LONG_SRC = 256;

function defaultSrcKey(src: string): string {
	if (src.length <= LONG_SRC) return src;
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < src.length; i++) {
		const c = src.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return `#${src.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

// The pixels as the layer's own adjustment leaves them, which is what the print
// correction composes onto (see withAdjust). Sharpen is spatial and left out.
function asAdjusted(pixels: PixelData, adjust: Adjust | undefined): PixelData {
	if (!adjust || !(adjust.colorMatrix || adjust.lut || adjust.lut3d))
		return pixels;
	const { data, width, height } = pixels;
	const out = new Uint8ClampedArray(data.length);
	for (let i = 0; i < data.length; i += 4) {
		const [r, g, b] = applyAdjustColor(adjust, [
			data[i] / 255,
			data[i + 1] / 255,
			data[i + 2] / 255,
		]);
		out[i] = Math.round(r * 255);
		out[i + 1] = Math.round(g * 255);
		out[i + 2] = Math.round(b * 255);
		out[i + 3] = data[i + 3];
	}
	return { data: out, width, height };
}

const tableIds = new WeakMap<object, number>();
let nextTableId = 0;

function tableId(table: object): number {
	let id = tableIds.get(table);
	if (id === undefined) {
		id = nextTableId++;
		tableIds.set(table, id);
	}
	return id;
}

// Tables by identity, as the engine's own caches key them.
function adjustKey(a: Adjust | undefined): string {
	if (!a || !(a.colorMatrix || a.lut || a.lut3d)) return "";
	return [
		a.colorMatrix?.join(",") ?? "-",
		a.gamut ?? "-",
		a.lut
			? `${tableId(a.lut.r)},${tableId(a.lut.g)},${tableId(a.lut.b)}`
			: "-",
		a.lut3d ? `${a.lut3d.size}:${tableId(a.lut3d.data)}` : "-",
	].join("|");
}

// Async planner: like planScene, but each photo layer is ANALYZED (per-image
// brightness/saturation/contrast) and corrected with its own recommendation —
// the core win over correcting one flattened card. Non-photo intents follow
// `policy` (default: untouched). A `policy.photo` value overrides analysis: null
// leaves photos alone, a preset forces a fixed correction.
export async function analyzeScene(
	sample: ImageSampler,
	root: Node,
	options: AnalyzeSceneOptions = {},
): Promise<Node> {
	const { policy = {}, onAnalysis } = options;
	const analyzePhotos = policy.photo === undefined;
	// Cache the in-flight PROMISE, not the resolved value: children walk
	// concurrently (Promise.all), so identical layers would otherwise both miss a
	// value-cache and sample twice. Key on the rendered appearance (src + fit +
	// size + focus + crop + own adjust), since the same src cropped or adjusted
	// differently analyzes differently.
	const cache = options.cache ?? new Map<string, Promise<ImageAnalysis>>();
	const srcKey = (src: string) => options.srcKey?.(src) ?? defaultSrcKey(src);
	const sampleKey = (n: ImageNode) =>
		`${srcKey(n.src)}|${n.fit}|${Math.round(n.size?.width ?? 0)}x${Math.round(n.size?.height ?? 0)}|${JSON.stringify([n.focus, n.crop])}|${adjustKey(n.adjust)}`;
	const seen = new Map<string, Promise<ImageAnalysis>>();

	function photoOptions(node: ImageNode): Promise<PrintOptimizeOptions | null> {
		if (!analyzePhotos) return Promise.resolve(policy.photo ?? null);
		const key = sampleKey(node);
		let analysis = seen.get(key);
		if (!analysis) {
			let shared = cache.get(key);
			if (!shared) {
				shared = sample(node).then((pixels) =>
					analyzePixels(asAdjusted(pixels, node.adjust)),
				);
				cache.set(key, shared);
				// A failed sample is not kept, so a later call samples again.
				shared.catch(() => {
					if (cache.get(key) === shared) cache.delete(key);
				});
			}
			// Reported once per call, so duplicated layers are one analysis and one
			// report: the same pixels counted twice would overstate the pressure.
			analysis = shared.then((result) => {
				onAnalysis?.(result, node);
				return result;
			});
			seen.set(key, analysis);
		}
		return analysis.then((a) => a.recommendation);
	}

	async function walk(node: Node): Promise<Node> {
		if (node.kind === "group") {
			return { ...node, children: await Promise.all(node.children.map(walk)) };
		}
		if (node.kind === "mask") {
			const [mask, children] = await Promise.all([
				walk(node.mask),
				Promise.all(node.children.map(walk)),
			]);
			return { ...node, mask, children };
		}
		const intent = intentFor(node, policy);
		if (node.kind === "image" && intent === "photo") {
			return withAdjust(node, await photoOptions(node));
		}
		return withAdjust(node, policyFor(intent, policy));
	}

	return walk(root);
}
