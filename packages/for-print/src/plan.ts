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

import type { Adjust, ImageNode, Node } from "@freshcoat-js/engine";
import { analyzePixels, correctionMatrix } from "./analyze";
import { NO_PROCESSING, YMCKO_PRESET } from "./presets";
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
function toneLut(gamma: number, darkness: number, balance = 1): Uint8Array {
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

// Per-intent correction policy. A value corrects that intent; null/undefined
// leaves it untouched. The default corrects photos with the YMCKO preset and
// leaves everything else pristine.
export type PlanPolicy = {
	// Optional semantic override for exceptions to node-kind classification. This
	// is deliberately a resolver rather than a field on freshcoat nodes: intent
	// is print policy, not a rendering concern.
	intentFor?: LayerIntentResolver;
	photo?: PrintOptimizeOptions | null;
	graphic?: PrintOptimizeOptions | null;
	text?: PrintOptimizeOptions | null;
	code?: PrintOptimizeOptions | null;
	// The printer's measured cast (see ./profile), applied to EVERY drawable —
	// including the ones the intents above leave pristine.
	//
	// A cast belongs to the printer, not to the art: the ribbon lays down the same
	// too-warm red under a photo, a brand gradient and a line of text alike. Scoping
	// it by intent would also miss the layer that shows it most, since a card whose
	// ground is a vector rect is `graphic` and correcting graphics is off by
	// default. It is a per-channel curve with no spatial effect, so a text or QR
	// layer stays exactly as crisp as it was.
	balance?: ChannelBalance;
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
// return the node untouched (no empty `adjust` field). A measured `balance`
// reaches a layer the intent left alone as the only correction it carries.
function withAdjust(
	node: Node,
	opts: PrintOptimizeOptions | null,
	balance?: ChannelBalance,
): Node {
	const merged = opts
		? balance
			? { ...opts, balance }
			: opts
		: balance
			? { ...NO_PROCESSING, balance }
			: null;
	if (!merged) return node;
	const adjust = printAdjust(merged);
	return Object.keys(adjust).length > 0 ? { ...node, adjust } : node;
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

const DEFAULT_POLICY: PlanPolicy = { photo: YMCKO_PRESET };

// Sync planner: attach a policy-driven Adjust per layer, no image I/O. Photos get
// the policy's photo preset (YMCKO by default); text/QR/graphics are left pristine
// unless the policy opts them in. Returns a new tree; the input is not mutated.
export function planScene(root: Node, policy: PlanPolicy = {}): Node {
	const p = { ...DEFAULT_POLICY, ...policy };
	return mapTree(root, (node) =>
		withAdjust(node, policyFor(intentFor(node, p), p), p.balance),
	);
}

// Produces the pixel buffer to analyze for an image layer. Receives the whole
// image node (not just its src) so the caller can analyze the layer AS RENDERED —
// honoring fit/crop/size — instead of the raw source file, which over-weights
// regions a `cover` crop discards. Supplied by the caller: freshcoat owns
// decoding/rendering, keeping for-print free of any canvas.
export type ImageSampler = (image: ImageNode) => Promise<PixelData>;

// Async planner: like planScene, but each photo layer is ANALYZED (per-image
// brightness/saturation/contrast) and corrected with its own recommendation —
// the core win over correcting one flattened card. Non-photo intents follow
// `policy` (default: untouched). Pass `policy.photo` explicitly to override
// analysis: `null` leaves photos alone, a preset forces a fixed correction.
// Recommendations are cached per src.
export async function analyzeScene(
	sample: ImageSampler,
	root: Node,
	policy: PlanPolicy = {},
	// Called once per analyzed photo with what analysis found — the gamut pressure
	// especially, which nothing downstream can recover once the render has clamped.
	// Not called for layers an explicit `policy.photo` opted out of analysis.
	onAnalysis?: (analysis: ImageAnalysis, node: ImageNode) => void,
): Promise<Node> {
	const analyzePhotos = !("photo" in policy);
	// Cache the in-flight PROMISE, not the resolved value: children walk
	// concurrently (Promise.all), so identical layers would otherwise both miss a
	// value-cache and sample twice. Key on the rendered appearance (src + fit +
	// size), since the same src cropped differently analyzes differently.
	const cache = new Map<string, Promise<ImageAnalysis>>();
	const sampleKey = (n: ImageNode) =>
		`${n.src}|${n.fit}|${Math.round(n.size?.width ?? 0)}x${Math.round(n.size?.height ?? 0)}`;

	function photoOptions(node: ImageNode): Promise<PrintOptimizeOptions | null> {
		if (!analyzePhotos) return Promise.resolve(policy.photo ?? null);
		const key = sampleKey(node);
		let analysis = cache.get(key);
		if (!analysis) {
			// Reported on the miss, so duplicated layers are one analysis and one
			// report — the same pixels counted twice would overstate the pressure.
			analysis = sample(node).then((px) => {
				const result = analyzePixels(px);
				onAnalysis?.(result, node);
				return result;
			});
			cache.set(key, analysis);
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
			return withAdjust(node, await photoOptions(node), policy.balance);
		}
		return withAdjust(node, policyFor(intent, policy), policy.balance);
	}

	return walk(root);
}
