import { describe, expect, test } from "vitest";
import { assetUri, collectAssetRefs, resolveAssetSrcs } from "../src/assets";
import { minimumFormatVersion } from "../src/format";
import { templateHints } from "../src/hints";
import { DEFAULT_QR_STYLE, MAX_QR_LOGO_SIZE, qrSymbol } from "../src/qr";
import type { QrCodeElement, Template } from "../src/types";
import { validate } from "../src/validate";

function template(properties: Record<string, unknown>): Template {
	return {
		format_version: "1.7",
		version: "1.0.0",
		id: "qr",
		name: "QR",
		product: "test",
		width: 120,
		height: 120,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 120, height: 120 },
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "qr",
						type: "qr_code",
						pos: { x: 10, y: 10 },
						size: { width: 100, height: 100 },
						properties: { value: "https://freshcoat.app/c/1", ...properties },
					},
				],
			},
		],
	} as unknown as Template;
}

const qrOf = (t: Template) =>
	t.template_data[0]?.elements[0] as unknown as QrCodeElement;

const STYLED = {
	quietZone: 4,
	moduleShape: "classy",
	finderOuter: "circle",
	finderInner: "dot",
	gradient: {
		kind: "linear",
		angle: 45,
		stops: [
			{ offset: 0, color: "#000000" },
			{ offset: 1, color: "#1a237e" },
		],
	},
	logo: { src: "https://example.com/logo.png", size: 0.25, padding: 1 },
};

describe("QR style schema", () => {
	test("accepts every style option", () => {
		const result = validate(template(STYLED));
		expect(result.ok).toBe(true);
		if (result.ok) expect(qrOf(result.value).properties).toMatchObject(STYLED);
	});

	test("an unstyled QR code still validates and needs no newer format", () => {
		const t = { ...template({}), format_version: "1.0" } as Template;
		expect(validate(t).ok).toBe(true);
		expect(minimumFormatVersion(t)).toBe("1.0");
	});

	test("style options need format 1.7", () => {
		for (const [key, value] of Object.entries(STYLED)) {
			const t = { ...template({ [key]: value }), format_version: "1.0" };
			expect(minimumFormatVersion(t as Template)).toBe("1.7");
		}
	});

	test.each([
		["moduleShape", "star"],
		["finderOuter", "dot"],
		["finderInner", "circle"],
		["quietZone", -1],
		["quietZone", 1.5],
		["logo", { src: "x", size: 1.5 }],
		["logo", { src: "x", size: 0 }],
		["logo", { src: "x", padding: -1 }],
		["logo", { size: 0.2 }],
		[
			"gradient",
			{ kind: "linear", angle: 0, stops: [{ offset: 0, color: "#000" }] },
		],
		[
			"gradient",
			{
				kind: "radial",
				stops: [
					{ offset: 0, color: "#000" },
					{ offset: 1, color: "#111" },
				],
			},
		],
		[
			"gradient",
			{
				kind: "linear",
				angle: 0,
				stops: [
					{ offset: 0, color: "#000" },
					{ offset: 2, color: "#111" },
				],
			},
		],
	])("refuses %s %j", (key, value) => {
		const result = validate(template({ [key]: value }));
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(
				result.errors.some((e) =>
					e.path.startsWith("/template_data/0/elements/0/properties"),
				),
			).toBe(true);
	});
});

describe("QR logo error correction", () => {
	const value = "https://freshcoat.app/c/AB12CD?ref=logo";
	const withLogo = (logoSize: number, padding = 1) =>
		qrSymbol(value, "L", { ...DEFAULT_QR_STYLE, logoSize, logoPadding: padding });

	test("a small logo raises the level to Q", () => {
		const s = withLogo(0.1);
		expect(s.ec).toBe("Q");
		expect(s.coverage).toBeLessThanOrEqual(0.15);
	});

	test("a logo clearing more than 15% raises it to H", () => {
		const s = withLogo(0.3);
		expect(s.ec).toBe("H");
	});

	test("H is kept when asked for", () => {
		expect(
			qrSymbol(value, "H", { ...DEFAULT_QR_STYLE, logoSize: 0.1 }).ec,
		).toBe("H");
	});

	test("no logo keeps the level", () => {
		expect(qrSymbol(value, "L").ec).toBe("L");
	});

	test("the logo is capped and stays clear of the finder patterns", () => {
		const capped = withLogo(0.9, 0);
		expect(capped.logo?.side).toBeLessThanOrEqual(MAX_QR_LOGO_SIZE * capped.size);
		const tiny = qrSymbol("1", "L", {
			...DEFAULT_QR_STYLE,
			logoSize: 0.3,
			logoPadding: 2,
		});
		if (tiny.logo) {
			expect(tiny.logo.x).toBeGreaterThanOrEqual(8);
			expect(tiny.logo.x + tiny.logo.side).toBeLessThanOrEqual(tiny.size - 8);
		}
	});
});

describe("QR hints", () => {
	const codes = (properties: Record<string, unknown>) =>
		templateHints(template(properties)).flatMap((h) =>
			h.kind === "print" && h.issue.code.startsWith("qr_") ? [h.issue.code] : [],
		);

	test("a well-made styled code has none", () => {
		expect(codes({ ...STYLED, background: "#ffffff" })).toEqual([]);
	});

	test("a code drawing no background is not judged on colour", () => {
		expect(codes({ foreground: "#eeeeee" })).toEqual([]);
	});

	test("low contrast", () => {
		expect(
			codes({ foreground: "#999999", background: "#bbbbbb", quietZone: 4 }),
		).toEqual(["qr_low_contrast"]);
	});

	test("low contrast in a gradient stop", () => {
		expect(
			codes({
				background: "#ffffff",
				quietZone: 4,
				gradient: {
					kind: "linear",
					angle: 0,
					stops: [
						{ offset: 0, color: "#000000" },
						{ offset: 1, color: "#dddddd" },
					],
				},
			}),
		).toEqual(["qr_low_contrast"]);
	});

	test("inverted colours", () => {
		expect(
			codes({ foreground: "#ffffff", background: "#000000", quietZone: 4 }),
		).toEqual(["qr_inverted"]);
	});

	test("a quiet zone that is too small", () => {
		expect(codes({ background: "#ffffff", quietZone: 1 })).toEqual([
			"qr_quiet_zone",
		]);
		expect(codes({ background: "#ffffff" })).toEqual(["qr_quiet_zone"]);
	});

	test("a margin counts toward the quiet zone", () => {
		expect(codes({ background: "#ffffff", margin: 12 })).toEqual([]);
	});

	test("a logo that is too large", () => {
		expect(
			codes({
				background: "#ffffff",
				quietZone: 4,
				logo: { src: "https://example.com/l.png", size: 0.5 },
			}),
		).toEqual(["qr_logo_large"]);
	});

	test("colours from a field are not checked", () => {
		expect(
			codes({ foreground: "{{ink}}", background: "#ffffff", quietZone: 4 }),
		).toEqual([]);
	});
});

describe("QR logo assets", () => {
	const sha = "a".repeat(64);
	const t = template({ logo: { src: assetUri(sha) } });

	test("are referenced", () => {
		expect([...collectAssetRefs(t)]).toEqual([sha]);
	});

	test("resolve like an image's", () => {
		const resolved = resolveAssetSrcs(
			t,
			new Map([[sha, "https://cdn.example/logo.png"]]),
		);
		expect(qrOf(resolved).properties.logo?.src).toBe(
			"https://cdn.example/logo.png",
		);
	});
});
