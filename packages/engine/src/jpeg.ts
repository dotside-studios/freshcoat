// JPEG has no alpha channel. Skia's encoder drops it from premultiplied
// pixels, so a transparent corner comes out black; a photo export wants what
// a viewer shows on a page instead, which is white.

/**
 * Composites unpremultiplied RGBA8888 pixels over opaque white, in place, and
 * returns the same buffer with every alpha at 255.
 */
export function flattenOverWhite(pixels: Uint8Array): Uint8Array {
	for (let i = 0; i < pixels.length; i += 4) {
		const a = pixels[i + 3];
		if (a === 255) continue;
		const rest = 255 * (255 - a);
		pixels[i] = ((pixels[i] * a + rest + 127) / 255) | 0;
		pixels[i + 1] = ((pixels[i + 1] * a + rest + 127) / 255) | 0;
		pixels[i + 2] = ((pixels[i + 2] * a + rest + 127) / 255) | 0;
		pixels[i + 3] = 255;
	}
	return pixels;
}
