import { describe, expect, test } from "vitest";
import { z } from "zod";
import { fixtures } from "../fixtures";
import { compile } from "../src/compile";
import type {
	Element,
	FrameElement,
	MaskElement,
	RectElement,
	Template,
	TextElement,
	Variant,
} from "../src/types";
import { validate } from "../src/validate";
import { resizeTemplate } from "../src/constraints";
import { minimumFormatVersion } from "../src/format";
import {
	applyVariant,
	checkVariants,
	closestVariant,
	DEFAULT_VARIANT_ID,
	hasShapedVariants,
	hiddenElementIds,
	isEmptyDelta,
	isEmptyVariant,
	mergedElementDelta,
	sideBackground,
	sideDeltas,
	variantDeltas,
	variantIdFor,
	variantSize,
} from "../src/variants";

const rect = (id: string, fill: string): RectElement => ({
	id,
	type: "rect",
	pos: { x: 0, y: 0 },
	size: { width: 20, height: 10 },
	properties: { fill },
});

const text = (id: string, color: string): TextElement => ({
	id,
	type: "text",
	pos: { x: 10, y: 20 },
	size: { width: 80, height: 30 },
	properties: {
		value: "Hi {{displayName}}",
		font: { family: "Comfortaa", size: 16 },
		color,
	},
});

const wrapper: FrameElement = {
	id: "wrapper",
	type: "frame",
	pos: { x: 5, y: 5 },
	size: { width: 50, height: 30 },
	properties: {
		children: [
			text("nested_text", "#111111"),
			{
				id: "inner",
				type: "frame",
				pos: { x: 0, y: 0 },
				size: { width: 20, height: 10 },
				properties: { children: [rect("deep_rect", "#000000")] },
			},
		],
	},
};

const masked: MaskElement = {
	id: "masked",
	type: "mask",
	pos: { x: 0, y: 0 },
	size: { width: 40, height: 20 },
	properties: {
		mask: rect("mask_shape", "#ffffff"),
		children: [rect("masked_rect", "#ff0000")],
	},
};

const template: Template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	product: "card_cr80",
	width: 100,
	height: 60,
	fields: {
		type: "object",
		properties: { displayName: { type: "string", default: "Hello" } },
	},
	template_data: [
		{
			name: "front",
			background: {
				...rect("bg", "#fef3c7"),
				size: { width: 100, height: 60 },
			},
			elements: [text("title", "#1a1a1a"), wrapper, masked],
		},
		{
			name: "back",
			background: {
				...rect("bg", "#ffffff"),
				size: { width: 100, height: 60 },
			},
			elements: [rect("back_rect", "#cccccc")],
		},
	],
	variants: [
		{
			id: "blue",
			label: "Blue",
			overrides: [
				{
					name: "front",
					background: {
						...rect("bg", "#3b82f6"),
						size: { width: 100, height: 60 },
					},
				},
			],
		},
		{
			id: "ink",
			label: "Ink",
			overrides: [
				{
					name: "front",
					elements: [
						{ id: "title", properties: { color: "#0d0d0d" } },
						{ id: "nested_text", properties: { color: "#222222" } },
						{ id: "deep_rect", properties: { fill: "#333333" } },
						{ id: "mask_shape", properties: { fill: "#000000" } },
						{ id: "masked_rect", properties: { fill: "#00ff00" } },
					],
				},
			],
		},
	],
};

// Overrides that validate() rejects (an unknown frame, a frame named twice).
// compile never sees them, but applyVariant takes any template.
const unvalidated: Template = {
	...template,
	variants: [
		...template.variants!,
		{
			id: "layered",
			label: "Layered",
			overrides: [
				{ name: "missing", background: rect("bg", "#123456") },
				{
					name: "front",
					elements: [{ id: "title", properties: { color: "#aaaaaa" } }],
				},
				{
					name: "front",
					elements: [{ id: "title", properties: { value: "Second" } }],
				},
			],
		},
	],
};

const frame = (t: Template, name: string) =>
	t.template_data.find((f) => f.name === name)!;

const byId = (els: Element[], id: string): Element | undefined => {
	for (const el of els) {
		if (el.id === id) return el;
		const nested =
			el.type === "frame"
				? byId(el.properties.children, id)
				: el.type === "mask"
					? byId([el.properties.mask, ...el.properties.children], id)
					: undefined;
		if (nested) return nested;
	}
	return undefined;
};

