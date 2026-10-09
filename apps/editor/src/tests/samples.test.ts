import type { Template } from "@freshcoat-js/coatfile";
import {
	applyVariant,
	compile,
	sampleValues,
	validate,
} from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import { newDocument, PRESETS } from "../doc/new-document";
import { walkLayers } from "../doc/path";
import { SAMPLES } from "../samples";
import { VEND_SANS } from "../samples/vend-sans";

function expectValid(t: Template) {
	const v = validate(t);
	expect(v.ok ? [] : v.errors).toEqual([]);
}

function expectVendSans(t: Template) {
	const font = t.fonts?.find((f) => f.family === "Vend Sans");
	expect(font?.kind).toBe("local");
	const src = font?.kind === "local" ? font.files[0].src : "";
	expect(src.startsWith("data:font/woff2;base64,")).toBe(true);
	expect(src.length).toBeGreaterThan(40000);
}

describe("samples", () => {
	test("ids are unique and each lists its size", async () => {
		expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length);
		expect(SAMPLES.map((s) => s.id)).toEqual([
			"membership-card",
			"certificate",
			"minimal",
		]);
		for (const s of SAMPLES) {
			const t = await s.load();
			expect([t.width, t.height]).toEqual([s.width, s.height]);
		}
	});

	for (const s of SAMPLES) {
		test(`${s.id} validates, embeds Vend Sans and compiles every side and variant`, async () => {
			const t = await s.load();
			expectValid(t);
			expectVendSans(t);
			for (const v of [undefined, ...(t.variants ?? []).map((x) => x.id)]) {
				const out = compile(t, sampleValues(t), {
					width: t.width,
					height: t.height,
					variantId: v,
				});
				expect(out.frames.length).toBe(t.template_data.length);
			}
			const families = new Set<string>();
			t.template_data.forEach((_, side) => {
				for (const { element } of walkLayers(t, side))
					if (element.type === "text")
						families.add(element.properties.font.family);
			});
			expect([...families]).toEqual(["Vend Sans"]);
		});
	}

	test("the membership card has the fields, variant and badge the spec names", async () => {
		const t = await SAMPLES[0].load();
		expect(t.template_data.map((f) => f.name)).toEqual(["front", "back"]);
		expect(t.variants?.map((v) => v.label)).toEqual(["Midnight"]);
		const json = JSON.stringify(t.template_data);
		for (const token of ["{{display_name}}", "{{tier}}", "{{profile_url}}"])
			expect(json).toContain(token);
		expect(json).toContain('"visibleWhen":{"field":"verified"}');
		expect(t.fields.properties.verified.format).toBe("boolean");
	});

	test("Midnight recolors the front and moves the tier onto the QR panel", async () => {
		const t = await SAMPLES[0].load();
		const chip = (x: Template) =>
			x.template_data[0]?.elements.find((e) => e.id === "tier-chip");
		const midnight = applyVariant(t, "midnight");
		expect(chip(t)?.pos).toEqual({ x: 796, y: 60 });
		expect(chip(midnight)?.pos).toEqual({ x: 796, y: 334 });
		expect(chip(midnight)?.size).toEqual(chip(t)?.size);
		const panel = midnight.template_data[0]?.elements.find(
			(e) => e.id === "qr-panel",
		);
		const bottom =
			(chip(midnight)?.pos?.y ?? 0) + (chip(midnight)?.size?.height ?? 0);
		expect(bottom).toBeLessThan(panel?.pos?.y ?? 0);
		expect(midnight.template_data[0]?.background).not.toEqual(
			t.template_data[0]?.background,
		);
	});

	test("the membership card's back carries a Code 128 of the member ID", async () => {
		const t = await SAMPLES[0].load();
		const code = [...walkLayers(t, 1)].find(
			(e) => e.element.type === "barcode",
		)?.element;
		expect(code).toMatchObject({
			id: "member-barcode",
			properties: { value: "{{member_id}}", symbology: "code128" },
		});
		// clear of the details, the signature and the fine print
		expect(code?.pos).toEqual({ x: 596, y: 404 });
		expect(code?.size).toEqual({ width: 352, height: 112 });
	});

	test("the certificate is A4 landscape with auto layout and a mask", async () => {
		const t = await SAMPLES[1].load();
		expect([t.width, t.height]).toEqual([842, 595]);
		const kinds = [...walkLayers(t, 0)].map((e) => e.element.type);
		expect(kinds).toContain("mask");
		expect(JSON.stringify(t)).toContain('"layout"');
	});
});

describe("newDocument", () => {
	test("every preset validates with Vend Sans embedded", () => {
		for (const p of PRESETS) {
			const t = newDocument(p, VEND_SANS);
			expectValid(t);
			expectVendSans(t);
			expect([t.width, t.height]).toEqual([p.width, p.height]);
		}
	});

	test("the CR80 card has a front and a back; a custom size one side", () => {
		const card = newDocument(
			PRESETS.find((p) => p.id === "card-cr80") ?? PRESETS[0],
			VEND_SANS,
		);
		expect(card.template_data.map((f) => f.name)).toEqual(["front", "back"]);
		expect([card.width, card.height]).toEqual([1012, 638]);
		const custom = newDocument({ width: 300, height: 200 }, VEND_SANS);
		expect(custom.template_data.map((f) => f.name)).toEqual(["front"]);
		expectValid(custom);
	});
});
