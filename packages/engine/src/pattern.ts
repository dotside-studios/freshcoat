import type { PatternKind, ResolvedFill } from "./types";

export type PatternFill = Extract<ResolvedFill, { kind: "pattern" }>;

export const PATTERN_KINDS: readonly PatternKind[] = [
	"noise",
	"paper",
	"hatching",
	"dots",
];

export const PATTERN_DEFAULTS: Record<
	PatternKind,
	Omit<PatternFill, "kind" | "pattern">
> = {
	noise: {
		scale: 1.5,
		angle: 0,
		density: 0.5,
		seed: 0,
		colors: ["#ffffff00", "#00000040"],
	},
	paper: {
		scale: 24,
		angle: 0,
		density: 0.35,
		seed: 0,
		colors: ["#f7f3ea", "#d9d0bd"],
	},
	hatching: {
		scale: 8,
		angle: 45,
		density: 0.25,
		seed: 0,
		colors: ["#ffffff", "#1f1f1f"],
	},
	dots: {
		scale: 10,
		angle: 0,
		density: 0.2,
		seed: 0,
		colors: ["#ffffff", "#1f1f1f"],
	},
};

export function patternFill(
	pattern: PatternKind,
	params: Partial<Omit<PatternFill, "kind" | "pattern">> = {},
): PatternFill {
	const d = PATTERN_DEFAULTS[pattern];
	return {
		kind: "pattern",
		pattern,
		scale: params.scale ?? d.scale,
		angle: params.angle ?? d.angle,
		density: params.density ?? d.density,
		seed: params.seed ?? d.seed,
		colors: params.colors ?? [...d.colors],
	};
}

// E[clamp(t)] of the sharp noise and paper textures at density 0, 0.05, ... 1,
// measured over several seeds at a scale where no fade applies.
const NOISE_MEAN = [
	0.0373, 0.055, 0.0782, 0.1078, 0.1446, 0.189, 0.241, 0.2997, 0.3635, 0.4309,
	0.5, 0.5692, 0.6366, 0.7004, 0.7589, 0.8108, 0.8551, 0.8918, 0.9213, 0.9445,
	0.9623,
];
const PAPER_MEAN = [
	0, 0.0699, 0.1399, 0.2098, 0.2797, 0.3496, 0.4196, 0.4893, 0.5579, 0.6228,
	0.6818, 0.7334, 0.7778, 0.8155, 0.8472, 0.8736, 0.8955, 0.9136, 0.9284,
	0.9407, 0.9507,
];

function lookup(table: number[], density: number): number {
	const x = Math.min(Math.max(density, 0), 1) * (table.length - 1);
	const i = Math.min(Math.floor(x), table.length - 2);
	const f = x - i;
	return (table[i] as number) * (1 - f) + (table[i + 1] as number) * f;
}

// Share of a unit cell a centred disc of radius `r` covers.
function discInCell(r: number): number {
	if (r <= 0.5) return Math.PI * r * r;
	if (r * r >= 0.5) return 1;
	const segment = r * r * Math.acos(0.5 / r) - 0.5 * Math.sqrt(r * r - 0.25);
	return Math.PI * r * r - 4 * segment;
}

// The average coverage of the second colour at full detail, which every kind
// fades towards once its features shrink below a pixel.
export function patternMean(pattern: PatternKind, density: number): number {
	const d = Math.min(Math.max(density, 0), 1);
	if (pattern === "noise") return lookup(NOISE_MEAN, d);
	if (pattern === "paper") return lookup(PAPER_MEAN, d);
	if (pattern === "hatching") return d;
	return discInCell(Math.min(Math.sqrt(d / Math.PI), 0.7072));
}

// Every effect takes the same uniforms: the two colours unpremultiplied, the
// density, `aa`, the size of one device pixel in pattern units, and `mean`, the
// coverage's average at full detail. Coverage is mixed premultiplied so a
// transparent colour never darkens the other's edge. As features shrink towards
// a pixel, contrast around `mean` falls the way a box filter would lower it, so
// the average tone holds at every zoom and density.
const UNIFORMS = `layout(color) uniform half4 c0;
layout(color) uniform half4 c1;
uniform float density;
uniform float aa;
uniform float mean;
half4 paint(float t) {
	half4 a = half4(c0.rgb * c0.a, c0.a);
	half4 b = half4(c1.rgb * c1.a, c1.a);
	return mix(a, b, half(clamp(t, 0.0, 1.0)));
}
float faded(float t, float keep) {
	return mean + (clamp(t, 0.0, 1.0) - mean) * keep;
}`;

// The finest of the three octaves repeats four times per unit, so `w` is one
// device pixel in periods of that octave. Contrast halves once a pixel spans
// four of them.
const NOISE_SKSL = `uniform shader noise;
${UNIFORMS}
half4 main(float2 p) {
	half4 s = noise.eval(p + float2(0.37, 0.61));
	float n = s.a > 0.0 ? float(s.r / s.a) : 0.5;
	float bias = density * 2.0 - 1.0;
	float t = (n - 0.5) * 4.0 + 0.5 + bias;
	float w = aa * 4.0;
	return paint(faded(t, 1.0 / (1.0 + w * w / 16.0)));
}`;

const PAPER_SKSL = `uniform shader noise;
${UNIFORMS}
half4 main(float2 p) {
	half4 fibre = noise.eval(p * float2(1.0, 6.0) + float2(0.37, 0.61));
	half4 tooth = noise.eval(p * 8.0 + float2(5.21, 3.17));
	float f = fibre.a > 0.0 ? float(fibre.r / fibre.a) : 0.0;
	float g = tooth.a > 0.0 ? float(tooth.r / tooth.a) : 0.0;
	float t = (f * 1.6 + g * 0.6) * density * 2.0;
	return paint(faded(t, 1.0 / (1.0 + pow(aa * 4.0, 1.1))));
}`;

// A line `w` wide filtered by a pixel `aa` wide: the ramp's integral matches
// the line's width at any size, and the neighbouring line adds its share.
const HATCHING_SKSL = `${UNIFORMS}
float ramp(float d) {
	return clamp((density * 0.5 - d) / aa + 0.5, 0.0, 1.0);
}
half4 main(float2 p) {
	float w = density;
	float r = (w + aa) * 0.5;
	float area = w >= aa ? w : r * r / aa;
	float d = abs(fract(p.y) - 0.5);
	float cov = (ramp(d) + ramp(1.0 - d)) * w / max(area, 1e-6);
	return paint(faded(cov, 1.0 - smoothstep(0.5, 1.0, aa)));
}`;

const DOTS_SKSL = `${UNIFORMS}
half4 main(float2 p) {
	float r = min(sqrt(density / 3.14159265), 0.7072);
	float R = r + aa * 0.5;
	float area = r >= aa * 0.5
		? 3.14159265 * (r * r + aa * aa / 12.0)
		: 3.14159265 * R * R * R / (3.0 * aa);
	float d = length(fract(p) - 0.5);
	float cov = clamp((r - d) / aa + 0.5, 0.0, 1.0);
	cov *= min(3.14159265 * r * r / max(area, 1e-6), 1.0);
	return paint(faded(cov, 1.0 - smoothstep(0.5, 1.0, aa)));
}`;

export const PATTERN_SKSL: Record<PatternKind, string> = {
	noise: NOISE_SKSL,
	paper: PAPER_SKSL,
	hatching: HATCHING_SKSL,
	dots: DOTS_SKSL,
};