const deepFreeze = <T>(value: T): T => {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return value;
};

describe("applyVariant", () => {
	test.each([
		"blue",
		"ink",
	])("compile with variant %s matches compile of applyVariant", (variantId) => {
		const opts = { width: 100, height: 60 };
		const values = { displayName: "Alex" };
		expect(compile(applyVariant(template, variantId), values, opts)).toEqual(
			compile(template, values, { ...opts, variantId }),
		);
	});

	const full = fixtures.fullFeatureCard;
	test.each(
		(full.variants ?? []).map((v) => v.id),
	)("full-feature fixture: compile with variant %s matches applyVariant", (variantId) => {
		const opts = { width: full.width, height: full.height };
		expect(compile(applyVariant(full, variantId), {}, opts)).toEqual(
			compile(full, {}, { ...opts, variantId }),
		);
	});

	test("replaces the background of the named frame only", () => {
		const out = applyVariant(template, "blue");
		expect(frame(out, "front").background.properties).toEqual({
			fill: "#3b82f6",
		});
		expect(frame(out, "front").elements).toBe(
			frame(template, "front").elements,
		);
		expect(frame(out, "back")).toBe(frame(template, "back"));
	});

	test("merges deltas into nested frame and mask elements", () => {
		const els = frame(applyVariant(template, "ink"), "front").elements;
		const props = (id: string) =>
			(byId(els, id) as { properties: Record<string, unknown> }).properties;
		expect(props("title").color).toBe("#0d0d0d");
		expect(props("title").value).toBe("Hi {{displayName}}");
		expect(props("nested_text").color).toBe("#222222");
		expect(props("deep_rect").fill).toBe("#333333");
		expect(props("mask_shape").fill).toBe("#000000");
		expect(props("masked_rect").fill).toBe("#00ff00");
		expect(frame(applyVariant(template, "ink"), "front").background).toBe(
			frame(template, "front").background,
		);
	});

	test("skips an unknown frame and applies repeated overrides in order", () => {
		const out = applyVariant(unvalidated, "layered");
		const title = byId(frame(out, "front").elements, "title") as TextElement;
		expect(title.properties.color).toBe("#aaaaaa");
		expect(title.properties.value).toBe("Second");
		expect(out.template_data.map((f) => f.name)).toEqual(["front", "back"]);
	});

	test("keeps variants and does not mutate the input", () => {
		const frozen = deepFreeze(structuredClone(unvalidated));
		const before = structuredClone(frozen);
		for (const id of ["blue", "ink", "layered"]) {
			const out = applyVariant(frozen, id);
			expect(out.variants).toBe(frozen.variants);
		}
		expect(frozen).toEqual(before);
	});

	test("throws on an unknown variant", () => {
		expect(() => applyVariant(template, "ghost")).toThrow(
			"unknown_variant: ghost",
		);
	});
});

const withVariant = (
	overrides: NonNullable<Template["variants"]>[number]["overrides"],
): Template => ({
	...template,
	format_version: "1.4",
	variants: [{ id: "v", label: "V", overrides }],
});

const front = (
	elements: NonNullable<
		NonNullable<Template["variants"]>[number]["overrides"][number]["elements"]
	>,
) => withVariant([{ name: "front", elements }]);

