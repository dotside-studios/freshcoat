import {
	createGroup,
	createRect,
	createRenderer,
	type Halftone,
	type Node,
	type ResolvedFill,
} from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/browser";

// The scenes packages/engine/tests/texture.test.ts renders to its goldens.
const W = 120;
const H = 80;

const LAYERS: Record<string, Partial<Node>> = {
	grain: {
		grain: {
			amount: 0.5,
			size: 2,
			monochrome: false,
			blendMode: "overlay",
			seed: 7,
		},
	},
	halftone: {
		halftone: {
			mode: "mono",
			shape: "round",
			cellSize: 8,
			angle: 45,
			invert: false,
			color: "#000000",
		},
	},
	"halftone-cmyk": {
		halftone: {
			mode: "cmyk",
			shape: "round",
			cellSize: 6,
			angle: 45,
			invert: false,
			color: "#000000",
		},
	},
};

const white = {
	pos: { x: 0, y: 0 },
	size: { width: W, height: H },
	fills: [{ kind: "solid", color: "#ffffff" }] as ResolvedFill[],
};
const grey: ResolvedFill[] = [{ kind: "solid", color: "#808080" }];

const halftone = (anchor: Halftone["anchor"]): Halftone => ({
	mode: "mono",
	shape: "round",
	cellSize: 7,
	angle: 45,
	invert: false,
	anchor,
	color: "#000000",
});

function pair(anchor: Halftone["anchor"]): Node {
	return createGroup(
		[10, 60].map((x) =>
			createRect({
				pos: { x, y: 10 },
				size: { width: 50, height: 60 },
				fills: grey,
				halftone: halftone(anchor),
			}),
		),
		white,
	);
}

function rotated(anchor: Halftone["anchor"]): Node {
	return createGroup(
		[
			createRect({
				pos: { x: 25, y: 10 },
				size: { width: 70, height: 60 },
				rotation: 30,
				fills: grey,
				halftone: halftone(anchor),
			}),
		],
		white,
	);
}

const SCENES: Record<string, () => Node> = {
	"halftone-adjacent-page": () => pair("page"),
	"halftone-adjacent-element": () => pair("element"),
	"halftone-rotated-page": () => rotated("page"),
	"halftone-rotated-element": () => rotated("element"),
};

function scene(name: string): Node {
	const custom = SCENES[name];
	if (custom) return custom();
	return createGroup(
		[
			createRect({
				id: "layer",
				pos: { x: 10, y: 10 },
				size: { width: 100, height: 60 },
				fills: [
					{
						kind: "linear",
						from: { x: 0, y: 0 },
						to: { x: 1, y: 0 },
						stops: [
							{ offset: 0, color: "#000000" },
							{ offset: 1, color: "#ff8800" },
						],
					},
				],
				...LAYERS[name],
			} as Parameters<typeof createRect>[0]),
		],
		{
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			fills: [{ kind: "solid", color: "#ffffff" }],
		},
	);
}

/** Pixels that differ between this page's render of `name` at `scale` and
 *  `golden`, the PNG Node rendered for it. */
export async function diffGolden(
	name: string,
	scale: number,
	golden: number[],
): Promise<{ differing: number; total: number; warnings: unknown[] }> {
	const ck = await loadCanvasKit(__CANVASKIT_BASE__);
	const renderer = await createRenderer({ ck, cache: false });
	const out = await renderer.render(scene(name), {
		width: W,
		height: H,
		scale,
	});
	const read = (bytes: Uint8Array) => {
		const img = ck.MakeImageFromEncoded(bytes);
		if (!img) throw new Error("could not decode");
		const px = img.readPixels(0, 0, {
			width: img.width(),
			height: img.height(),
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		}) as Uint8Array;
		img.delete();
		return px;
	};
	const a = read((out as { bytes: Uint8Array }).bytes);
	const b = read(new Uint8Array(golden));
	let differing = 0;
	for (let i = 0; i < Math.max(a.length, b.length); i++)
		if (a[i] !== b[i]) differing++;
	return { differing, total: b.length, warnings: out.warnings ?? [] };
}
