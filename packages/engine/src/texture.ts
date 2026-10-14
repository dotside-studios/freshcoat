import type { Grain, GrainBlend, Halftone, HalftoneShape } from "./types";

// `lx`/`ly` are the rows of the device-to-layer matrix with the layer origin
// folded in, so cells and grains are fixed in design units at any export scale.

// Integer arithmetic in floats, exact below 2^24, so CPU and GPU agree. The
// half-unit offset keeps a division error from crossing an integer.
const HASH_SKSL = `
	float mod289(float x) { return x - floor((x + 0.5) / 289.0) * 289.0; }
	float permute(float x) { return mod289((x * 34.0 + 1.0) * x); }
	float hash(float2 cell, float k) {
		float h = permute(mod289(cell.x));
		h = permute(mod289(h + cell.y));
		h = permute(mod289(h + floor((cell.x + 0.5) / 289.0)));
		h = permute(mod289(h + floor((cell.y + 0.5) / 289.0)));
		h = permute(mod289(h + seedLo));
		h = permute(mod289(h + seedHi));
		h = permute(mod289(h + k));
		return h / 288.0;
	}`;

const GRAIN_BLEND_SKSL: Record<GrainBlend, string> = {
	normal: "g",
	overlay:
		"half3(c.r < 0.5 ? 2.0*c.r*g.r : 1.0 - 2.0*(1.0-c.r)*(1.0-g.r), c.g < 0.5 ? 2.0*c.g*g.g : 1.0 - 2.0*(1.0-c.g)*(1.0-g.g), c.b < 0.5 ? 2.0*c.b*g.b : 1.0 - 2.0*(1.0-c.b)*(1.0-g.b))",
	"soft-light": "(1.0 - 2.0*g)*c*c + 2.0*g*c",
	multiply: "c*g",
	screen: "1.0 - (1.0-c)*(1.0-g)",
};

export function grainSksl(blend: GrainBlend, monochrome: boolean): string {
	return `uniform shader src;
	uniform float3 lx;
	uniform float3 ly;
	uniform float grainSize;
	uniform float amount;
	uniform float seedLo;
	uniform float seedHi;
	${HASH_SKSL}
	half4 main(float2 xy) {
		half4 s = src.eval(xy);
		if (s.a <= 0.0) return s;
		float2 p = float2(dot(lx, float3(xy, 1.0)), dot(ly, float3(xy, 1.0)));
		float2 cell = floor(p / grainSize);
		${
			monochrome
				? "half3 g = half3(hash(cell, 0.0));"
				: "half3 g = half3(hash(cell, 0.0), hash(cell, 1.0), hash(cell, 2.0));"
		}
		half3 c = s.rgb / s.a;
		half3 b = ${GRAIN_BLEND_SKSL[blend]};
		c = clamp(mix(c, b, half(amount)), 0.0, 1.0);
		return half4(c * s.a, s.a);
	}`;
}

// Classic screen angles and process-ink approximations, in C, M, Y, K order.
export const CMYK_SCREENS = [
	{ angle: 15, ink: [0, 174 / 255, 239 / 255] },
	{ angle: 75, ink: [236 / 255, 0, 140 / 255] },
	{ angle: 0, ink: [1, 242 / 255, 0] },
	{ angle: 45, ink: [35 / 255, 31 / 255, 32 / 255] },
] as const;

// Box-filtered over a pixel `aaw` cells wide, so a dot's area holds at any
// density; a dot reaching the cell edge meets its neighbour's.
const DOT_SKSL: Record<HalftoneShape, string> = {
	round: `
		float r = d <= 0.7853982 ? sqrt(d / 3.1415927) : mix(0.5, 0.7072, (d - 0.7853982) / 0.2146018);
		float dist = length(f);
		if (2.0 * r >= aaw) return clamp((r - dist) / aaw + 0.5, 0.0, 1.0);
		float a = 2.0 * r / aaw;
		return a * a * clamp((0.5 * aaw - dist) / aaw + 0.5, 0.0, 1.0);`,
	square: `
		float h = sqrt(d) * 0.5;
		return span(h, f.x) * span(h, f.y);`,
	line: `
		return span(d * 0.5, f.y);`,
};

