import {
	assetUri,
	createPaintCache,
	type InlineAsset,
	type PaintCache,
	type Template,
} from "@freshcoat-js/coatfile";
import {
	type CachedTextEngine,
	deriveFontMetrics,
	memoizeTextEngine,
	type TextEngine,
} from "@freshcoat-js/engine";
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
	let assetKeys:
		| { template: Template; keys: Map<string, InlineAsset[]> }
		| undefined;
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
			paint?.dispose();
			paint = undefined;
			analysis = undefined;
			assetKeys = undefined;
		},
	};
}

type Fonts = Map<string, Uint8Array[]>;
type DisposableTextEngine = TextEngine & { dispose(): void };

/** One render worker's text engine, memoized as the live preview's is. */
export type WorkerText<E extends DisposableTextEngine> = {
	/** The engine for `fonts`, rebuilt by `create` when `fonts` is a different
	 *  map. */
	get(
		fonts: Fonts,
		create: (fonts: Fonts) => E,
	): {
		engine: CachedTextEngine<E>;
		fontMetrics: ReturnType<typeof deriveFontMetrics>;
	};
	clear(): void;
};

export function createWorkerText<
	E extends DisposableTextEngine,
>(): WorkerText<E> {
	let text:
		| (ReturnType<WorkerText<E>["get"]> & { fonts: Fonts })
		| undefined;
	const clear = () => {
		text?.engine.dispose();
		text = undefined;
	};
	return {
		get(fonts, create) {
			if (text?.fonts !== fonts) {
				clear();
				text = {
					fonts,
					engine: memoizeTextEngine(create(fonts)),
					fontMetrics: deriveFontMetrics(fonts),
				};
			}
			return text;
		},
		clear,
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