describe("applyVariant shell fields", () => {
	test("pos, size, rotation and opacity replace the element's own", () => {
		const t = front([
			{ id: "title", properties: {}, pos: { x: 1, y: 2 } },
			{ id: "back_rect", properties: {}, size: { width: 7, height: 8 } },
			{ id: "nested_text", properties: {}, rotation: 45 },
			{ id: "deep_rect", properties: {}, opacity: 0.25 },
		]);
		const els = frame(applyVariant(t, "v"), "front").elements;
		const title = byId(els, "title")!;
		expect(title.pos).toEqual({ x: 1, y: 2 });
		expect(title.size).toEqual({ width: 80, height: 30 });
		expect(title.properties).toEqual(
			byId(frame(template, "front").elements, "title")!.properties,
		);
		expect(byId(els, "nested_text")!.rotation).toBe(45);
		expect(byId(els, "deep_rect")!.opacity).toBe(0.25);
		expect(byId(els, "deep_rect")!.pos).toEqual({ x: 0, y: 0 });
		// A delta applies on its own side only.
		expect(byId(els, "back_rect")).toBeUndefined();
		expect(frame(applyVariant(t, "v"), "back")).toBe(frame(template, "back"));
	});

	test("shell fields and properties apply together", () => {
		const t = front([
			{
				id: "title",
				properties: { color: "#ff0000" },
				size: { width: 40, height: 10 },
			},
		]);
		const title = byId(
			frame(applyVariant(t, "v"), "front").elements,
			"title",
		) as TextElement;
		expect(title.size).toEqual({ width: 40, height: 10 });
		expect(title.properties.color).toBe("#ff0000");
		expect(title.properties.value).toBe("Hi {{displayName}}");
	});

	test("resizing a frame does not re-place its children", () => {
		const t = front([
			{ id: "wrapper", properties: {}, size: { width: 100, height: 60 } },
		]);
		const out = frame(applyVariant(t, "v"), "front").elements;
		expect(byId(out, "wrapper")!.size).toEqual({ width: 100, height: 60 });
		expect(byId(out, "nested_text")).toEqual(
			byId(frame(template, "front").elements, "nested_text"),
		);
	});
});

describe("applyVariant hidden", () => {
	const ids = (els: Element[]): string[] =>
		els.flatMap((el) => [
			el.id,
			...(el.type === "frame"
				? ids(el.properties.children)
				: el.type === "mask"
					? ids([el.properties.mask, ...el.properties.children])
					: []),
		]);

	test("drops a hidden element and its subtree by default", () => {
		const t = front([{ id: "wrapper", properties: {}, hidden: true }]);
		const out = ids(frame(applyVariant(t, "v"), "front").elements);
		expect(out).not.toContain("wrapper");
		expect(out).not.toContain("nested_text");
		expect(out).not.toContain("deep_rect");
		expect(out).toContain("title");
	});

	test("keeps it with hidden: keep, other delta fields applied", () => {
		const t = front([
			{ id: "title", properties: {}, hidden: true, opacity: 0.5 },
		]);
		const els = frame(
			applyVariant(t, "v", { hidden: "keep" }),
			"front",
		).elements;
		expect(els.map((e) => e.id)).toEqual(["title", "wrapper", "masked"]);
		expect(els[0].opacity).toBe(0.5);
	});

	test("hidden: false leaves the element in", () => {
		const t = front([{ id: "title", properties: {}, hidden: false }]);
		expect(ids(frame(applyVariant(t, "v"), "front").elements)).toContain(
			"title",
		);
	});

	test("drops hidden elements inside a frame and a mask", () => {
		const t = front([
			{ id: "deep_rect", properties: {}, hidden: true },
			{ id: "masked_rect", properties: {}, hidden: true },
		]);
		const out = ids(frame(applyVariant(t, "v"), "front").elements);
		expect(out).toEqual([
			"title",
			"wrapper",
			"nested_text",
			"inner",
			"masked",
			"mask_shape",
		]);
		const kept = ids(
			frame(applyVariant(t, "v", { hidden: "keep" }), "front").elements,
		);
		expect(kept).toContain("deep_rect");
		expect(kept).toContain("masked_rect");
	});

	test("a hidden mask shape stays, since it is never drawn itself", () => {
		const t = front([{ id: "mask_shape", properties: {}, hidden: true }]);
		const masked = byId(
			frame(applyVariant(t, "v"), "front").elements,
			"masked",
		) as MaskElement;
		expect(masked.properties.mask.id).toBe("mask_shape");
	});

	test("compile leaves out a layer hidden in the variant", () => {
		const t = front([{ id: "title", properties: {}, hidden: true }]);
		const opts = { width: 100, height: 60 };
		const names = (variantId?: string) =>
			compile(t, {}, { ...opts, variantId }).frames[0].root.children.map(
				(n) => n.id,
			);
		expect(names()).toContain("title");
		expect(names("v")).not.toContain("title");
	});
});

