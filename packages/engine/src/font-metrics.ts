// Vertical font metrics (OS/2 sTypo + sCapHeight), read from font bytes. Figma
// positions the first baseline using these — see compile's baselineOffset.
//
// Two ways to feed them to compile:
//   1. Preferred: build a { family: FontVMetrics } map with readFontMetrics()
//      and pass it as CompileOptions.fontMetrics (explicit, no global state).
//   2. Fallback: registerFontMetrics(family, bytes) into the module registry,
//      which compile consults when a family isn't in CompileOptions.fontMetrics.
import type { FontVMetrics } from "./types";

const registry = new Map<string, FontVMetrics>();

export function registerFontMetrics(
	family: string,
	data: Uint8Array | ArrayBuffer,
): void {
	const m = readFontMetrics(data);
	if (m) registry.set(family, m);
}

export function getFontMetrics(family: string): FontVMetrics | undefined {
	return registry.get(family);
}

// Build the { family: FontVMetrics } map compileScene wants from a family→bytes
// map (the first face per family), skipping any the reader can't parse. The
// standard way to derive CompileSceneOptions.fontMetrics when rendering with a
// bytes-backed font set (headless / CanvasKit paths).
export function deriveFontMetrics(
	fonts: Map<string, Uint8Array[]>,
): Record<string, FontVMetrics> {
	const out: Record<string, FontVMetrics> = {};
	for (const [family, faces] of fonts) {
		const bytes = faces[0];
		if (!bytes) continue;
		const m = readFontMetrics(bytes);
		if (m) out[family] = m;
	}
	return out;
}

// Read OS/2 sTypoAscender/Descender/LineGap + sCapHeight and head.unitsPerEm
// from an sfnt (ttf/otf) buffer, normalized per em. Returns null on anything
// unexpected so callers fall back.
export function readFontMetrics(
	data: Uint8Array | ArrayBuffer,
): FontVMetrics | null {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	try {
		const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const numTables = dv.getUint16(4);
		let os2 = 0;
		let head = 0;
		for (let i = 0; i < numTables; i++) {
			const o = 12 + i * 16;
			const tag = String.fromCharCode(
				bytes[o],
				bytes[o + 1],
				bytes[o + 2],
				bytes[o + 3],
			);
			const off = dv.getUint32(o + 8);
			if (tag === "OS/2") os2 = off;
			else if (tag === "head") head = off;
		}
		if (!os2 || !head) return null;
		const upem = dv.getUint16(head + 18);
		if (!upem) return null;
		const version = dv.getUint16(os2);
		return {
			ascent: dv.getInt16(os2 + 68) / upem,
			descent: -dv.getInt16(os2 + 70) / upem,
			lineGap: dv.getInt16(os2 + 72) / upem,
			// sCapHeight exists from OS/2 v2 onward (offset 88).
			capHeight: version >= 2 ? dv.getInt16(os2 + 88) / upem : 0,
		};
	} catch {
		return null;
	}
}
