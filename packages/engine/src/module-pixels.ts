/** RGBA pixels for a grid of modules, row-major: `rgb` where a module is set,
 *  transparent elsewhere. A `bitmap` node draws them one pixel per module. */
export function modulePixels(
	modules: ArrayLike<boolean | number>,
	[r, g, b]: readonly [number, number, number],
): Uint8Array {
	const pixels = new Uint8Array(modules.length * 4);
	for (let i = 0; i < modules.length; i++) {
		if (!modules[i]) continue;
		pixels[i * 4] = r;
		pixels[i * 4 + 1] = g;
		pixels[i * 4 + 2] = b;
		pixels[i * 4 + 3] = 255;
	}
	return pixels;
}
