import {
	assetUri,
	createPaintCache,
	inlineAssetUrls,
	type PaintCache,
	type Template,
} from "@freshcoat-js/coatfile";
import {
	type AnalysisCache,
	createAnalysisCache,
} from "@freshcoat-js/for-print";

/** Decoded pixels one render worker keeps across items. */
const IMAGE_CACHE_PIXELS = 48_000_000;
/** Print analyses one render worker keeps across items. */
const ANALYSIS_CACHE_ENTRIES = 256;

/** What a render worker keeps across the items of one job. */
export type JobCaches = {
	/** decoded images, SVG pictures, paths, the font provider and the surface */
	paint(): PaintCache;
	analysis(): AnalysisCache;
	/** `asset:<sha256>` for the data URL `compile` gives one of the template's
	 *  assets */
	analysisKey(template: Template): (src: string) => string | undefined;
	/** Frees everything held. The next item rebuilds it. */
	clear(): void;
};

export function createJobCaches(): JobCaches {
	let paint: PaintCache | undefined;
	let analysis: AnalysisCache | undefined;
	let assetKeys: { template: Template; keys: Map<string, string> } | undefined;
	return {
		paint() {
			paint ??= createPaintCache({ maxImagePixels: IMAGE_CACHE_PIXELS });
			return paint;
		},
		analysis() {
			analysis ??= createAnalysisCache(ANALYSIS_CACHE_ENTRIES);
			return analysis;
		},
		analysisKey(template) {
			if (assetKeys?.template !== template) {
				const keys = new Map<string, string>();
				for (const [sha, url] of inlineAssetUrls(template))
					keys.set(url, assetUri(sha));
				assetKeys = { template, keys };
			}
			const { keys } = assetKeys;
			return (src) => keys.get(src);
		},
		clear() {
			paint?.dispose();
			paint = undefined;
			analysis = undefined;
			assetKeys = undefined;
		},
	};
}
