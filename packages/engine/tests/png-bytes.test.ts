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
		"1ac2956205c06d5642b181b6c44e589db60c2eed22833d7305eb7145cc37bcc2",
	"opaque/fast":
		"1ac2956205c06d5642b181b6c44e589db60c2eed22833d7305eb7145cc37bcc2",
	"opaque/best":
		"42681a486dd29903fc43b9ab3e64380a025cb245278ef53d556b22a8f99af0c5",
	"alpha/default":
		"2e9c2e09a4f88495262c42bbe1e7cff7184b1bd219bb8ed14783b13a42a34cf2",
	"alpha/fast":
		"2e9c2e09a4f88495262c42bbe1e7cff7184b1bd219bb8ed14783b13a42a34cf2",
	"alpha/best":
		"c2c411a515175819535fb01dcd656ec999a341f3e87580d4f1048d2afe480c12",
	"gray/default":
		"36a12b08f4010e79e811710a98b7c6d2c9fc1ea168c6d6fe7f0aaba159bfc5b4",
	"gray/fast":
		"36a12b08f4010e79e811710a98b7c6d2c9fc1ea168c6d6fe7f0aaba159bfc5b4",
	"gray/best":
		"f58e53bd6dfcb98a977f13d0b345a75bcb494c07c1d95f3b33fb2fc39c450361",
	"noisy/default":
		"02b55b774203238f343909d0ebbd0fc3c4e71be07e581bc5f3e9917a8cfd1bd1",
	"noisy/fast":
		"02b55b774203238f343909d0ebbd0fc3c4e71be07e581bc5f3e9917a8cfd1bd1",
	"noisy/best":
		"02b55b774203238f343909d0ebbd0fc3c4e71be07e581bc5f3e9917a8cfd1bd1",
	"noisyOpaque/default":
		"dd87d08f98eabe3e4274e71b4c6162eae351b7ddc9687a8d0ead57bb311d8b38",
	"noisyOpaque/fast":
		"dd87d08f98eabe3e4274e71b4c6162eae351b7ddc9687a8d0ead57bb311d8b38",
	"noisyOpaque/best":
		"dd87d08f98eabe3e4274e71b4c6162eae351b7ddc9687a8d0ead57bb311d8b38",
	"flat/default":
		"b727f68626e4da88a62eb24c2318e2df55f4c29af5eb347f96cedd637d34e21f",
	"flat/fast":
		"b727f68626e4da88a62eb24c2318e2df55f4c29af5eb347f96cedd637d34e21f",
	"flat/best":
		"23e10de44eabc634f7963df1027f4adbe009395afe0386162dc64d6d65bff963",
	"flatAlpha/default":
		"56f0be6bd8df212e888a06ca9b944145644b3b16144f2088944dfa37dcaf12cd",
	"flatAlpha/fast":
		"56f0be6bd8df212e888a06ca9b944145644b3b16144f2088944dfa37dcaf12cd",
	"flatAlpha/best":
		"05a6e8c6dd85f4aac487d149239b147005f00a58d3f06aa6eb675bff53f65be7",
	"stripes/default":
		"4eefc379268d0c3934886d82817a61cb93d6d24172c128ef298ba0e5620cc8ef",
	"stripes/fast":
		"4eefc379268d0c3934886d82817a61cb93d6d24172c128ef298ba0e5620cc8ef",
	"stripes/best":
		"236419600a915d198ea9a0d27cbbef78a52266f6ec2fae460b69673becae2974",
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
