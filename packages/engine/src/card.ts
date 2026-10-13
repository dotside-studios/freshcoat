// The CR80 card (ISO/IEC 7810 ID-1): 85.60 x 53.98 mm with corners cut to a
// 3.18 mm radius. A card printer keeps 3 mm inside the trim clear of anything
// that must survive the cut.

export const MM_PER_INCH = 25.4;

export const CR80_LONG_MM = 85.6;
export const CR80_SHORT_MM = 53.98;
export const CR80_CORNER_MM = 3.18;
export const CR80_SAFE_MM = 3;

// The card's size in whole pixels at `dpi`, rounded up so the raster covers
// the whole card. 1012 x 638 at 300 dpi.
export function cr80Pixels(dpi: number): { long: number; short: number } {
	const px = (mm: number) => Math.ceil((mm / MM_PER_INCH) * dpi);
	return { long: px(CR80_LONG_MM), short: px(CR80_SHORT_MM) };
}
