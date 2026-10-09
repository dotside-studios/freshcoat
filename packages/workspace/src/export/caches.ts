import { inlinedAssetUri, type Template } from "@freshcoat-js/coatfile";
import {
	type AnalysisCache,
	createAnalysisCache,
} from "@freshcoat-js/for-print";

/** Decoded pixels an item renderer keeps across items. */
export const IMAGE_CACHE_PIXELS = 48_000_000;
/** Print analyses an item renderer keeps across items. */
const ANALYSIS_CACHE_ENTRIES = 256;

/** What an item renderer keeps across the items of one job, beside its
 *  renderer's paint cache. */
export type JobCaches = {
	analysis(): AnalysisCache;
	/** `asset:<sha256>` for the data URL `compile` gives one of the template's
	 *  assets */
	analysisKey(template: Template): (src: string) => string | undefined;
	/** Frees everything held. The next item rebuilds it. */
	clear(): void;
};

export function createJobCaches(): JobCaches {
	let analysis: AnalysisCache | undefined;
	let assetKeys:
		| { template: Template; key: (src: string) => string | undefined }
		| undefined;
	return {
		analysis() {
			analysis ??= createAnalysisCache(ANALYSIS_CACHE_ENTRIES);
			return analysis;
		},
		analysisKey(template) {
			if (assetKeys?.template !== template)
				assetKeys = { template, key: inlinedAssetUri(template) };
			return assetKeys.key;
		},
		clear() {
			analysis = undefined;
			assetKeys = undefined;
		},
	};
}
