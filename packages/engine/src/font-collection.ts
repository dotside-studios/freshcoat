// One FontCollection per provider, so Skia's paragraph cache can hit.

// biome-ignore lint/suspicious/noExplicitAny: external WASM API, untyped
type CK = any;

const collections = new WeakMap<CK, CK>();

export function fontCollectionFor(ck: CK, provider: CK): CK {
	let fc = collections.get(provider);
	if (!fc) {
		fc = ck.FontCollection.Make();
		fc.setDefaultFontManager(provider);
		fc.enableFontFallback();
		collections.set(provider, fc);
	}
	return fc;
}

export function makeParagraphBuilder(ck: CK, style: CK, provider: CK): CK {
	return ck.ParagraphBuilder.MakeFromFontCollection(
		style,
		fontCollectionFor(ck, provider),
	);
}

export function deleteFontProvider(provider: CK): void {
	const fc = collections.get(provider);
	collections.delete(provider);
	try {
		fc?.delete();
	} finally {
		provider.delete();
	}
}
