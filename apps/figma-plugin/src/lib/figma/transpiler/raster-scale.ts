// How a flattened region's bitmap is sized. Shared by the main thread (which
// runs the actual `exportAsync`) and the transpiler (which asks for the bytes),
// so the density the template is authored against is decided in one place.

/** Bitmap pixels per AUTHOR-space unit. 3 keeps a raster crisp when a template
 *  is rendered above 1× — a card printed at its native pixels, a retina preview
 *  — without ballooning the bundle. */
export const RASTER_DENSITY = 3;

/** Longest axis Figma will export. Past this `exportAsync` rejects, which costs
 *  the author the whole region. */
export const RASTER_MAX_DIMENSION = 4096;

/** The SCALE constraint to export a node with, on a slot whose canvas measures
 *  `authorScale` author units per design unit.
 *
 *  `exportAsync` scales relative to the node's own DESIGN size, but the template
 *  places the bitmap at AUTHOR size, so the two only coincide when the design is
 *  drawn at the canvas' size. A design half the product's print size has
 *  authorScale 2, and exporting it at a flat 3 lands 1.5 bitmap pixels on every
 *  author unit — which is what makes a card imported from an under-sized mock
 *  print soft. Scaling the export by authorScale holds the density constant
 *  whatever size the design was drawn at. */
export function rasterScaleFor(authorScale: number): number {
	if (!Number.isFinite(authorScale) || authorScale <= 0) return RASTER_DENSITY;
	return RASTER_DENSITY * authorScale;
}

/** Lower `scale` until neither exported axis of a `width`×`height` design-space
 *  node crosses Figma's export ceiling. A region big enough to hit this is one
 *  spanning most of the canvas, where the lost density is least visible —
 *  better a softer bitmap than no bitmap. */
export function clampRasterScale(
	scale: number,
	width: number,
	height: number,
): number {
	const longest = Math.max(width, height);
	if (!Number.isFinite(longest) || longest <= 0) return scale;
	return Math.min(scale, RASTER_MAX_DIMENSION / longest);
}
