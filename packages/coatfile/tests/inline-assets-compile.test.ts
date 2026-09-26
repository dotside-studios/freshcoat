import { describe, expect, test } from "vitest";
import { assetUri, attachAssets, type PendingAsset } from "../src/assets";
import { compile } from "../src/compile";
import type { Template } from "../src/types";

// Distinct bytes per hash: compileFrame collects image srcs into a Set, so two
// assets encoding to the same data URL would legitimately collapse into one.
function pending(sha: string, byte: number): PendingAsset {
	return {
		sha256: sha,
		blob: new Blob([new Uint8Array([1, 2, 3, byte])], { type: "image/png" }),
		contentType: "image/png",
	};
}

// The shape the figma plugin writes: image srcs are content hashes and the
// bytes ride along in `assets`.
function exported(): Template {
	return {
		format_version: "1.0",
		version: "1.0.0",
		id: "aurora",
		name: "Aurora",
		product: "card_cr80",
		width: 100,
		height: 100,
		fields: { type: "object", properties: {}, required: [] },
		template_data: [
			{
				name: "front",
				background: {
					id: "front_bg",
					type: "image",
					pos: { x: 0, y: 0 },
					size: { width: 100, height: 100 },
					properties: { src: assetUri("bg"), fit: "fill" },
				},
				elements: [
					{
						id: "logo",
						type: "image",
						pos: { x: 10, y: 10 },
						size: { width: 20, height: 20 },
						properties: { src: assetUri("logo"), fit: "fill" },
					},
				],
			},
		],
	} as unknown as Template;
}

describe("compile() on a template that carries its own rasters", () => {
	test("resolves asset: srcs to data URLs with no pre-pass", async () => {
		const template = await attachAssets(exported(), [
			pending("bg", 10),
			pending("logo", 20),
		]);

		const compiled = compile(template, {}, { width: 100, height: 100 });

		for (const src of compiled.frames[0].assets.images) {
			expect(src.startsWith("data:image/png;base64,")).toBe(true);
		}
		expect(compiled.frames[0].assets.images).toHaveLength(2);
	});

	test("an asset the template does not carry is left for the caller to supply", () => {
		const compiled = compile(exported(), {}, { width: 100, height: 100 });
		expect(compiled.frames[0].assets.images).toEqual([
			assetUri("bg"),
			assetUri("logo"),
		]);
	});

	test("a template with URL srcs compiles unchanged", () => {
		const t = exported();
		const frame = (
			t as unknown as {
				template_data: Array<{
					background: { properties: { src: string } };
					elements: Array<{ properties: { src: string } }>;
				}>;
			}
		).template_data[0];
		frame.background.properties.src = "https://cdn/bg.png";
		frame.elements[0].properties.src = "https://cdn/logo.png";

		const compiled = compile(t, {}, { width: 100, height: 100 });
		expect(compiled.frames[0].assets.images).toEqual([
			"https://cdn/bg.png",
			"https://cdn/logo.png",
		]);
	});
});