const SPAN_SKSL = `
	float span(float h, float f) {
		float lo = max(abs(f) - 0.5 * aaw, -0.5);
		float hi = abs(f) + 0.5 * aaw;
		float inner = max(0.0, min(hi, h) - max(lo, -h));
		float outer = h >= 0.5 ? max(0.0, hi - 0.5) : 0.0;
		return clamp((inner + outer) / aaw, 0.0, 1.0);
	}`;

// A dot is the mean of `taps` x `taps` reads over its cell.
export function halftoneSksl(
	mode: Halftone["mode"],
	shape: HalftoneShape,
): string {
	const screens = mode === "cmyk" ? 4 : 1;
	const taps = mode === "cmyk" ? 3 : 4;
	const value =
		mode === "cmyk"
			? `
		half3 rgb = a.a > 0.0 ? a.rgb / a.a : half3(1.0);
		if (invert > 0.5) rgb = 1.0 - rgb;
		half k = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
		half3 cmy = k < 1.0 ? (1.0 - rgb - k) / (1.0 - k) : half3(0.0);
		return dot(float4(cmy, k), channel) * a.a;`
			: `
		half l = dot(a.rgb, half3(0.299, 0.587, 0.114));
		return float(invert > 0.5 ? l : a.a - l);`;
	const loop = Array.from(
		{ length: screens },
		(_, i) => `
		{
			float d = clamp(screenValue(q, rot[${i}], float4(${[0,1,2,3].map((c) => (c === i ? 1 : 0)).join(", ")})), 0.0, 1.0);
			float2 s = rotate(q, float2(rot[${i}].x, -rot[${i}].y)) / cellSize;
			float m = d > 0.0 ? dotMask(d, fract(s) - 0.5) : 0.0;
			half3 sc = half3(inks[${i}]) * half(m);
			acc = half4(sc * (1.0 - acc.a) + acc.rgb * (1.0 - half(m)) + sc * acc.rgb, half(m) + acc.a * (1.0 - half(m)));
		}`,
	).join("");
	return `uniform shader src;
	uniform float3 lx;
	uniform float3 ly;
	uniform float3 dx;
	uniform float3 dy;
	uniform float cellSize;
	uniform float aaw;
	uniform float invert;
	uniform float4 background;
	uniform float2 rot[${screens}];
	uniform float3 inks[${screens}];
	float2 rotate(float2 v, float2 cs) { return float2(cs.x * v.x - cs.y * v.y, cs.y * v.x + cs.x * v.y); }
	float2 toDevice(float2 q) { return float2(dot(dx, float3(q, 1.0)), dot(dy, float3(q, 1.0))); }
	float screenValue(float2 q, float2 cs, float4 channel) {
		float2 s = floor(rotate(q, float2(cs.x, -cs.y)) / cellSize);
		half4 a = half4(0.0);
		for (int y = 0; y < ${taps}; y++) {
			for (int x = 0; x < ${taps}; x++) {
				float2 t = (s + (float2(float(x), float(y)) + 0.5) / ${taps}.0) * cellSize;
				a += src.eval(toDevice(rotate(t, cs)));
			}
		}
		a /= ${taps * taps}.0;
		${value}
	}
	${SPAN_SKSL}
	float dotMask(float d, float2 f) {${DOT_SKSL[shape]}
	}
	half4 main(float2 xy) {
		half cover = src.eval(xy).a;
		if (cover <= 0.0) return half4(0.0);
		float2 q = float2(dot(lx, float3(xy, 1.0)), dot(ly, float3(xy, 1.0)));
		half4 acc = half4(half3(background.rgb) * half(background.a), half(background.a));
		${loop}
		return acc * cover;
	}`;
}

// Seeds reduce to the 289 x 289 values the hash separates.
export function grainSeed(seed: number): [number, number] {
	const n = 83521;
	const s = Number.isFinite(seed) ? ((Math.trunc(seed) % n) + n) % n : 0;
	return [s % 289, Math.floor(s / 289)];
}

export function isGrainActive(grain: Grain | undefined): grain is Grain {
	return !!grain && grain.amount > 0 && grain.size > 0;
}

export function isHalftoneActive(
	halftone: Halftone | undefined,
): halftone is Halftone {
	return !!halftone && halftone.cellSize > 0;
}