describe("reading variant deltas", () => {
	const blueBg = { ...rect("bg", "#0000ff"), size: { width: 100, height: 60 } };
	const redBg = { ...rect("bg", "#ff0000"), size: { width: 100, height: 60 } };
	const t = withVariant([
		{
			name: "front",
			background: blueBg,
			elements: [
				{ id: "title", properties: { color: "#111111" }, pos: { x: 1, y: 1 } },
				{ id: "wrapper", properties: {}, hidden: true },
			],
		},
		{
			name: "back",
			elements: [{ id: "back_rect", properties: {}, opacity: 0.5 }],
		},
		{
			name: "front",
			background: redBg,
			elements: [
				{ id: "title", properties: { value: "Hey" }, rotation: 10 },
				{ id: "wrapper", properties: {}, hidden: false },
				{ id: "masked", properties: {}, hidden: false },
			],
		},
	]);

	test("merges every override for a side in order", () => {
		expect(mergedElementDelta(t, "v", "front", "title")).toEqual({
			id: "title",
			properties: { color: "#111111", value: "Hey" },
			pos: { x: 1, y: 1 },
			rotation: 10,
		});
		expect(sideBackground(t, "v", "front")).toBe(redBg);
		expect(sideBackground(t, "v", "back")).toBeUndefined();
		expect([...variantDeltas(t, "v").keys()]).toEqual(["front", "back"]);
		expect([...sideDeltas(t, "v", "back").elements.keys()]).toEqual([
			"back_rect",
		]);
	});

	test("a later shell field left undefined keeps the earlier one", () => {
		const u = front([
			{ id: "title", properties: {}, pos: { x: 3, y: 4 } },
			{ id: "title", properties: {}, pos: undefined },
		]);
		expect(mergedElementDelta(u, "v", "front", "title")?.pos).toEqual({
			x: 3,
			y: 4,
		});
	});

	test("any hidden: true hides; a later hidden: false does not show it", () => {
		expect(mergedElementDelta(t, "v", "front", "wrapper")?.hidden).toBe(true);
		expect(hiddenElementIds(t, "v", "front")).toEqual(new Set(["wrapper"]));
		const drawn = frame(applyVariant(t, "v"), "front").elements;
		expect(byId(drawn, "wrapper")).toBeUndefined();
		expect(byId(drawn, "masked")).toBeDefined();
	});

	test("an absent or unknown variant reads as empty", () => {
		expect(hiddenElementIds(t, undefined, "front").size).toBe(0);
		expect(mergedElementDelta(t, "nope", "front", "title")).toBeUndefined();
		expect(variantDeltas(t, "nope").size).toBe(0);
	});

	test("isEmptyDelta", () => {
		expect(isEmptyDelta({ id: "a", properties: {} })).toBe(true);
		expect(isEmptyDelta({ id: "a", properties: { fill: "#fff" } })).toBe(false);
		expect(isEmptyDelta({ id: "a", properties: {}, rotation: 0 })).toBe(false);
		expect(isEmptyDelta({ id: "a", properties: {}, hidden: false })).toBe(
			false,
		);
	});
});

describe("format 1.4", () => {
	const t = front([
		{ id: "title", properties: {}, pos: { x: 3, y: 4 }, hidden: true },
		{ id: "wrapper", properties: { clip: true }, rotation: 10, opacity: 1 },
	]);

	test("a 1.4 delta validates and keeps its shell fields", () => {
		const r = validate(t);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.variants).toEqual(t.variants);
	});

	test("stripped to what 1.3 knows, it still parses", () => {
		const delta13 = z.object({
			id: z.string(),
			properties: z.record(z.string(), z.unknown()),
		});
		for (const d of t.variants![0].overrides[0].elements!) {
			expect(delta13.parse(d)).toEqual({ id: d.id, properties: d.properties });
		}
		const stripped = structuredClone(t);
		stripped.format_version = "1.3";
		stripped.variants![0].overrides[0].elements =
			t.variants![0].overrides[0].elements!.map((d) => delta13.parse(d));
		expect(validate(stripped).ok).toBe(true);
	});

	test("opacity outside 0..1 is rejected", () => {
		const bad = front([{ id: "title", properties: {}, opacity: 1.5 }]);
		const r = validate(bad);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.errors[0].path).toBe(
				"/variants/0/overrides/0/elements/0/opacity",
			);
	});
});

