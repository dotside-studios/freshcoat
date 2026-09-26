// The conformance vocabulary: what a case is, what a backend declares, and what
// a run reports.
//
// This is the specification half of the suite. `Command[]` semantics are defined
// operationally by the CanvasKit painter, and several of them (the blur sigma
// constants, the order layer effects compose in) appear nowhere a second
// implementer would look. A case pins one of those in a form that fails rather
// than a paragraph that is not read.
import type { Node } from "../../src/node";
import type { FrameFinish, PaintWarning } from "../../src/types";

// Named bundles rather than a per-feature matrix: forty independent switches are
// unreadable and ungradeable, and a backend needs to answer "am I done" with
// something better than a percentage. Claiming a profile means passing its cases.
export type Profile =
	// Every conformant backend: shapes, fills, strokes, corners, clips, masks,
	// images, bitmaps, groups, baked text, blend modes, shadows, blur.
	| "core"
	// Pixel-grid work that only a rasterizer can mean: supersampling, the
	// whole-frame finish pass, the LUT/sharpen adjust components.
	| "raster";

// How a backend implements a feature, not merely whether. A backend that falls
// back to pixels for an angular gradient is conformant and worse than one that
// draws it directly, and the difference has to be expressible or it is invisible.
export type Fidelity =
	| "native"
	| "approximated"
	// Drawn correctly by falling back to pixels. Legal, and the thing a backend
	// whose value is NOT being a rasterizer must not do silently or everywhere.
	| "rasterized"
	// Declined, and warned about. Never a silent no-op.
	| "refused"
	// Not applicable to this kind of backend at all: `supersample` on an emitter
	// with no pixel grid is not unsupported, it is meaningless.
	| "n/a";

// A feature key is `<group>.<name>` — "fill.angular", "adjust.lut3d",
// "blend.multiply". Cases declare what they require; a backend declares what it
// does with each. Anything absent is assumed "native", so a complete backend
// declares nothing.
export type BackendCapabilities = {
	profiles: Profile[];
	fidelity?: Record<string, Fidelity>;
};

// Reftest-style: the assertion is authored, exact, and portable, so it holds for
// any correct backend rather than describing what CanvasKit happened to produce.
// Coordinates are DEVICE pixels (after `scale`), because that is the only frame
// both a 1x and a 2x render can be addressed in unambiguously.
export type PixelAssertion = {
	kind: "pixel";
	at: [x: number, y: number];
	// RGBA, unpremultiplied, 0-255.
	expect: [number, number, number, number];
	// Per-channel slack. 0 where a case was authored to land on a flat area, which
	// is most of them.
	tolerance?: number;
	why?: string;
};

// Two samples that must differ, for semantics whose signature is a difference
// rather than a value: a shadow falling on one side, a blur softening an edge.
export type DifferAssertion = {
	kind: "differ";
	at: [x: number, y: number];
	from: [x: number, y: number];
	// Minimum per-channel distance on at least one channel.
	minDelta: number;
	why?: string;
};

export type WarningAssertion = {
	kind: "warning";
	warning: PaintWarning["kind"];
	// Fields the warning must also carry, compared with ===. A warning that names
	// nothing is barely better than silence: "something about adjust was dropped"
	// does not tell a caller which layer lost which component.
	match?: Record<string, string | number>;
	// Assert the warning is absent instead. A backend that declares a feature
	// "native" must not warn about it.
	absent?: boolean;
	why?: string;
};

// Hue in degrees, derived from the pixel. Some semantics are about hue and not
// about a value: `gamut: "preserve-hue"` exists precisely because a channel
// clipped at the top of the range drags hue with it, and the correct output is
// "the same hue, less saturated" rather than any particular triple.
export type HueAssertion = {
	kind: "hue";
	at: [x: number, y: number];
	// Degrees, 0-360. Absent means only the comparison below applies.
	expect?: number;
	// Degrees of slack; hue is sensitive near the neutral axis, so a case using
	// this should sample a saturated colour.
	tolerance?: number;
	// Assert the hue has rotated AWAY from `expect` by at least this much, which
	// is what the clipping mode does and the preserving mode must not.
	awayBy?: number;
	why?: string;
};

export type Assertion =
	| PixelAssertion
	| DifferAssertion
	| WarningAssertion
	| HueAssertion;

export type Case = {
	id: string;
	title: string;
	profile: Profile;
	// Feature keys this case exercises. A backend whose fidelity for any of them
	// is "refused" or "n/a" skips the case; one that "approximated" or
	// "rasterized" it runs the case but is graded on warnings, not pixels.
	requires: string[];
	width: number;
	height: number;
	// Compile options that are part of the case rather than the scene.
	compile?: {
		scale?: number;
		supersample?: number;
		finish?: FrameFinish;
		leadingTrim?: boolean;
	};
	// The scene, as a Node tree. Binary fields (bitmap pixels, adjust LUTs) are
	// `{ "__u8": "<base64>" }`; see ./json.
	scene: Node;
	assertions: Assertion[];
};

export type CaseResult = {
	id: string;
	status: "pass" | "fail" | "skip";
	// Why it was skipped, or what failed.
	notes: string[];
};

export type ConformanceReport = {
	profiles: Profile[];
	results: CaseResult[];
	passed: number;
	failed: number;
	skipped: number;
	// A profile is claimed only if every case in it passed. This is the Khronos
	// rule, and it is what stops the suite becoming advice.
	claimed: Profile[];
};
