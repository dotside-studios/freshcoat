import { describe, expect, it } from "vitest";
import { transpileText } from "~/lib/figma/transpiler/text";
import type { FigmaTextNode } from "~/lib/figma/types";

const FRAME = { x: 0, y: 0, width: 1000, height: 600 };
const SCALE = 1;

const baseText = (overrides: Partial<FigmaTextNode> = {}): FigmaTextNode => ({
	id: "1:2",
	name: "headline",
	type: "TEXT",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	absoluteBoundingBox: { x: 100, y: 80, width: 600, height: 64 },
	relativeTransform: [
		[1, 0, 100],
		[0, 1, 80],
	],
	characters: "Hello",
	style: {
		fontFamily: "Comfortaa",
		fontSize: 56,
		fontWeight: 700,
		italic: false,
		textAlignHorizontal: "LEFT",
		textAlignVertical: "TOP",
		textAutoResize: "NONE",
		lineHeightPercentFontSize: 120,
	},
	fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
	...overrides,
});

describe("transpileText", () => {
	// Field registration from text content is covered centrally (binding.test);
	// these assert the rendered TextElement (placement, rotation, font, spans).
	it("maps Figma textCase to the case property; SMALL_CAPS/ORIGINAL omit it", () => {
		const withCase = (c: FigmaTextNode["style"]["textCase"]) =>
			transpileText(baseText({ style: { ...baseText().style, textCase: c } }), {
				frame: FRAME,
				scale: SCALE,
			});
		expect(withCase("UPPER").properties.case).toBe("upper");
		expect(withCase("LOWER").properties.case).toBe("lower");
		expect(withCase("TITLE").properties.case).toBe("title");
		expect("case" in withCase("SMALL_CAPS").properties).toBe(false);
		const noCase = transpileText(baseText(), { frame: FRAME, scale: SCALE });
		expect("case" in noCase.properties).toBe(false);
	});

	it('emits lineHeight "auto" when Figma reports none, so the renderer uses the font\'s', () => {
		const { lineHeightPercentFontSize: _, ...auto } = baseText().style;
		const el = transpileText(baseText({ style: auto }), {
			frame: FRAME,
			scale: SCALE,
		});
		// Figma omits both fields for AUTO, and AUTO is the font's own line box —
		// a guessed constant here shortens every auto-height layer.
		expect((el.properties.font as { lineHeight: unknown }).lineHeight).toBe(
			"auto",
		);
	});

	it("carries an explicit line height through as a multiplier", () => {
		const el = transpileText(
			baseText({ style: { ...baseText().style, lineHeightPx: 70 } }),
			{ frame: FRAME, scale: SCALE },
		);
		// PERCENT wins when both are present; px divides by the font size.
		expect((el.properties.font as { lineHeight: unknown }).lineHeight).toBe(
			1.2,
		);
		const { lineHeightPercentFontSize: _, ...pxOnly } = baseText().style;
		const byPx = transpileText(
			baseText({ style: { ...pxOnly, lineHeightPx: 70 } }),
			{ frame: FRAME, scale: SCALE },
		);
		expect((byPx.properties.font as { lineHeight: unknown }).lineHeight).toBe(
			1.25,
		);
	});

	it("maps justified alignment to justify", () => {
		const el = transpileText(
			baseText({
				style: { ...baseText().style, textAlignHorizontal: "JUSTIFIED" },
			}),
			{ frame: FRAME, scale: SCALE },
		);
		expect(el.properties.align).toBe("justify");
	});

	it("maps OpenType features to lowercase tags", () => {
		const el = transpileText(
			baseText({
				style: {
					...baseText().style,
					openTypeFeatures: { TNUM: true, LIGA: false },
				},
			}),
			{ frame: FRAME, scale: SCALE },
		);
		expect((el.properties.font as { features?: unknown }).features).toEqual({
			tnum: 1,
			liga: 0,
		});
		const none = transpileText(baseText(), { frame: FRAME, scale: SCALE });
		expect("features" in (none.properties.font as object)).toBe(false);
	});

	it("emits leadingTrim only for Figma's cap-height vertical trim", () => {
		const trim = (leadingTrim?: "NONE" | "CAP_HEIGHT") =>
			transpileText(
				baseText({
					style: {
						...baseText().style,
						...(leadingTrim ? { leadingTrim } : {}),
					},
				}),
				{ frame: FRAME, scale: SCALE },
			).properties;
		// STANDARD is Figma's default and coatfile's, so it says nothing.
		expect("leadingTrim" in trim()).toBe(false);
		expect("leadingTrim" in trim("NONE")).toBe(false);
		expect(trim("CAP_HEIGHT").leadingTrim).toBe(true);
	});

	it("maps a static text node to a TextElement", () => {
		const el = transpileText(baseText(), { frame: FRAME, scale: SCALE });
		expect(el).toEqual({
			id: "headline",
			type: "text",
			pos: { x: 100, y: 80 },
			size: { width: 600, height: 64 },
			properties: {
				value: "Hello",
				font: { family: "Comfortaa", size: 56, weight: 700, lineHeight: 1.2 },
				color: "#1a1a1a",
				align: "left",
				verticalAlign: "top",
			},
		});
	});

	it("uses the unrotated box + effective rotation for a rotated text node", () => {
		// 90°-rotated name: AABB is tall & narrow; unrotated layout is 520×45.
		// relativeTransform encodes a -90° rotation (atan2(m10, m00)).
		const node = baseText({
			name: "displayName",
			characters: "{{name}}",
			width: 520,
			height: 45,
			absoluteBoundingBox: { x: 100, y: 100, width: 45, height: 520 },
			relativeTransform: [
				[0, 1, 100],
				[-1, 0, 620],
			],
		});
		const el = transpileText(node, { frame: FRAME, scale: SCALE });
		// Unrotated box (520×45) re-centered on the AABB center (122.5, 360).
		expect(el.size).toEqual({ width: 520, height: 45 });
		expect(el.pos).toEqual({ x: -137.5, y: 337.5 });
		expect(el.rotation).toBe(-90);
	});

	it("rotates text by its relativeTransform angle", () => {
		const el = transpileText(
			baseText({
				relativeTransform: [
					[0, -1, 0],
					[1, 0, 0],
				],
				width: 200,
				height: 40,
				absoluteBoundingBox: { x: -20, y: 0, width: 40, height: 200 },
			}),
			{ frame: { x: 0, y: 0, width: 1000, height: 1000 }, scale: 1 },
		);
		// placeLocal: center = applyTransform(rt, 100, 20) = (-20, 100); pos = center-(100,20) = (-120, 80); rot 90.
		expect(el.rotation).toBe(90);
		expect(el.size).toEqual({ width: 200, height: 40 });
		expect(el.pos.x).toBeCloseTo(-120, 4);
		expect(el.pos.y).toBeCloseTo(80, 4);
	});

	it("treats negligible relativeTransform rotation as none", () => {
		const tiny = 1e-7; // sub-threshold rotation; decomposeTransform rounds angleDeg to 0
		const el = transpileText(
			baseText({
				relativeTransform: [
					[1, -tiny, 30],
					[tiny, 1, 40],
				],
				width: 100,
				height: 20,
				absoluteBoundingBox: { x: 30, y: 40, width: 100, height: 20 },
			}),
			{ frame: { x: 0, y: 0, width: 1000, height: 1000 }, scale: 1 },
		);
		expect("rotation" in el).toBe(false);
	});

	it("omits rotation when there is no transform", () => {
		const el = transpileText(baseText(), { frame: FRAME, scale: SCALE });
		expect("rotation" in el).toBe(false);
	});

	it("keeps a whole-token value verbatim", () => {
		const node = baseText({
			characters: "{{display_name}}",
			name: "displayName",
		});
		const el = transpileText(node, { frame: FRAME, scale: SCALE });
		expect(el.properties.value).toBe("{{display_name}}");
	});

	it("uses italic style when style.italic is true", () => {
		const node = baseText({ style: { ...baseText().style, italic: true } });
		const el = transpileText(node, { frame: FRAME, scale: SCALE });
		expect((el.properties.font as Record<string, unknown>).style).toBe(
			"italic",
		);
	});

	it("clips (fit:'clip') only when text is set to truncate", () => {
		const truncate = transpileText(
			baseText({ style: { ...baseText().style, textAutoResize: "TRUNCATE" } }),
			{ frame: FRAME, scale: SCALE },
		);
		expect(truncate.properties.fit).toBe("clip");
	});

	it("does NOT clip fixed / auto-height / auto-width text (Figma shows overflow)", () => {
		for (const mode of ["NONE", "HEIGHT", "WIDTH_AND_HEIGHT"] as const) {
			const el = transpileText(
				baseText({ style: { ...baseText().style, textAutoResize: mode } }),
				{ frame: FRAME, scale: SCALE },
			);
			expect("fit" in el.properties).toBe(false);
		}
	});

	it("snaps font weight to nearest 100 and keeps the exact value as wght", () => {
		const node = baseText({ style: { ...baseText().style, fontWeight: 530 } });
		const el = transpileText(node, { frame: FRAME, scale: SCALE });
		const font = el.properties.font as Record<string, unknown>;
		expect(font.weight).toBe(500);
		expect(font.variations).toEqual({ wght: 530 });
	});

	it("keeps Thin and Black weights", () => {
		for (const fontWeight of [100, 900]) {
			const node = baseText({ style: { ...baseText().style, fontWeight } });
			const el = transpileText(node, { frame: FRAME, scale: SCALE });
			const font = el.properties.font as Record<string, unknown>;
			expect(font.weight).toBe(fontWeight);
			expect("variations" in font).toBe(false);
		}
	});

	it("characterStyleOverrides → emits spans grouped by override key", () => {
		const node = baseText({
			characters: "PLAN: PRO",
			characterStyleOverrides: [0, 0, 0, 0, 0, 0, 1, 1, 1],
			styleOverrideTable: { "1": { fontWeight: 700 } },
		});
		const el = transpileText(node, { frame: FRAME, scale: SCALE });
		const spans = (el.properties as Record<string, unknown>).spans as Array<
			Record<string, unknown>
		>;
		expect(spans).toBeDefined();
		expect(spans).toHaveLength(2);
		expect(spans[0]?.text).toBe("PLAN: ");
		expect(spans[0]?.font).toBeUndefined();
		expect(spans[1]?.text).toBe("PRO");
		expect((spans[1]?.font as Record<string, unknown>).weight).toBe(700);
		// value is omitted when spans is set
		expect((el.properties as Record<string, unknown>).value).toBeUndefined();
	});

	it("carries a segment's own line height, and says auto when it has none", () => {
		const spansOf = (override: Record<string, unknown>) => {
			const el = transpileText(
				baseText({
					characters: "ab",
					characterStyleOverrides: [0, 1],
					styleOverrideTable: { "1": override as never },
				}),
				{ frame: FRAME, scale: SCALE },
			);
			const spans = (el.properties as Record<string, unknown>).spans as Array<
				Record<string, unknown>
			>;
			return (spans[1]?.font ?? {}) as Record<string, unknown>;
		};
		expect(
			spansOf({ fontSize: 20, lineHeightPercentFontSize: 150 }).lineHeight,
		).toBe(1.5);
		expect(spansOf({ fontSize: 20, lineHeightPx: 30 }).lineHeight).toBe(1.5);
		// A segment Figma reports as AUTO carries no line-height field, and must
		// not silently inherit the element's number — its box is the font's own.
		expect(spansOf({ fontSize: 20 }).lineHeight).toBe("auto");
		// An override that says nothing about text metrics says nothing here.
		expect("lineHeight" in spansOf({ fontWeight: 700 })).toBe(false);
	});

	it("keeps a fractional font size instead of rounding it to a pixel", () => {
		// 14.11 in a scaled component: rounding to 14 shortens the line box enough
		// to lose a pixel per line.
		const el = transpileText(
			baseText({
				style: { ...baseText().style, fontSize: 14.106806755065918 },
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect((el.properties.font as { size: number }).size).toBe(14.11);
	});

	it("all-zero characterStyleOverrides → falls back to value, no spans", () => {
		const node = baseText({
			characters: "Hello",
			characterStyleOverrides: [0, 0, 0, 0, 0],
			styleOverrideTable: {},
		});
		const el = transpileText(node, { frame: FRAME, scale: SCALE });
		expect((el.properties as Record<string, unknown>).spans).toBeUndefined();
		expect((el.properties as Record<string, unknown>).value).toBe("Hello");
	});

	it("font.size overrides scale with ratio", () => {
		const node = baseText({
			characters: "ab",
			characterStyleOverrides: [0, 1],
			styleOverrideTable: { "1": { fontSize: 30 } },
		});
		const el = transpileText(node, { frame: FRAME, scale: 2 });
		const spans = (el.properties as Record<string, unknown>).spans as Array<
			Record<string, unknown>
		>;
		expect((spans[1]?.font as Record<string, unknown>).size).toBe(60);
	});
});

describe("transpileText (element id)", () => {
	const ctx = { frame: FRAME, scale: SCALE };

	// Figma auto-names a text layer after its own content until someone renames
	// it, so a layer bound to {{name}} but showing a filled-in preview arrives
	// called "Jeanie Mosciski" — and the same field ends up with a different id
	// on each side of the card.
	it("names the element after the field it is bound to, not the layer", () => {
		const el = transpileText(
			baseText({ name: "Jeanie Mosciski" }),
			ctx,
			"{{name}}",
		);
		expect(el.id).toBe("name");
	});

	it("falls back to a whole-token layer name when there is no binding", () => {
		expect(transpileText(baseText({ name: "{{tagline}}" }), ctx).id).toBe(
			"tagline",
		);
	});

	it("slugs the layer name for unbound static copy", () => {
		expect(transpileText(baseText({ name: "Section heading" }), ctx).id).toBe(
			"Section_heading",
		);
	});

	// A partially-templated binding ("Hi {{name}}") is not the field, so the
	// layer still names the element.
	it("ignores a binding that is not one whole token", () => {
		expect(
			transpileText(baseText({ name: "greeting" }), ctx, "Hi {{name}}!").id,
		).toBe("greeting");
	});
});