describe("checkVariants", () => {
	test("a clean template has no issues", () => {
		expect(checkVariants(template)).toEqual([]);
		expect(checkVariants(fixtures.fullFeatureCard)).toEqual([]);
	});

	test("reads a delta without properties, or a variant without overrides, as empty", () => {
		const t = {
			...front([{ id: "back_rect" } as never]),
		} as Template;
		expect(() => checkVariants(t)).not.toThrow();
		expect(checkVariants(t).map((i) => i.code)).toContain(
			"variant_empty_override",
		);
		const bare = {
			...template,
			variants: [{ id: "v", label: "V" }],
		} as unknown as Template;
		expect(checkVariants(bare)).toEqual([]);
	});

	test("reports a delta whose id is on no element of its side", () => {
		const t = withVariant([
			{
				name: "back",
				elements: [{ id: "back_rect", properties: {}, opacity: 0.5 }],
			},
			{
				name: "front",
				elements: [
					{ id: "masked_rect", properties: { fill: "#000" } },
					{ id: "back_rect", properties: { fill: "#000" } },
				],
			},
		]);
		expect(checkVariants(t)).toEqual([
			{
				code: "variant_orphan_override",
				variantId: "v",
				side: "front",
				elementId: "back_rect",
				path: ["variants", 0, "overrides", 1, "elements", 1],
				message: expect.any(String),
			},
		]);
		// Orphans still validate and render, skipped.
		expect(validate(t).ok).toBe(true);
	});

	test("reports a delta that changes nothing", () => {
		const t = front([
			{ id: "title", properties: {} },
			{ id: "deep_rect", properties: {}, hidden: false },
		]);
		expect(checkVariants(t)).toEqual([
			{
				code: "variant_empty_override",
				variantId: "v",
				side: "front",
				elementId: "title",
				path: ["variants", 0, "overrides", 0, "elements", 0],
				message: expect.any(String),
			},
		]);
	});

	test("an override naming no side is left to validate", () => {
		const t = withVariant([
			{ name: "missing", elements: [{ id: "x", properties: { a: 1 } }] },
		]);
		expect(checkVariants(t)).toEqual([]);
	});
});

describe("sized variants", () => {
	const pinned: Template = {
		...template,
		template_data: [
			{
				name: "front",
				background: {
					...rect("bg", "#ffffff"),
					size: { width: 100, height: 60 },
				},
				elements: [
					{
						...rect("photo", "#000000"),
						size: { width: 100, height: 60 },
						constraints: { horizontal: "stretch", vertical: "stretch" },
					},
					{
						...rect("mark", "#ffffff"),
						pos: { x: 70, y: 40 },
						constraints: { horizontal: "end", vertical: "end" },
					},
				],
			},
		],
		variants: [
			{
				id: "portrait",
				label: "Portrait",
				size: { width: 60, height: 100 },
				overrides: [
					{
						name: "front",
						elements: [{ id: "mark", properties: {}, pos: { x: 5, y: 85 } }],
					},
				],
			},
			{
				id: "square",
				label: "Square",
				size: { width: 60, height: 60 },
				overrides: [],
			},
		],
	};

	test("variantSize is the variant's own size, else the template's", () => {
		expect(variantSize(pinned, "portrait")).toEqual({ width: 60, height: 100 });
		expect(variantSize(pinned, undefined)).toEqual({ width: 100, height: 60 });
		expect(variantSize(pinned, "nope")).toEqual({ width: 100, height: 60 });
	});

	test("lays the base out at the variant's size before its deltas", () => {
		const out = applyVariant(pinned, "square");
		expect(out.width).toBe(60);
		expect(out.height).toBe(60);
		const els = frame(out, "front").elements;
		expect(byId(els, "photo")?.size).toEqual({ width: 60, height: 60 });
		expect(byId(els, "mark")?.pos).toEqual({ x: 30, y: 40 });
		expect(frame(out, "front").background.size).toEqual({
			width: 60,
			height: 60,
		});

		const moved = applyVariant(pinned, "portrait");
		expect(byId(frame(moved, "front").elements, "mark")?.pos).toEqual({
			x: 5,
			y: 85,
		});
	});

	test("compiles at the variant's aspect", () => {
		const compiled = compile(
			pinned,
			{},
			{ width: 120, height: 200, variantId: "portrait" },
		);
		expect(compiled.width).toBe(120);
		expect(compiled.height).toBe(200);
		expect(() =>
			compile(pinned, {}, { width: 100, height: 60, variantId: "portrait" }),
		).toThrow(/aspect ratio mismatch/);
	});

	test("resizeTemplate keeps a sized variant as it is", () => {
		const out = resizeTemplate(pinned, 200, 120);
		expect(out.variants?.[0]).toBe(pinned.variants?.[0]);
	});

	test("validates the size and needs 1.6", () => {
		expect(validate(pinned).ok).toBe(true);
		expect(minimumFormatVersion(pinned)).toBe("1.6");
		const bad = structuredClone(pinned);
		bad.variants![0]!.size = { width: 0, height: 10.5 };
		const result = validate(bad);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(result.errors.map((e) => e.path)).toEqual([
				"/variants/0/size/width",
				"/variants/0/size/height",
			]);
	});
});

