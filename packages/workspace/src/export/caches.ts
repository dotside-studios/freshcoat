import {
	assetUri,
	type InlineAsset,
	type Template,
} from "@freshcoat-js/coatfile";
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
		| { template: Template; keys: Map<string, InlineAsset[]> }
		| undefined;
	return {
		analysis() {
			analysis ??= createAnalysisCache(ANALYSIS_CACHE_ENTRIES);
			return analysis;
		},
		analysisKey(template) {
			if (assetKeys?.template !== template) {
				const keys = new Map<string, InlineAsset[]>();
				for (const asset of template.assets ?? []) {
					const prefix = dataPrefix(asset);
					const length = prefix.length + asset.base64.length;
					const key = sampleKey(length, (i) =>
						i < prefix.length
							? prefix.charCodeAt(i)
							: asset.base64.charCodeAt(i - prefix.length),
					);
					keys.set(key, [...(keys.get(key) ?? []), asset]);
				}
				assetKeys = { template, keys };
			}
			const { keys } = assetKeys;
			return (src) => {
				const key = sampleKey(src.length, (i) => src.charCodeAt(i));
				const asset = keys
					.get(key)
					?.find(
						(a) =>
							src.length === dataPrefix(a).length + a.base64.length &&
							src.startsWith(dataPrefix(a)) &&
							src.endsWith(a.base64),
					);
				return asset ? assetUri(asset.sha256) : undefined;
			};
		},
		clear() {
			analysis = undefined;
			assetKeys = undefined;
		},
	};
}

// The data URL `compile` gives an asset, up to its base64.
const dataPrefix = (asset: InlineAsset) => `data:${asset.contentType};base64,`;

const SAMPLES = 32;

// A short key for a long string: its length and a spread of its characters.
// Lookups confirm the match, so equal keys only cost a comparison.
function sampleKey(length: number, charAt: (i: number) => number): string {
	let key = `${length}:`;
	if (length === 0) return key;
	for (let i = 0; i < SAMPLES; i++)
		key += String.fromCharCode(
			charAt(Math.floor((i * (length - 1)) / (SAMPLES - 1))),
		);
	return key;
}
