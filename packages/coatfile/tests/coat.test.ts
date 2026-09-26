import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import {
	assetUri,
	bytesToBase64,
	collectAssetRefs,
	rehashAssets,
	subtleSha256,
	verifyAssets,
} from "../src/assets";
import {
	COAT_MEDIA_TYPE,
	CoatError,
	decodeTemplate,
	isCoatPackage,
	LEGACY_TKIT_MEDIA_TYPE,
	packTemplate,
	serializeTemplate,
	unpackTemplate,
} from "../src/coat";
import { FORMAT_VERSION, formatVersionStatus } from "../src/format";
import { templateJsonSchema } from "../src/json-schema";
import type { Template } from "../src/types";
import { validate } from "../src/validate";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const FONT = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 9, 9]);

async function withAssets(key = "deadbeef"): Promise<Template> {
	const base = structuredClone(fixtures.minimalCard);
	return {
		...base,
		template_data: base.template_data.map((frame, i) =>
			i === 0
				? {
						...frame,
						elements: [
							...frame.elements,
							{
								id: "photo",
								type: "image",
								pos: { x: 0, y: 0 },
								size: { width: 10, height: 10 },
								properties: { src: assetUri(key), fit: "cover" },
							},
						],
					}
				: frame,
		),
		fonts: [
			{
				kind: "local",
				family: "Acme",
				files: [{ weight: 400, src: assetUri("fontkey") }],
			},
		],
		assets: [
			{ sha256: key, base64: bytesToBase64(PNG), contentType: "image/png" },
			{
				sha256: "fontkey",
				base64: bytesToBase64(FONT),
				contentType: "font/woff2",
			},
		],
	} as Template;
}

describe("formatVersionStatus", () => {
	test("reads every 1.x the way the old major check did", () => {
		for (const v of ["1", "1.0", "1.0.0", "1.1", " 1.0", "1.x"]) {
			expect(formatVersionStatus(v)).not.toBe("unsupported");
		}
		expect(formatVersionStatus("1.0")).toBe("current");
		expect(formatVersionStatus(FORMAT_VERSION)).toBe("current");
	});

	test("flags a newer minor and rejects another major", () => {
		expect(formatVersionStatus("1.99")).toBe("newer");
		expect(formatVersionStatus("2.0")).toBe("unsupported");
		expect(formatVersionStatus("v1")).toBe("unsupported");
		expect(formatVersionStatus(1)).toBe("unsupported");
	});
});

describe("1.1 schema changes", () => {
	test("existing fixtures still validate unchanged", () => {
		expect(validate(fixtures.minimalCard).ok).toBe(true);
		expect(validate(fixtures.fullFeatureCard).ok).toBe(true);
	});

	test("product and version are optional", () => {
		const {
			product: _p,
			version: _v,
			...rest
		} = structuredClone(fixtures.minimalCard);
		const result = validate({ ...rest, format_version: "1.1" });
		expect(result.ok).toBe(true);
	});

	test("a present product or version must not be empty", () => {
		const result = validate({ ...fixtures.minimalCard, product: "" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0]?.code).toBe("empty_optional_field");
	});

	test("$schema survives validation", () => {
		const result = validate({
			...fixtures.minimalCard,
			$schema: "https://example.test/schema.json",
		});
		expect(result.ok && result.value.$schema).toBe(
			"https://example.test/schema.json",
		);
	});
});

describe("asset hashes", () => {
	test("verifyAssets reports keys that are not the hash of their bytes", async () => {
		const template = await withAssets();
		const mismatches = await verifyAssets(template);
		expect(mismatches.map((m) => m.declared).sort()).toEqual([
			"deadbeef",
			"fontkey",
		]);
	});

	test("rehashAssets re-keys assets, image srcs and local font files", async () => {
		const { template, renamed } = await rehashAssets(await withAssets());
		const pngHash = await subtleSha256(PNG);
		const fontHash = await subtleSha256(FONT);
		expect(renamed.get("deadbeef")).toBe(pngHash);
		expect([...collectAssetRefs(template)]).toEqual([pngHash]);
		const font = template.fonts?.[0];
		expect(font?.kind === "local" && font.files[0]?.src).toBe(
			assetUri(fontHash),
		);
		expect(await verifyAssets(template)).toEqual([]);
	});

	test("a template already keyed by hash comes back as the same object", async () => {
		const { template } = await rehashAssets(await withAssets());
		const again = await rehashAssets(template);
		expect(again.template).toBe(template);
	});
});

