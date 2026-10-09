// Export sizing — the model Figma's export settings use. A scene is compiled ONCE
// at its design size; an export setting then decides the pixel density that scene
// is rasterized at: a plain multiplier (2×), or a fixed pixel width/height the
// longest-side-preserving scale is derived from.
//
// The scale is a PAINT-TIME device-pixel multiplier, not a second compile: every
// coordinate in the Command stream stays in design units and the painter scales
// the surface + the canvas matrix instead. That is what separates a 2× export from
// upscaling a 1× PNG — glyphs re-rasterize and images resample from their source
// at the exported resolution, while line breaks, hinting-free layout and every
// baked text layout stay identical across scales.
import type { Command, Size } from "./types";

// How an export decides its scale. `scale` is the multiplier itself; `width` /
// `height` are target pixels on that axis, which the design's own size turns into
// a multiplier (so the other axis follows the aspect ratio).
export type ExportConstraint =
	| { kind: "scale"; value: number }
	| { kind: "width"; value: number }
	| { kind: "height"; value: number };

// One export of a scene: how big, and what to name it. Mirrors a row of Figma's
// export panel minus the format — the output format is the paint runtime's
// concern (a headless env encodes PNG, a browser env keeps the live canvas).
export type ExportSetting = {
	// Omitted = 1×, the design's own size.
	constraint?: ExportConstraint;
	// A file-name suffix ("@2x", "-print"). Carried through the pipeline for the
	// caller to name its output with; nothing here reads it.
	suffix?: string;
	// Render this many times denser than the export and reduce back to it (see
	// resolveSupersample). Orthogonal to `constraint`: that decides how big the
	// result is, this decides how many samples went into it. Omit/1 = render at
	// the export size.
	supersample?: number;
};

// Longest axis an export may reach. A raster surface is width·height·4 bytes, so
// an unbounded scale on a large design is an out-of-memory, not a slow render.
// Past this the scale is lowered to fit rather than throwing — a softer export
// beats no export, and the effective scale comes back from resolveExportScale for
// a caller that wants to notice.
export const MAX_EXPORT_DIMENSION = 8192;

// The device-pixel multiplier an export constraint asks for on a design of `size`,
// lowered so neither axis crosses `maxDimension`. A missing/degenerate constraint
// is 1×.
export function resolveExportScale(
	constraint: ExportConstraint | undefined,
	size: Size,
	opts?: { maxDimension?: number },
): number {
	const requested = requestedScale(constraint, size);
	if (!Number.isFinite(requested) || requested <= 0) return 1;
	const longest = Math.max(size.width, size.height);
	if (longest <= 0) return requested;
	const ceiling = (opts?.maxDimension ?? MAX_EXPORT_DIMENSION) / longest;
	return Math.min(requested, ceiling);
}

function requestedScale(
	constraint: ExportConstraint | undefined,
	size: Size,
): number {
	if (!constraint) return 1;
	switch (constraint.kind) {
		case "scale":
			return constraint.value;
		case "width":
			return size.width > 0 ? constraint.value / size.width : 1;
		case "height":
			return size.height > 0 ? constraint.value / size.height : 1;
	}
}

// How many times denser than the export a scene may be RENDERED before being
// reduced to the export size. Past this the extra samples stop buying visible
// quality and only cost fill rate — 4× the density is already 16× the pixels.
export const MAX_SUPERSAMPLE = 4;

// The supersample factor an export may actually use: the scene is rendered at
// `scale × supersample` and reduced to `scale` before it is finished or encoded,
// so the output keeps its 1× pixel count while every edge is resolved from
// several samples instead of one. This is the knob for a FIXED output size — a
// caller that can afford more pixels should raise `scale` instead and get the
// same detail at the larger size for a quarter of the fill.
//
// Bounded twice: by MAX_SUPERSAMPLE, and by the same `maxDimension` ceiling the
// export scale answers to — the render surface is the one that has to be
// allocated, so it is the one that must fit. A request that cannot be honoured
// is lowered rather than refused (1 = render at the export size, no reduction).
//
// Always a power of two, rounded down. The reduction is a chain of exact 2:1
// halvings (see the painter's reduceSupersampled) because that is the only ratio
// a resampler averages every sample at: a cubic filter's support does not widen
// with the minification, so a 4:1 cubic reduction quietly reads a fraction of the
// samples that were paid for and lands no better than 2:1. A request of 3 is
// therefore honoured as 2, and anything under 2 as no supersampling.
export function resolveSupersample(
	supersample: number | undefined,
	size: Size,
	scale: number,
	opts?: { maxDimension?: number },
): number {
	const requested = Math.min(supersample ?? 1, MAX_SUPERSAMPLE);
	if (!Number.isFinite(requested) || requested < 2) return 1;
	const longest = Math.max(size.width, size.height) * scale;
	const ceiling =
		longest > 0
			? (opts?.maxDimension ?? MAX_EXPORT_DIMENSION) / longest
			: requested;
	const fitted = Math.min(requested, ceiling);
	return fitted >= 2 ? 2 ** Math.floor(Math.log2(fitted)) : 1;
}

// The surface a design of `size` occupies at `scale`, in whole pixels. Rounding
// (not flooring) is what makes a `width: 1024` constraint land on exactly 1024.
// The painter sizes its surface with this, so a caller naming or laying out the
// result reads the same numbers the pixels have.
export function exportPixelSize(size: Size, scale: number): Size {
	return {
		width: Math.max(1, Math.round(size.width * scale)),
		height: Math.max(1, Math.round(size.height * scale)),
	};
}

// Retarget compiled commands at an export density and sample rate. Both live on
// the scene's own `createCanvas`, so a re-export swaps that one command rather
// than compiling again. A field is set only when it is not 1x, keeping the
// stream identical to one compiled without export settings.
export function withExportScale(
	commands: Command[],
	scale: number,
	supersample: number,
): Command[] {
	if (scale === 1 && supersample === 1) return commands;
	return commands.map((c) =>
		c.op === "createCanvas"
			? {
					...c,
					...(scale !== 1 ? { scale } : {}),
					...(supersample !== 1 ? { supersample } : {}),
				}
			: c,
	);
}
