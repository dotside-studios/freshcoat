// Optional CSS→IR helpers: parse a CSS color string to `#rrggbb` and a CSS
// `linear-gradient(...)` to a ResolvedFill. Dependency-free and tree-shakeable —
// freshcoat paints from resolved values, but consumers often author from
// CSS-ish strings, and CanvasKit can't parse `oklch()`. App-specific resolution
// (e.g. `var(--token)`) stays with the caller via the ColorResolver hook.
import type { ResolvedFill } from "./types";

// Resolve one CSS color token to `#rrggbb`. Callers pass this to handle values
// parseCssColor doesn't know (design-token `var(...)`, named brand colors).
export type ColorResolver = (raw: string) => string;

const CSS_NAMED: Record<string, string> = {
	transparent: "#00000000",
	white: "#ffffff",
	black: "#000000",
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function toHexByte(x: number): string {
	return Math.round(clamp01(x) * 255)
		.toString(16)
		.padStart(2, "0");
}

// oklch(L C H) → sRGB hex. L is 0..1 (or a %), C is chroma, H is degrees.
// OKLCh → OKLab → linear sRGB → gamma-encoded sRGB.
export function oklchToHex(l: number, c: number, h: number): string {
	const hr = (h * Math.PI) / 180;
	const a = c * Math.cos(hr);
	const b = c * Math.sin(hr);

	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.291485548 * b;

	const lc = l_ * l_ * l_;
	const mc = m_ * m_ * m_;
	const sc = s_ * s_ * s_;

	const lr = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
	const lg = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
	const lb = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

	const enc = (x: number) =>
		x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;

	return `#${toHexByte(enc(lr))}${toHexByte(enc(lg))}${toHexByte(enc(lb))}`;
}

function parseOklch(value: string): string | null {
	const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
	const parts = inner
		.replace(/\//g, " ") // drop any `/ alpha`
		.split(/[\s,]+/)
		.filter(Boolean);
	if (parts.length < 3) return null;
	const l = parts[0].endsWith("%")
		? parseFloat(parts[0]) / 100
		: parseFloat(parts[0]);
	const c = parseFloat(parts[1]);
	const h = parseFloat(parts[2]);
	if ([l, c, h].some(Number.isNaN)) return null;
	return oklchToHex(l, c, h);
}

function expandHex(value: string): string {
	const hex = value.slice(1);
	if (hex.length === 3 || hex.length === 4) {
		return `#${[...hex].map((ch) => ch + ch).join("")}`;
	}
	return value;
}

function parseRgb(value: string): string | null {
	const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
	const parts = inner.split(/[\s,/]+/).filter(Boolean);
	if (parts.length < 3) return null;
	const toByte = (p: string) =>
		p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p);
	const [r, g, b] = parts.map(toByte);
	if ([r, g, b].some(Number.isNaN)) return null;
	return `#${toHexByte(r / 255)}${toHexByte(g / 255)}${toHexByte(b / 255)}`;
}

// A CSS color string (hex / rgb()/rgba() / oklch() / a named color) → `#rrggbb`.
// Unknown/unparseable values (including `var(...)` — resolve those before calling,
// or use parseLinearGradient's resolver hook) yield `fallback`.
export function parseCssColor(raw: string, fallback = "#000000"): string {
	const value = raw.trim();
	if (!value) return fallback;
	if (value.startsWith("#")) return expandHex(value).toLowerCase();
	if (value.startsWith("oklch")) return parseOklch(value) ?? fallback;
	if (value.startsWith("rgb")) return parseRgb(value) ?? fallback;
	return CSS_NAMED[value.toLowerCase()] ?? fallback;
}

// Split on top-level commas only (colors like rgb(…) carry their own commas).
function splitTopLevel(input: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === "(") depth++;
		else if (ch === ")") depth--;
		else if (ch === "," && depth === 0) {
			out.push(input.slice(start, i));
			start = i + 1;
		}
	}
	out.push(input.slice(start));
	return out.map((s) => s.trim()).filter(Boolean);
}

const ANGLE_KEYWORDS: Record<string, number> = {
	"to top": 0,
	"to right": 90,
	"to bottom": 180,
	"to left": 270,
};

// CSS gradient angle → normalized endpoints in the [0,1] bbox. 0deg = to top,
// 90deg = to right, 180deg = to bottom.
function angleToEndpoints(angle: number): {
	from: { x: number; y: number };
	to: { x: number; y: number };
} {
	const rad = (angle * Math.PI) / 180;
	const dx = Math.sin(rad) / 2;
	const dy = -Math.cos(rad) / 2;
	return {
		from: { x: 0.5 - dx, y: 0.5 - dy },
		to: { x: 0.5 + dx, y: 0.5 + dy },
	};
}

// Parse a CSS `linear-gradient(...)` into a freshcoat linear fill. Angles (`Ndeg`
// or `to <side>`, default 180) and per-stop positions (`<color> <pos>%`, else
// evenly spaced) are honored; stop colors resolve through `resolveColor` (default
// parseCssColor), so callers can inject `var(--token)` resolution. Returns null
// for anything that isn't a linear-gradient (radial/conic → caller's fallback).
export function parseLinearGradient(
	value: string,
	resolveColor: ColorResolver = (c) => parseCssColor(c),
): ResolvedFill | null {
	const trimmed = value.trim();
	const open = trimmed.indexOf("(");
	if (!trimmed.startsWith("linear-gradient") || open < 0) return null;
	const inner = trimmed.slice(open + 1, trimmed.lastIndexOf(")"));
	const parts = splitTopLevel(inner);
	if (parts.length < 2) return null;

	let angle = 180;
	let stopParts = parts;
	const first = parts[0].toLowerCase();
	if (/deg\s*$/.test(first)) {
		angle = parseFloat(first);
		stopParts = parts.slice(1);
	} else if (first in ANGLE_KEYWORDS) {
		angle = ANGLE_KEYWORDS[first];
		stopParts = parts.slice(1);
	}
	if (stopParts.length < 2) return null;

	const stops = stopParts.map((part, i) => {
		const m = part.match(/^(.*?)(?:\s+(-?[\d.]+)%)?$/);
		const colorRaw = (m?.[1] ?? part).trim();
		const posRaw = m?.[2];
		const offset =
			posRaw !== undefined
				? parseFloat(posRaw) / 100
				: i / (stopParts.length - 1);
		return { offset, color: resolveColor(colorRaw) };
	});

	return { kind: "linear", stops, ...angleToEndpoints(angle) };
}
