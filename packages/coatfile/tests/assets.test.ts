import { describe, expect, test } from "vitest";
import {
	assetDataUri,
	assetUri,
	attachAssets,
	bytesToBase64,
	collectAssetRefs,
	detachAssets,
	inlineAssetUrls,
	inlinedAssetUri,
	mediaExtension,
	mediaType,
	type PendingAsset,
	parseAssetUri,
	readAssets,
	resolveAssetSrcs,
} from "../src/assets";
import type { Template } from "../src/types";
import { validate } from "../src/validate";

const BYTES = [1, 2, 3, 250, 0, 255];

function pending(sha: string): PendingAsset {
	return {
		sha256: sha,
		blob: new Blob([new Uint8Array(BYTES)], { type: "image/png" }),
		contentType: "image/png",
	};
}

function image(id: string, src: string) {
	return {
		id,
		type: "image",
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		properties: { src, fit: "fill" },
	};
}

function template(): Template {
	return {
		format_version: "1.0",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "card_cr80",
		width: 100,
		height: 100,
		fields: { type: "object", properties: {}, required: [] },
		template_data: [
			{
				name: "front",
				background: {
					...image("front_bg", assetUri("bg")),
					size: { width: 100, height: 100 },
				},
				elements: [
					image("logo", assetUri("logo")),
					image("web", "https://x/y"),
				],
			},
		],
		variants: [
			{
				id: "amber",
				label: "Amber",
				overrides: [
					{
						name: "front",
						background: {
							...image("front_bg", assetUri("bg_amber")),
							size: { width: 100, height: 100 },
						},
						elements: [{ id: "logo", properties: { src: assetUri("logo_a") } }],
					},
				],
			},
		],
	} as unknown as Template;
}

const urls = new Map([
	["bg", "https://cdn/bg.png"],
	["logo", "https://cdn/logo.png"],
	["bg_amber", "https://cdn/bg-amber.png"],
	["logo_a", "https://cdn/logo-a.png"],
]);

describe("asset URIs", () => {
	test("mint and read back", () => {
		expect(assetUri("abc")).toBe("asset:abc");
		expect(parseAssetUri("asset:abc")).toBe("abc");
	});

	test("anything that is not an asset URI reads as null", () => {
		for (const src of [
			"https://x/y",
			"{{logo}}",
			"data:image/png;base64,x",
			7,
			null,
			undefined,
		]) {
			expect(parseAssetUri(src)).toBeNull();
		}
	});
});

describe("attachAssets", () => {
	test("a template carrying its rasters is still a valid template", async () => {
		const t = await attachAssets(template(), [pending("bg"), pending("logo")]);
		const result = validate(t);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// validate() strips keys the schema does not declare, so this also pins
		// that `assets` is declared.
		expect(result.value.assets).toHaveLength(2);
	});

	test("embeds a sha256 once however many pending assets repeat it", async () => {
		const t = await attachAssets(template(), [
			pending("bg"),
			pending("bg"),
			pending("bg"),
		]);
		expect(t.assets).toHaveLength(1);
	});

	test("keeps assets already on the template", async () => {
		const once = await attachAssets(template(), [pending("bg")]);
		const twice = await attachAssets(once, [pending("logo")]);
		expect(twice.assets?.map((a) => a.sha256)).toEqual(["bg", "logo"]);
	});

	test("leaves the template alone when there is nothing to attach", async () => {
		const t = template();
		expect(await attachAssets(t, [])).toBe(t);
	});
});

describe("readAssets", () => {
	test("decodes back to the original bytes and content type", async () => {
		const t = await attachAssets(template(), [pending("bg")]);
		const [restored] = readAssets(t);
		expect([...new Uint8Array(await restored.blob.arrayBuffer())]).toEqual(
			BYTES,
		);
		expect(restored.contentType).toBe("image/png");
	});

	test("is empty for a template that carries nothing", () => {
		expect(readAssets(template())).toEqual([]);
	});
});

