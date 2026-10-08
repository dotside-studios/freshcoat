// One FontCollection per provider, so Skia's paragraph cache can hit.

import type {
	CanvasKit,
	FontCollection,
	ParagraphBuilder,
	ParagraphStyle,
	TypefaceFontProvider,
} from "canvaskit-wasm";
import { fontArrayBuffer } from "./font-bytes";

const collections = new WeakMap<TypefaceFontProvider, FontCollection>();

export function fontCollectionFor(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
): FontCollection {
	let fc = collections.get(provider);
	if (!fc) {
		fc = ck.FontCollection.Make();
		fc.setDefaultFontManager(provider);
		fc.enableFontFallback();
		collections.set(provider, fc);
	}
	return fc;
}

export function makeParagraphBuilder(
	ck: CanvasKit,
	style: ParagraphStyle,
	provider: TypefaceFontProvider,
): ParagraphBuilder {
	return ck.ParagraphBuilder.MakeFromFontCollection(
		style,
		fontCollectionFor(ck, provider),
	);
}

export function deleteFontProvider(provider: TypefaceFontProvider): void {
	const fc = collections.get(provider);
	collections.delete(provider);
	try {
		fc?.delete();
	} finally {
		provider.delete();
	}
}

type Face = { family: string; bytes: Uint8Array };

// A provider shared by the text engine and the paint cache of one renderer, so
// each font's bytes are copied into the WASM heap once. Freed when the last
// holder releases it.
export type SharedFontProvider = {
	readonly provider: TypefaceFontProvider;
	// Bumped each time extend registers faces.
	readonly generation: number;
	retain(): void;
	release(): void;
	// Registers the faces `fonts` adds, when it keeps every face registered so
	// far. False, with nothing registered, when it drops or replaces one.
	extend(fonts: ReadonlyMap<string, readonly Uint8Array[]>): boolean;
};

export function createSharedFontProvider(
	ck: CanvasKit,
	fonts: ReadonlyMap<string, readonly Uint8Array[]> | readonly Face[],
): SharedFontProvider {
	const provider = ck.TypefaceFontProvider.Make();
	const held = new Map<string, Uint8Array[]>();
	const register = (family: string, bytes: Uint8Array) => {
		provider.registerFont(fontArrayBuffer(bytes), family);
		const faces = held.get(family);
		if (faces) faces.push(bytes);
		else held.set(family, [bytes]);
	};
	try {
		if (Array.isArray(fonts))
			for (const f of fonts as readonly Face[]) register(f.family, f.bytes);
		else
			for (const [family, faces] of fonts as ReadonlyMap<
				string,
				readonly Uint8Array[]
			>)
				for (const bytes of faces) register(family, bytes);
	} catch (e) {
		provider.delete();
		throw e;
	}
	let refs = 1;
	let generation = 0;
	const live = () => {
		if (refs === 0) throw new Error("font provider is released");
	};
	return {
		provider,
		get generation() {
			return generation;
		},
		retain() {
			live();
			refs++;
		},
		release() {
			live();
			if (--refs === 0) deleteFontProvider(provider);
		},
		extend(next) {
			live();
			for (const [family, faces] of held) {
				const want = next.get(family);
				if (!want || faces.some((bytes, i) => want[i] !== bytes)) return false;
			}
			let added = false;
			for (const [family, faces] of next)
				for (const bytes of faces.slice(held.get(family)?.length ?? 0)) {
					register(family, bytes);
					added = true;
				}
			if (added) {
				generation++;
				// A collection caches family lookups, so one made before these faces
				// would keep missing them.
				const fc = collections.get(provider);
				collections.delete(provider);
				fc?.delete();
			}
			return true;
		},
	};
}
