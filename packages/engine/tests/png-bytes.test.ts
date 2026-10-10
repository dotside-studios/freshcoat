// encodePng output is pinned byte for byte: the memory work in the encoder
// (candidates deflated one at a time, the IDAT written straight into the final
// buffer) must not change a single output byte at any effort level.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { encodePng, type PngEffort } from "../src/png";

const W = 96;
const H = 64;

function prng(seed: number): () => number {
	let s = seed;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s >>> 24;
	};
}

function image(
	fill: (x: number, y: number, px: Uint8Array, i: number) => void,
): Uint8Array {
	const px = new Uint8Array(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) fill(x, y, px, (y * W + x) * 4);
	return px;
}

const rand = prng(7);
const IMAGES: Record<string, Uint8Array> = {
	opaque: image((x, y, px, i) => {
		px.set([x * 2, y * 3, (x + y) & 255, 255], i);
	}),
	alpha: image((x, y, px, i) => {
		px.set([x * 2, 255 - y * 3, 40, (x * 5 + y) & 255], i);
	}),
	gray: image((x, y, px, i) => {
		const g = (x * 3 + y) & 255;
		px.set([g, g, g, 255], i);
	}),
	noisy: image((_x, _y, px, i) => {
		px.set([rand(), rand(), rand(), rand()], i);
	}),
	noisyOpaque: image((_x, _y, px, i) => {
		px.set([rand(), rand(), rand(), 255], i);
	}),
	flat: image((_x, _y, px, i) => {
		px.set([30, 144, 255, 255], i);
	}),
	flatAlpha: image((x, _y, px, i) => {
		px.set([30, 144, 255, x < W / 2 ? 0 : 128], i);
	}),
	stripes: image((x, y, px, i) => {
		const v = (x >> 3) & 1 ? 255 : 0;
		px.set([v, y & 255, 255 - v, 255], i);
	}),
};

const EFFORTS: (PngEffort | undefined)[] = [undefined, "fast", "best"];

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const EXPECTED: Record<string, string> = {
	"opaque/default":
		"7d3a620316c3e367bfde085db3c1f6a5920a8ad98726c8512a254de4282f14e6",
	"opaque/fast":
		"7d3a620316c3e367bfde085db3c1f6a5920a8ad98726c8512a254de4282f14e6",
	"opaque/best":
		"9c0539b6d71cbb27438d397950574ea6402264ad2ee3e97c82d320f7d8ed6905",
	"alpha/default":
		"a81675b5ada94e6db5581bd14cc11ed48f3b56e3a7aaeeb7b4d90ba6023fd03b",
	"alpha/fast":
		"a81675b5ada94e6db5581bd14cc11ed48f3b56e3a7aaeeb7b4d90ba6023fd03b",
	"alpha/best":
		"6b7e057121fcf21cfe85ec4e600b137e7a75aaa80aa5f00a340223630d6668ab",
	"gray/default":
		"90aa080d43c67f00a30e8efa6ad64cffbf3de631ba1d2afaafe1a15db99c7cf4",
	"gray/fast":
		"90aa080d43c67f00a30e8efa6ad64cffbf3de631ba1d2afaafe1a15db99c7cf4",
	"gray/best":
		"ccfdb0b383e3333b73d61567fee778af396b39aaaefa570062becd1bb8213a81",
	"noisy/default":
		"af5a2f34645cce2f8bbb9dab6560d872706b3b66f18e084c9aa1c5b3d2306ed2",
	"noisy/fast":
		"af5a2f34645cce2f8bbb9dab6560d872706b3b66f18e084c9aa1c5b3d2306ed2",
	"noisy/best":
		"af5a2f34645cce2f8bbb9dab6560d872706b3b66f18e084c9aa1c5b3d2306ed2",
	"noisyOpaque/default":
		"317e25499f9f892ecb2051b85a833a6a77a85fe971055aecff4c05259db2d991",
	"noisyOpaque/fast":
		"317e25499f9f892ecb2051b85a833a6a77a85fe971055aecff4c05259db2d991",
	"noisyOpaque/best":
		"317e25499f9f892ecb2051b85a833a6a77a85fe971055aecff4c05259db2d991",
	"flat/default":
		"056412cf13630352ff914bd5d0fc4027e7c986f6a1d07415f2684f641be9bc72",
	"flat/fast":
		"056412cf13630352ff914bd5d0fc4027e7c986f6a1d07415f2684f641be9bc72",
	"flat/best":
		"36277b6b2ceb2afcbe65fff90d06fe2f155bfd6871dbf697283bd5b22c27df50",
	"flatAlpha/default":
		"b640916e4fd8b4a221f83249ea429eec56d82794baa3c73bbe72bf8faf39cd7b",
	"flatAlpha/fast":
		"b640916e4fd8b4a221f83249ea429eec56d82794baa3c73bbe72bf8faf39cd7b",
	"flatAlpha/best":
		"5a17147dd59f25f8b117f8bb671f5cb314f4b534c623e3c2e3883a59928426da",
	"stripes/default":
		"2ccddbc8fd81e525590dee27e1081aeb48694c49d4404569690f3e63ed66bc66",
	"stripes/fast":
		"2ccddbc8fd81e525590dee27e1081aeb48694c49d4404569690f3e63ed66bc66",
	"stripes/best":
		"a18ec1c8be4388d6e137fe14932dc3a5b402828351f56f4757ad9f91386a9e2d",
};

describe("encodePng bytes", () => {
	for (const [name, px] of Object.entries(IMAGES)) {
		for (const effort of EFFORTS) {
			const key = `${name}/${effort ?? "default"}`;
			test(key, async () => {
				const out = await encodePng(px, W, H, effort ? { effort } : undefined);
				expect(sha(out)).toBe(EXPECTED[key]);
			});
		}
	}
});