describe("closestVariant", () => {
	const shaped: Template = {
		...template,
		variants: [
			{ id: "gold", label: "Gold", overrides: [] },
			{
				id: "portrait",
				label: "Portrait",
				size: { width: 60, height: 100 },
				overrides: [],
			},
			{
				id: "square",
				label: "Square",
				size: { width: 80, height: 80 },
				overrides: [],
			},
		],
	};

	test("picks the closest aspect, Default on a tie", () => {
		expect(closestVariant(shaped, 1.6)).toBeUndefined();
		expect(closestVariant(shaped, 0.6)).toBe("portrait");
		expect(closestVariant(shaped, 1.1)).toBe("square");
	});

	test("has shaped variants only when a size changes the aspect", () => {
		expect(hasShapedVariants(shaped)).toBe(true);
		expect(
			hasShapedVariants({
				...template,
				variants: [
					{
						id: "big",
						label: "Big",
						size: { width: 200, height: 120 },
						overrides: [],
					},
				],
			}),
		).toBe(false);
		expect(hasShapedVariants(template)).toBe(false);
	});
});

describe("isEmptyVariant", () => {
	const variant = (overrides: Variant["overrides"]): Variant => ({
		id: "v",
		label: "V",
		overrides,
	});

	test("is empty with no overrides, or only empty deltas", () => {
		expect(isEmptyVariant(variant([]))).toBe(true);
		expect(isEmptyVariant(variant([{ name: "front" }]))).toBe(true);
		expect(
			isEmptyVariant(
				variant([
					{ name: "front", elements: [] },
					{ name: "back", elements: [{ id: "name", properties: {} }] },
				]),
			),
		).toBe(true);
	});

	test("is not empty with a background, a property or a shell field", () => {
		expect(
			isEmptyVariant(
				variant([
					{
						name: "front",
						background: {
							id: "bg",
							type: "rect",
							pos: { x: 0, y: 0 },
							size: { width: 1, height: 1 },
							properties: { fill: "#000" },
						},
					},
				]),
			),
		).toBe(false);
		expect(
			isEmptyVariant(
				variant([
					{ name: "front", elements: [{ id: "name", properties: { a: 1 } }] },
				]),
			),
		).toBe(false);
		// format 1.4 deltas: a shell field or hidden alone is a change
		const shell = (extra: Record<string, unknown>) =>
			variant([
				{
					name: "front",
					elements: [{ id: "name", properties: {}, ...extra }],
				},
			] as Variant["overrides"]);
		expect(isEmptyVariant(shell({ pos: { x: 1, y: 2 } }))).toBe(false);
		expect(isEmptyVariant(shell({ hidden: true }))).toBe(false);
		expect(isEmptyVariant(shell({ opacity: undefined }))).toBe(true);
	});
});

describe("variantIdFor", () => {
	test("slugs the label and strips accents", () => {
		expect(variantIdFor("Crème Brûlée!", [])).toBe("creme-brulee");
		expect(variantIdFor("  Dark  Mode ", [])).toBe("dark-mode");
	});

	test("falls back to `variant` when nothing is left", () => {
		expect(variantIdFor("  ", [])).toBe("variant");
		expect(variantIdFor("!!", ["variant"])).toBe("variant-2");
	});

	test("suffixes from -2 past every taken id and the default id", () => {
		expect(DEFAULT_VARIANT_ID).toBe("default");
		expect(variantIdFor("Default", [])).toBe("default-2");
		expect(variantIdFor("Sky", ["sky", "sky-2"])).toBe("sky-3");
	});

	test("does not change `taken`", () => {
		const taken = new Set(["sky"]);
		expect(variantIdFor("Sky", taken)).toBe("sky-2");
		expect([...taken]).toEqual(["sky"]);
	});
});