describe("inline asset URLs", () => {
	test("assetDataUri builds a loadable data URL", async () => {
		const t = await attachAssets(template(), [pending("bg")]);
		expect(assetDataUri((t.assets ?? [])[0])).toBe(
			`data:image/png;base64,${bytesToBase64(new Uint8Array(BYTES))}`,
		);
	});

	test("inlineAssetUrls maps every carried hash", async () => {
		const t = await attachAssets(template(), [pending("bg"), pending("logo")]);
		expect([...inlineAssetUrls(t).keys()]).toEqual(["bg", "logo"]);
	});

	test("inlinedAssetUri maps each inlined data URL back to its asset", async () => {
		const logo = { ...pending("logo"), blob: new Blob([new Uint8Array([9])]) };
		const t = await attachAssets(template(), [pending("bg"), logo]);
		const uri = inlinedAssetUri(t);
		for (const [sha, url] of inlineAssetUrls(t))
			expect(uri(url)).toBe(`asset:${sha}`);
		expect(uri("data:image/png;base64,AAAA")).toBeUndefined();
	});
});

describe("media types", () => {
	test("map between extensions and types both ways", () => {
		expect(mediaExtension("image/jpeg")).toBe("jpg");
		expect(mediaExtension("font/woff2")).toBe("woff2");
		expect(mediaExtension("text/plain")).toBeUndefined();
		expect(mediaType("JPEG")).toBe("image/jpeg");
		expect(mediaType("ttf")).toBe("font/ttf");
		expect(mediaType("txt")).toBeUndefined();
	});
});

describe("collectAssetRefs", () => {
	test("finds every reference, including inside variant overrides", () => {
		expect([...collectAssetRefs(template())].sort()).toEqual([
			"bg",
			"bg_amber",
			"logo",
			"logo_a",
		]);
	});
});

describe("detachAssets", () => {
	test("resolves backgrounds, elements and variant override deltas", () => {
		const out = detachAssets(template(), urls) as unknown as {
			template_data: Array<{
				background: { properties: { src: string } };
				elements: Array<{ properties: { src: string } }>;
			}>;
			variants: Array<{
				overrides: Array<{
					background: { properties: { src: string } };
					elements: Array<{ properties: { src: string } }>;
				}>;
			}>;
		};
		expect(out.template_data[0].background.properties.src).toBe(
			"https://cdn/bg.png",
		);
		expect(out.template_data[0].elements[0].properties.src).toBe(
			"https://cdn/logo.png",
		);
		expect(out.variants[0].overrides[0].background.properties.src).toBe(
			"https://cdn/bg-amber.png",
		);
		expect(out.variants[0].overrides[0].elements[0].properties.src).toBe(
			"https://cdn/logo-a.png",
		);
	});

	test("drops the carried bytes — nothing is left over", async () => {
		const carried = await attachAssets(template(), [
			pending("bg"),
			pending("logo"),
		]);
		const out = detachAssets(carried, urls);
		expect(out.assets).toBeUndefined();
		expect("assets" in out).toBe(false);
		expect(collectAssetRefs(out).size).toBe(0);
		expect(validate(out).ok).toBe(true);
	});

	test("leaves non-asset srcs alone", () => {
		const out = detachAssets(template(), urls) as unknown as {
			template_data: Array<{
				elements: Array<{ properties: { src: string } }>;
			}>;
		};
		expect(out.template_data[0].elements[1].properties.src).toBe("https://x/y");
	});

	test("throws rather than persist a template that would lose an image", () => {
		expect(() => detachAssets(template(), new Map())).toThrow(
			"unresolved_asset: bg",
		);
	});

	test("a template with no variants stays variant-free", () => {
		const t = template() as unknown as { variants?: unknown };
		delete t.variants;
		const out = detachAssets(t as unknown as Template, urls) as unknown as {
			variants?: unknown;
		};
		expect(out.variants).toBeUndefined();
	});
});

describe("resolveAssetSrcs", () => {
	test("leaves an unresolved asset in place instead of throwing", () => {
		const out = resolveAssetSrcs(
			template(),
			new Map([["logo", "https://cdn/logo.png"]]),
		) as unknown as {
			template_data: Array<{
				background: { properties: { src: string } };
				elements: Array<{ properties: { src: string } }>;
			}>;
		};
		expect(out.template_data[0].background.properties.src).toBe("asset:bg");
		expect(out.template_data[0].elements[0].properties.src).toBe(
			"https://cdn/logo.png",
		);
	});
});