describe("packTemplate / unpackTemplate", () => {
	test("round-trips to a template that validates and carries the same bytes", async () => {
		const packed = await packTemplate(await withAssets());
		expect(isCoatPackage(packed)).toBe(true);

		const document = await unpackTemplate(packed);
		const result = validate(document);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(await verifyAssets(result.value)).toEqual([]);
		const pngHash = await subtleSha256(PNG);
		expect(result.value.assets?.find((a) => a.sha256 === pngHash)?.base64).toBe(
			bytesToBase64(PNG),
		);
	});

	test("lays out mimetype first and stored, then template.json, then assets", async () => {
		const packed = await packTemplate(await withAssets());
		expect(new TextDecoder().decode(packed.subarray(30, 38))).toBe("mimetype");
		expect(
			new TextDecoder().decode(
				packed.subarray(38, 38 + COAT_MEDIA_TYPE.length),
			),
		).toBe(COAT_MEDIA_TYPE);

		const names = Object.keys(unzipSync(packed));
		const pngHash = await subtleSha256(PNG);
		const fontHash = await subtleSha256(FONT);
		expect(names[0]).toBe("mimetype");
		expect(names[1]).toBe("template.json");
		expect(names.slice(2).sort()).toEqual(
			[`assets/${pngHash}.png`, `assets/${fontHash}.woff2`].sort(),
		);
		const inner = JSON.parse(
			new TextDecoder().decode(unzipSync(packed)["template.json"]),
		);
		expect(JSON.stringify(inner)).not.toContain("base64");
	});

	test("packing the same template twice gives the same bytes", async () => {
		const a = await packTemplate(await withAssets());
		const b = await packTemplate(await withAssets());
		expect(a).toEqual(b);
	});

	test("a template with no assets packs to template.json alone", async () => {
		const packed = await packTemplate(fixtures.fullFeatureCard);
		expect(Object.keys(unzipSync(packed))).toEqual([
			"mimetype",
			"template.json",
		]);
		expect(validate(await unpackTemplate(packed)).ok).toBe(true);
	});

	test("refuses to package a template from a newer minor", async () => {
		const template = { ...fixtures.minimalCard, format_version: "1.99" };
		await expect(packTemplate(template)).rejects.toMatchObject({
			code: "newer_format_version",
		});
	});

	test("rejects an entry whose bytes do not match its name", async () => {
		const files = unzipSync(await packTemplate(await withAssets()));
		const pngHash = await subtleSha256(PNG);
		files[`assets/${pngHash}.png`] = new Uint8Array([0, 0, 0]);
		await expect(unpackTemplate(zipSync(files))).rejects.toMatchObject({
			code: "asset_hash_mismatch",
		});
	});

	test("rejects a listed asset with no entry", async () => {
		const files = unzipSync(await packTemplate(await withAssets()));
		const pngHash = await subtleSha256(PNG);
		delete files[`assets/${pngHash}.png`];
		await expect(unpackTemplate(zipSync(files))).rejects.toMatchObject({
			code: "missing_asset",
		});
	});

	test("rejects a zip of something else", async () => {
		const other = zipSync({
			mimetype: strToU8("application/epub+zip"),
			"template.json": strToU8("{}"),
		});
		await expect(unpackTemplate(other)).rejects.toBeInstanceOf(CoatError);
		const bare = zipSync({ "readme.txt": strToU8("hi") });
		await expect(unpackTemplate(bare)).rejects.toMatchObject({
			code: "missing_template",
		});
	});

	test("reads a package written under the TemplateKit media type", async () => {
		const files = unzipSync(await packTemplate(await withAssets()));
		files.mimetype = strToU8(LEGACY_TKIT_MEDIA_TYPE);
		const document = await unpackTemplate(zipSync(files));
		expect(validate(document).ok).toBe(true);
	});
});

describe("serializeTemplate", () => {
	test("writes JSON that decodes and validates as the same template", async () => {
		const template = await withAssets();
		const text = serializeTemplate(template);
		const read = await decodeTemplate(text);
		expect(read.ok && read.packaged).toBe(false);
		expect(read.ok && read.document).toEqual(template);
		expect(read.ok && validate(read.document).ok).toBe(true);
	});

	test("refuses a template from a newer minor", () => {
		expect(() =>
			serializeTemplate({ ...fixtures.minimalCard, format_version: "1.99" }),
		).toThrow(CoatError);
	});
});

describe("decodeTemplate", () => {
	test("reads JSON text, JSON bytes and packages alike", async () => {
		const text = JSON.stringify(fixtures.minimalCard);
		const fromText = await decodeTemplate(text);
		const fromBytes = await decodeTemplate(strToU8(text));
		const fromPackage = await decodeTemplate(
			await packTemplate(fixtures.minimalCard),
		);
		expect(fromText.ok && fromText.packaged).toBe(false);
		expect(fromBytes.ok && validate(fromBytes.document).ok).toBe(true);
		expect(fromPackage.ok && fromPackage.packaged).toBe(true);
		expect(fromPackage.ok && validate(fromPackage.document).ok).toBe(true);
	});

	test("unwraps the figma plugin's old bundle", async () => {
		const legacy = JSON.stringify({
			schemaVersion: 1,
			template: fixtures.minimalCard,
			source: { kind: "figma" },
		});
		const result = await decodeTemplate(legacy);
		expect(result.ok && validate(result.document).ok).toBe(true);
	});

	test("reports malformed JSON without throwing", async () => {
		const result = await decodeTemplate("{ nope");
		expect(result).toMatchObject({ ok: false, code: "invalid_json" });
	});
});

describe("JSON Schema", () => {
	test("the committed schema matches the zod schema", () => {
		const expected = `${JSON.stringify(templateJsonSchema(), null, "\t")}\n`;
		const root = join(dirname(fileURLToPath(import.meta.url)), "..");
		expect(
			readFileSync(join(root, "schema/coatfile.v1.schema.json"), "utf8"),
		).toBe(expected);
	});
});
