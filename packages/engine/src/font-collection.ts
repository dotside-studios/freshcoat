// One FontCollection per provider, so Skia's paragraph cache can hit.

import type {
	CanvasKit,
	FontCollection,
	ParagraphBuilder,
	ParagraphStyle,
	TypefaceFontProvider,
} from "canvaskit-wasm";

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
