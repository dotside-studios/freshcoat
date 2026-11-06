import { describe, expect, test } from "bun:test";
import { bytesToBase64 } from "@freshcoat-js/engine/internal";
import { strToU8, zipSync } from "fflate";
import { fixtures } from "../fixtures";
import { loadTemplate } from "../src";
import { assetUri } from "../src/assets";
import { packTemplate, pruneUnusedAssets } from "../src/coat";
import type { Template } from "../src/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const png = (sha256: string) => ({
	sha256,
	base64: bytesToBase64(PNG),
	contentType: "image/png" as const,
});

function image(id: string, sha: string) {
	return {
		id,
		type: "image",
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		properties: { src: assetUri(sha), fit: "cover" },
	};
}

function withElements(elements: unknown[]): Template {
	const base = structuredClone(fixtures.minimalCard);
	return {
		...base,
		template_data: base.template_data.map((frame, i) =>
			i === 0
				? { ...frame, elements: [...frame.elements, ...elements] }
				: frame,
		),
	} as Template;
}

describe("loadTemplate", () => {
	test("diagnostics hash assets only when requested", async () => {
		let calls = 0;
		const sha256 = async () => {
			calls++;
			return "actual";
		};
		const json = JSON.stringify({
			...fixtures.minimalCard,
			assets: [png("declared")],
		});
		const normal = await loadTemplate(json, { sha256 });
		expect(normal.ok).toBe(true);
		expect(calls).toBe(0);
		expect(normal).not.toHaveProperty("diagnostics");
		const checked = await loadTemplate(json, { sha256, diagnostics: true });
		expect(checked.ok && checked.diagnostics?.misKeyedAssets).toEqual([
			{ declared: "declared", actual: "actual" },
		]);
		expect(calls).toBe(1);
	});

	test("reports findings on the healed template without changing its assets", async () => {
		const raw = {
			...withElements([image("photo", "declared"), image("photo", "declared")]),
			format_version: "1.99",
			assets: [png("declared")],
		};
		const loaded = await loadTemplate(JSON.stringify(raw), {
			diagnostics: true,
			sha256: () => "actual",
		});
		expect(loaded).toMatchObject({
			ok: true,
			healed: true,
			renamedIds: ["photo_2"],
			packaged: false,
			diagnostics: {
				newerFormat: true,
				misKeyedAssets: [{ declared: "declared", actual: "actual" }],
			},
			template: { assets: [png("declared")] },
		});
	});

	test("invalid and unreadable input keep their results and skip diagnostic hashing", async () => {
		const sha256 = () => {
			throw new Error("must not hash");
		};
		for (const input of [
			"not json",
			JSON.stringify({
				...fixtures.minimalCard,
				width: -1,
				assets: [png("declared")],
			}),
		]) {
			expect(await loadTemplate(input, { diagnostics: true, sha256 })).toEqual(
				await loadTemplate(input),
			);
		}
	});

	test("package integrity is enforced with diagnostics enabled or disabled", async () => {
		const input = zipSync({
			"template.json": strToU8(
				JSON.stringify({
					...fixtures.minimalCard,
					assets: [{ sha256: "declared", contentType: "image/png" }],
				}),
			),
			"assets/declared.png": PNG,
		});
		for (const diagnostics of [false, true]) {
			expect(
				await loadTemplate(input, { diagnostics, sha256: () => "actual" }),
			).toMatchObject({
				ok: false,
				reason: "unreadable",
				code: "asset_hash_mismatch",
			});
			expect(
				await loadTemplate(input, { diagnostics, sha256: () => "declared" }),
			).toMatchObject({
				ok: true,
				packaged: true,
			});
		}
	});

	test("diagnostic hash failures reject instead of reporting clean assets", async () => {
		const input = JSON.stringify({
			...fixtures.minimalCard,
			assets: [png("declared")],
		});
		await expect(
			loadTemplate(input, {
				diagnostics: true,
				sha256: () => {
					throw new Error("hash unavailable");
				},
			}),
		).rejects.toThrow("hash unavailable");
	});

	test("takes a valid file as written", async () => {
		const json = JSON.stringify(fixtures.minimalCard);
		const r = await loadTemplate(json);
		expect(r).toMatchObject({ ok: true, healed: false, renamedIds: [] });
		expect(r.ok && r.packaged).toBe(false);
		const packed = await loadTemplate(await packTemplate(fixtures.minimalCard));
		expect(packed.ok && packed.packaged).toBe(true);
	});

	test("heals duplicate element ids and says which it renamed", async () => {
		const dupes = withElements([image("photo", "a"), image("photo", "a")]);
		const r = await loadTemplate(
			JSON.stringify({ ...dupes, assets: [png("a")] }),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.healed).toBe(true);
		expect(r.renamedIds).toHaveLength(1);
		const ids = r.template.template_data[0]?.elements.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids?.length);
	});

	test("reports the file's own errors when healing does not help", async () => {
		const r = await loadTemplate(
			JSON.stringify({ ...fixtures.minimalCard, width: -1 }),
		);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.reason).toBe("invalid");
		expect(!r.ok && r.reason === "invalid" && r.errors.length).toBeGreaterThan(
			0,
		);
	});

	test("is unreadable for text that is not JSON", async () => {
		const r = await loadTemplate("not json");
		expect(r).toMatchObject({
			ok: false,
			reason: "unreadable",
			code: "invalid_json",
		});
	});
});

describe("pruneUnusedAssets", () => {
	test("drops an unused asset and keeps referenced ones, variant-only included", () => {
		const t = {
			...withElements([image("photo", "used")]),
			variants: [
				{
					id: "alt",
					label: "Alt",
					overrides: [
						{
							name: "front",
							elements: [
								{ id: "photo", properties: { src: assetUri("variant") } },
							],
						},
					],
				},
			],
			fonts: [
				{
					kind: "local",
					family: "Acme",
					files: [{ weight: 400, src: assetUri("font") }],
				},
			],
			assets: [png("used"), png("unused"), png("variant"), png("font")],
		} as Template;
		expect(pruneUnusedAssets(t).assets?.map((a) => a.sha256)).toEqual([
			"used",
			"variant",
			"font",
		]);
	});

	test("returns the template when nothing is unused, and drops an empty list", () => {
		const t = {
			...withElements([image("photo", "used")]),
			assets: [png("used")],
		};
		expect(pruneUnusedAssets(t)).toBe(t);
		const none = {
			...fixtures.minimalCard,
			assets: [png("unused")],
		} as Template;
		expect("assets" in pruneUnusedAssets(none)).toBe(false);
	});
});
