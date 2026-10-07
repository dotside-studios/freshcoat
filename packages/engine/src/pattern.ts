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

// Every effect takes the same uniforms: the two colours unpremultiplied, the
// density, and `aa`, the size of one device pixel in pattern units. Coverage is
// mixed premultiplied so a transparent colour never darkens the other's edge.
// Once a feature shrinks under a pixel, coverage fades to its mean instead of
// aliasing into moiré.
const UNIFORMS = `layout(color) uniform half4 c0;
layout(color) uniform half4 c1;
uniform float density;
uniform float aa;
half4 paint(float t) {
	half4 a = half4(c0.rgb * c0.a, c0.a);
	half4 b = half4(c1.rgb * c1.a, c1.a);
	return mix(a, b, half(clamp(t, 0.0, 1.0)));
}`;

const NOISE_SKSL = `uniform shader noise;
${UNIFORMS}
half4 main(float2 p) {
	half4 s = noise.eval(p + float2(0.37, 0.61));
	float n = s.a > 0.0 ? float(s.r / s.a) : 0.5;
	float bias = density * 2.0 - 1.0;
	float t = (n - 0.5) * 4.0 + 0.5 + bias;
	return paint(mix(t, 0.5 + bias, smoothstep(1.0, 4.0, aa)));
}`;

const PAPER_SKSL = `uniform shader noise;
${UNIFORMS}
half4 main(float2 p) {
	half4 fibre = noise.eval(p * float2(1.0, 6.0) + float2(0.37, 0.61));
	half4 tooth = noise.eval(p * 8.0 + float2(5.21, 3.17));
	float f = fibre.a > 0.0 ? float(fibre.r / fibre.a) : 0.0;
	float g = tooth.a > 0.0 ? float(tooth.r / tooth.a) : 0.0;
	float t = (f * 1.6 + g * 0.6) * density * 2.0;
	return paint(mix(t, density * 0.9, smoothstep(0.125, 0.5, aa)));
}`;

const HATCHING_SKSL = `${UNIFORMS}
half4 main(float2 p) {
	float d = abs(fract(p.y) - 0.5);
	float cov = clamp((density * 0.5 - d) / aa + 0.5, 0.0, 1.0);
	return paint(mix(cov, density, smoothstep(0.25, 1.0, aa)));
}`;

const DOTS_SKSL = `${UNIFORMS}
half4 main(float2 p) {
	float r = min(sqrt(density / 3.14159265), 0.7072);
	float d = length(fract(p) - 0.5);
	float cov = clamp((r - d) / aa + 0.5, 0.0, 1.0);
	return paint(mix(cov, density, smoothstep(0.25, 1.0, aa)));
}`;

export const PATTERN_SKSL: Record<PatternKind, string> = {
	noise: NOISE_SKSL,
	paper: PAPER_SKSL,
	hatching: HATCHING_SKSL,
	dots: DOTS_SKSL,
};