// An image nested inside a frame, which is where the Figma transpiler puts a
// raster it flattened out of a group.
function nestedTemplate(): Template {
	return {
		...template(),
		template_data: [
			{
				name: "front",
				background: {
					...image("front_bg", assetUri("bg")),
					size: { width: 100, height: 100 },
				},
				elements: [
					{
						id: "outer",
						type: "frame",
						pos: { x: 0, y: 0 },
						size: { width: 50, height: 50 },
						properties: {
							children: [
								{
									id: "inner",
									type: "frame",
									pos: { x: 0, y: 0 },
									size: { width: 25, height: 25 },
									properties: {
										children: [image("deep_logo", assetUri("logo"))],
									},
								},
							],
						},
					},
				],
			},
		],
		variants: [],
	} as unknown as Template;
}

type Nested = { properties: { children: Nested[]; src?: unknown } };

/** The src of the image two frames deep in the side's first element. */
function deepSrc(t: Template): unknown {
	const td = t as unknown as { template_data: [{ elements: Nested[] }] };
	return td.template_data[0].elements[0].properties.children[0].properties
		.children[0].properties.src;
}

describe("asset src rewriting inside nested frames", () => {
	test("resolveAssetSrcs rewrites an image nested in a frame", () => {
		// The bug this guards: rewriting stopped at a side's top level, so a
		// raster nested in a frame kept its bare `asset:` src and the painter
		// reported it as a failed image load.
		const out = resolveAssetSrcs(
			nestedTemplate(),
			new Map([["logo", "https://cdn/logo.png"]]),
		);
		expect(deepSrc(out)).toBe("https://cdn/logo.png");
	});

	test("collectAssetRefs sees a nested image's asset", () => {
		// Bundling reads this to decide which bytes ride along; a missed ref
		// means the raster's bytes are dropped from the bundle entirely.
		expect([...collectAssetRefs(nestedTemplate())].sort()).toEqual([
			"bg",
			"logo",
		]);
	});

	test("detachAssets resolves a nested image rather than leaving it unresolved", () => {
		const urls = new Map([
			["bg", "https://cdn/bg.png"],
			["logo", "https://cdn/logo.png"],
		]);
		const out = detachAssets(nestedTemplate(), urls);
		expect(deepSrc(out)).toBe("https://cdn/logo.png");
		expect(collectAssetRefs(out).size).toBe(0);
	});

	test("leaves a nested frame untouched when nothing in it changes", () => {
		const input = nestedTemplate();
		const out = resolveAssetSrcs(input, new Map());
		const inEls = (
			input as unknown as { template_data: [{ elements: unknown[] }] }
		).template_data[0].elements;
		const outEls = (
			out as unknown as { template_data: [{ elements: unknown[] }] }
		).template_data[0].elements;
		expect(outEls[0]).toBe(inEls[0]);
	});
});

describe("asset src rewriting inside masks", () => {
	function masked(): Template {
		return {
			...template(),
			template_data: [
				{
					name: "front",
					background: {
						...image("front_bg", assetUri("bg")),
						size: { width: 100, height: 100 },
					},
					elements: [
						{
							id: "m",
							type: "mask",
							pos: { x: 0, y: 0 },
							size: { width: 50, height: 50 },
							properties: {
								mask: image("shape", assetUri("alpha")),
								children: [image("photo", assetUri("photo"))],
							},
						},
					],
				},
			],
			variants: [],
		} as unknown as Template;
	}

	test("collectAssetRefs sees the mask shape and the masked content", () => {
		expect([...collectAssetRefs(masked())].sort()).toEqual([
			"alpha",
			"bg",
			"photo",
		]);
	});

	test("resolveAssetSrcs rewrites both", () => {
		const out = resolveAssetSrcs(
			masked(),
			new Map([
				["alpha", "https://cdn/a.png"],
				["photo", "https://cdn/p.png"],
			]),
		) as unknown as {
			template_data: [
				{
					elements: [
						{
							properties: {
								mask: { properties: { src: string } };
								children: [{ properties: { src: string } }];
							};
						},
					];
				},
			];
		};
		const m = out.template_data[0].elements[0].properties;
		expect(m.mask.properties.src).toBe("https://cdn/a.png");
		expect(m.children[0].properties.src).toBe("https://cdn/p.png");
	});
});
