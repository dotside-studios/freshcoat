// A missing/undecodable image paints freshcoat's placeholder. When the image
// node carries a shape mask (e.g. a circular avatar), the placeholder must be
// clipped to that shape too — not left as a bare square.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import { compileScene, createImage } from "../src/index";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

let ck: any;
async function initCk() {
	if (!ck)
		ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
	return ck;
}

// A data: URL that fetches locally but is not a decodable image → placeholder.
const BAD_SRC = `data:image/png;base64,${Buffer.from("not-an-image").toString("base64")}`;

async function render(mask: undefined | { kind: "circle" }) {
	const k = await initCk();
	const scene = createImage({
		pos: { x: 0, y: 0 },
		size: { width: 40, height: 40 },
		src: BAD_SRC,
		fit: "cover",
		...(mask ? { mask } : {}),
	});
	const commands = compileScene(scene, { width: 40, height: 40 });
	const result = await createHeadlessEnv().paint(commands, k);
	const png = (result as { bytes: Uint8Array }).bytes;
	const img = k.MakeImageFromEncoded(png);
	const px = img.readPixels(0, 0, {
		width: 40,
		height: 40,
		colorType: k.ColorType.RGBA_8888,
		alphaType: k.AlphaType.Unpremul,
		colorSpace: k.ColorSpace.SRGB,
	}) as Uint8Array;
	img.delete();
	const at = (x: number, y: number) => {
		const i = (y * 40 + x) * 4;
		return [px[i], px[i + 1], px[i + 2], px[i + 3]];
	};
	return { at };
}

// A placeholder is a plausible-looking image, so painting one MUST be reported —
// otherwise a caller (the profile OG renderer) serves a card of placeholders
// behind a 200, believing the paint was clean.
describe("painting a placeholder is reported as a warning", () => {
	test("a src the loader tried and failed reports the decode error once", async () => {
		const k = await initCk();
		const scene = createImage({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 40 },
			src: BAD_SRC,
			fit: "cover",
		});
		const commands = compileScene(scene, { width: 40, height: 40 });
		const result = await createHeadlessEnv().paint(commands, k);
		const warnings = (result as { warnings: { kind: string; src?: string }[] })
			.warnings;
		const imageWarnings = warnings.filter(
			(w) => w.kind === "image_load_failed",
		);
		expect(imageWarnings).toHaveLength(1);
		expect(imageWarnings[0]?.src).toBe(BAD_SRC);
	});

	// The failure mode that shipped: the src never reached loadImages, so the
	// loader never tried it and produced no warning of its own.
	test("a src the loader never attempted is still reported", async () => {
		const k = await initCk();
		const scene = createImage({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 40 },
			src: "https://example.com/never-loaded.png",
			fit: "cover",
		});
		// `images: []` mimics a caller that overrode the asset list and dropped it.
		const commands = compileScene(scene, {
			width: 40,
			height: 40,
			images: [],
		});
		expect(commands.some((c) => c.op === "loadImages")).toBe(false);

		const result = await createHeadlessEnv().paint(commands, k);
		const warnings = (result as { warnings: { kind: string; src?: string }[] })
			.warnings;
		expect(warnings).toContainEqual({
			kind: "image_load_failed",
			src: "https://example.com/never-loaded.png",
			error: "no image was loaded for this src",
		});
	});

	test("a scene whose images all load reports no image warnings", async () => {
		const k = await initCk();
		const scene = createImage({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 40 },
			src: "https://example.com/ok.png",
			fit: "cover",
		});
		const commands = compileScene(scene, { width: 40, height: 40 });
		const png = await makeTinyPng(k);
		const result = await createHeadlessEnv({
			images: new Map([["https://example.com/ok.png", png]]),
		}).paint(commands, k);
		const warnings = (result as { warnings: { kind: string }[] }).warnings;
		expect(warnings.filter((w) => w.kind === "image_load_failed")).toEqual([]);
	});
});

// A real, decodable 2x2 PNG produced by CanvasKit itself.
async function makeTinyPng(k: any): Promise<Uint8Array> {
	const surface = k.MakeSurface(2, 2);
	surface.getCanvas().clear(k.WHITE);
	const snapshot = surface.makeImageSnapshot();
	const bytes = snapshot.encodeToBytes() as Uint8Array;
	snapshot.delete();
	surface.delete();
	return bytes;
}

describe("image placeholder respects the node mask", () => {
	test("unmasked placeholder fills the box corners (gray field)", async () => {
		const { at } = await render(undefined);
		const [, , , a] = at(1, 1); // top-left corner
		expect(a).toBeGreaterThan(200); // opaque gray field, not transparent
	});

	test("circle-masked placeholder clips corners to transparent, keeps center", async () => {
		const { at } = await render({ kind: "circle" });
		const corner = at(1, 1); // outside the inscribed circle
		expect(corner[3]).toBeLessThan(20); // transparent
		const center = at(20, 20); // inside the circle → placeholder field #e5e7eb
		expect(center[3]).toBeGreaterThan(200);
		expect([center[0], center[1], center[2]]).toEqual([229, 231, 235]);
	});
});
