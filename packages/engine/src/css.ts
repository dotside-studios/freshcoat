// Optional CSS→IR helpers: parse a CSS color string to `#rrggbb` and a CSS
// `linear-gradient(...)` to a ResolvedFill. Dependency-free and tree-shakeable —
// freshcoat paints from resolved values, but consumers often author from
// CSS-ish strings, and CanvasKit can't parse `oklch()`. App-specific resolution
// (e.g. `var(--token)`) stays with the caller via the ColorResolver hook.
import { oklchToRgb, parseColor, toHex } from "./color";
import type { ResolvedFill } from "./types";

// Resolve one CSS color token to `#rrggbb`. Callers pass this to handle values
// parseCssColor doesn't know (design-token `var(...)`, named brand colors).
export type ColorResolver = (raw: string) => string;

// oklch(L C H) → sRGB hex. L is 0..1 (or a %), C is chroma, H is degrees.
export function oklchToHex(l: number, c: number, h: number): string {
	return toHex([...oklchToRgb(l, c, h), 1]).slice(0, 7);
}

// A CSS color string (hex / rgb() / hsl() / oklch() / a named color) → `#rrggbb`,
// or `#rrggbbaa` when translucent. Unknown/unparseable values (including
// `var(...)`: resolve those before calling, or use parseLinearGradient's
// resolver hook) yield `fallback`.
export function parseCssColor(raw: string, fallback = "#000000"): string {
	const c = parseColor(raw);
	if (!c || c === "none") return fallback;
	const hex = toHex(c);
	return hex.endsWith("ff") ? hex.slice(0, 7) : hex;
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
