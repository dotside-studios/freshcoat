import { describe, expect, test } from "vitest";
import type { Template } from "../src/types";
import {
	compiledPattern,
	PATTERN_CACHE_MAX,
	validate,
	validateValues,
} from "../src/validate";

const minimalValid: Template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "minimal",
	name: "Minimal",
	product: "card_cr80",
	width: 1012,
	height: 638,
	fields: { type: "object", properties: {} },
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 1012, height: 638 },
				properties: { fill: "#fef3c7" },
			},
			elements: [],
		},
	],
};

describe("validate (top-level)", () => {
	test("accepts a minimal valid template", () => {
		const r = validate(minimalValid);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.id).toBe("minimal");
	});

	test("a frame's cornerRadius is one number or four", () => {
		const withFrame = (cornerRadius: unknown) => ({
			...minimalValid,
			format_version: "1.5",
			template_data: [
				{
					...minimalValid.template_data[0],
					elements: [
						{
							id: "f",
							type: "frame",
							properties: { cornerRadius, children: [] },
						},
					],
				},
			],
		});
		expect(validate(withFrame(8)).ok).toBe(true);
		const r = validate(withFrame([8, 0, 8, 0]));
		expect(r.ok).toBe(true);
		if (r.ok)
			expect(
				(r.value.template_data[0].elements[0].properties as {
					cornerRadius: unknown;
				}).cornerRadius,
			).toEqual([8, 0, 8, 0]);
		expect(validate(withFrame([8, 0])).ok).toBe(false);
	});

	test("rejects unknown format_version", () => {
		const r = validate({ ...minimalValid, format_version: "2.0" });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(
				r.errors.some((e) => e.code === "unsupported_format_version"),
			).toBe(true);
		}
	});

	test("rejects non-positive width/height", () => {
		const r = validate({ ...minimalValid, width: 0 });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.path === "/width")).toBe(true);
		}
	});

	test("rejects non-array template_data", () => {
		const r = validate({ ...minimalValid, template_data: {} });
		expect(r.ok).toBe(false);
	});

	test("rejects empty template_data array", () => {
		const r = validate({ ...minimalValid, template_data: [] });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "empty_template_data")).toBe(true);
		}
	});

	test("rejects non-object input", () => {
		const r = validate(null);
		expect(r.ok).toBe(false);
		const r2 = validate("a string");
		expect(r2.ok).toBe(false);
	});

	test("collects multiple errors instead of bailing on first", () => {
		const r = validate({
			...minimalValid,
			format_version: "9.9",
			width: -1,
			height: 0,
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.length).toBeGreaterThanOrEqual(3);
		}
	});
});

describe("validate (frames + elements)", () => {
	test("rejects duplicate frame names", () => {
		const r = validate({
			...minimalValid,
			template_data: [
				minimalValid.template_data[0],
				{ ...minimalValid.template_data[0], name: "front" },
			],
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "duplicate_frame_name")).toBe(
				true,
			);
		}
	});

	test("rejects background.type other than rect or image", () => {
		const bad = structuredClone(minimalValid);
		(bad.template_data[0].background as { type: string }).type = "text";
		const r = validate(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "invalid_background_type")).toBe(
				true,
			);
		}
	});

	test("rejects background with non-frame-fill pos", () => {
		const bad = structuredClone(minimalValid);
		bad.template_data[0].background.pos = { x: 10, y: 0 };
		const r = validate(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(
				r.errors.some((e) => e.code === "background_must_fill_frame"),
			).toBe(true);
		}
	});

	test("accepts background with omitted pos/size (kit fills them)", () => {
		const ok = structuredClone(minimalValid) as unknown as Record<
			string,
			unknown
		>;
		const frame = (ok.template_data as Array<Record<string, unknown>>)[0];
		const bg = frame.background as Record<string, unknown>;
		delete bg.pos;
		delete bg.size;
		const r = validate(ok);
		expect(r.ok).toBe(true);
	});

	test("rejects duplicate element ids within a frame", () => {
		const bad = structuredClone(minimalValid);
		bad.template_data[0].elements = [
			{
				id: "x",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				properties: { fill: "#000" },
			},
			{
				id: "x",
				type: "rect",
				pos: { x: 20, y: 20 },
				size: { width: 10, height: 10 },
				properties: { fill: "#000" },
			},
		];
		const r = validate(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "duplicate_element_id")).toBe(
				true,
			);
		}
	});

	test("rejects unknown element type", () => {
		const bad = structuredClone(minimalValid);
		bad.template_data[0].elements = [
			{
				id: "x",
				type: "unknown" as never,
				pos: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				properties: {},
			} as never,
		];
		const r = validate(bad);
		expect(r.ok).toBe(false);
	});

	test("rejects gradient fill with fewer than 2 stops", () => {
		const bad = structuredClone(minimalValid);
		bad.template_data[0].background = {
			...bad.template_data[0].background,
			type: "rect",
			properties: {
				fill: {
					kind: "linear",
					angle: 0,
					stops: [{ offset: 0, color: "#000" }],
				},
			},
		} as never;
		const r = validate(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "gradient_needs_two_stops")).toBe(
				true,
			);
		}
	});
});

describe("validate (gradient stops)", () => {
	const oneStop = {
		kind: "linear",
		angle: 0,
		stops: [{ offset: 0, color: "#000" }],
	};
	const badOffset = {
		kind: "radial",
		stops: [
			{ offset: 0, color: "#000" },
			{ offset: 1.5, color: "#fff" },
		],
	};
	const goodStops = [
		{ offset: 0, color: "#000" },
		{ offset: 1, color: "#fff" },
	];
	const box = { pos: { x: 0, y: 0 }, size: { width: 10, height: 10 } };
	const rect = (fill: unknown) => ({
		id: "r",
		type: "rect",
		...box,
		properties: { fill },
	});

	function withElements(elements: unknown[], variants?: unknown) {
		const tpl = structuredClone(minimalValid) as Record<string, unknown> & {
			template_data: { elements: unknown[] }[];
		};
		tpl.template_data[0].elements = elements;
		if (variants) tpl.variants = variants;
		return tpl;
	}

	function issues(tpl: unknown) {
		const r = validate(tpl);
		return r.ok ? [] : r.errors.map((e) => `${e.code} ${e.path}`);
	}

	test("vector fill", () => {
		const tpl = withElements([
			{
				id: "v",
				type: "vector",
				...box,
				properties: { d: "M0 0L10 10", fill: oneStop },
			},
		]);
		expect(issues(tpl)).toEqual([
			"gradient_needs_two_stops /template_data/0/elements/0/properties/fill/stops",
		]);
	});

	test("frame fill and nested frame children", () => {
		const tpl = withElements([
			{
				id: "f",
				type: "frame",
				...box,
				properties: {
					fill: oneStop,
					children: [
						{
							id: "g",
							type: "frame",
							...box,
							properties: { children: [rect(badOffset)] },
						},
					],
				},
			},
		]);
		expect(issues(tpl)).toEqual([
			"gradient_needs_two_stops /template_data/0/elements/0/properties/fill/stops",
			"invalid_stop_offset /template_data/0/elements/0/properties/children/0/properties/children/0/properties/fill/stops/1/offset",
		]);
	});

	test("text fill", () => {
		const tpl = withElements([
			{
				id: "t",
				type: "text",
				...box,
				properties: {
					value: "Hi",
					font: { family: "Inter", size: 12 },
					fill: oneStop,
				},
			},
		]);
		expect(issues(tpl)).toEqual([
			"gradient_needs_two_stops /template_data/0/elements/0/properties/fill/stops",
		]);
	});

	test("mask shape and children", () => {
		const tpl = withElements([
			{
				id: "m",
				type: "mask",
				...box,
				properties: { mask: rect(oneStop), children: [rect(badOffset)] },
			},
		]);
		expect(issues(tpl)).toEqual([
			"gradient_needs_two_stops /template_data/0/elements/0/properties/mask/properties/fill/stops",
			"invalid_stop_offset /template_data/0/elements/0/properties/children/0/properties/fill/stops/1/offset",
		]);
	});

	test("variant background and element overrides", () => {
		const tpl = withElements(
			[rect("#000")],
			[
				{
					id: "a",
					label: "A",
					overrides: [
						{
							name: "front",
							background: {
								id: "bg",
								type: "rect",
								...box,
								properties: { fill: oneStop },
							},
							elements: [{ id: "r", properties: { fill: badOffset } }],
						},
					],
				},
			],
		);
		expect(issues(tpl)).toEqual([
			"gradient_needs_two_stops /variants/0/overrides/0/background/properties/fill/stops",
			"invalid_stop_offset /variants/0/overrides/0/elements/0/properties/fill/stops/1/offset",
		]);
	});

	test("multi-fill arrays", () => {
		const tpl = withElements([rect(["#000", oneStop])]);
		expect(issues(tpl)).toEqual([
			"gradient_needs_two_stops /template_data/0/elements/0/properties/fill/1/stops",
		]);
	});

	test("accepts well-formed gradients in every location", () => {
		const linear = { kind: "linear", angle: 0, stops: goodStops };
		const angular = { kind: "angular", stops: goodStops };
		const tpl = withElements(
			[
				{
					id: "f",
					type: "frame",
					...box,
					properties: {
						fill: [linear, angular],
						children: [
							{
								id: "v",
								type: "vector",
								...box,
								properties: { d: "M0 0L10 10", fill: linear },
							},
							{
								id: "m",
								type: "mask",
								...box,
								properties: { mask: rect(angular), children: [rect(linear)] },
							},
						],
					},
				},
				{
					id: "t",
					type: "text",
					...box,
					properties: {
						value: "Hi",
						font: { family: "Inter", size: 12 },
						fill: linear,
					},
				},
			],
			[
				{
					id: "a",
					label: "A",
					overrides: [
						{
							name: "front",
							elements: [{ id: "t", properties: { fill: angular } }],
						},
					],
				},
			],
		);
		expect(issues(tpl)).toEqual([]);
	});
});

describe("validate (variants)", () => {
	test("rejects duplicate variant ids", () => {
		const bad = {
			...minimalValid,
			variants: [
				{ id: "a", label: "A", overrides: [] },
				{ id: "a", label: "A2", overrides: [] },
			],
		};
		const r = validate(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "duplicate_variant_id")).toBe(
				true,
			);
		}
	});

	test("rejects variant override referencing unknown frame", () => {
		const bad = {
			...minimalValid,
			variants: [
				{
					id: "a",
					label: "A",
					overrides: [
						{
							name: "notARealFrame",
							background: minimalValid.template_data[0].background,
						},
					],
				},
			],
		};
		const r = validate(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "unknown_frame_name")).toBe(true);
		}
	});
});

describe("validate (mustache references)", () => {
	test("rejects {{id}} in template_data that doesn't exist in fields", () => {
		const bad = structuredClone(minimalValid);
		bad.template_data[0].elements = [
			{
				id: "txt",
				type: "text",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 30 },
				properties: {
					value: "Hi {{nope}} {{ also }}",
					font: { family: "Comfortaa", size: 16 },
					color: "#000",
				},
			},
		];
		for (let i = 0; i < 2; i++) {
			const r = validate(bad);
			expect(r.ok).toBe(false);
			if (!r.ok) {
				expect(
					r.errors
						.filter((e) => e.code === "unknown_field_reference")
						.map((e) => [e.path, e.message]),
				).toEqual([
					[
						"/template_data/0/elements/0/properties/value",
						"mustache reference {{nope}} has no matching field",
					],
					[
						"/template_data/0/elements/0/properties/value",
						"mustache reference {{also}} has no matching field",
					],
				]);
			}
		}
	});

	test("rejects an unknown {{id}} in a variant delta or background", () => {
		const bad = structuredClone(minimalValid);
		bad.format_version = "1.4";
		bad.template_data[0].elements = [
			{
				id: "txt",
				type: "text",
				properties: {
					value: "Hi",
					font: { family: "Comfortaa", size: 16 },
				},
			},
		];
		bad.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						background: {
							id: "bg",
							type: "image",
							properties: { src: "{{photo}}", fit: "cover" },
						},
						elements: [{ id: "txt", properties: { value: "Hi {{nope}}" } }],
					},
				],
			},
		];
		const r = validate(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(
				r.errors
					.filter((e) => e.code === "unknown_field_reference")
					.map((e) => e.path),
			).toEqual([
				"/variants/0/overrides/0/background/properties/src",
				"/variants/0/overrides/0/elements/0/properties/value",
			]);
		}
		bad.fields.properties = {
			photo: { type: "string" },
			nope: { type: "string" },
		};
		expect(validate(bad).ok).toBe(true);
	});

	test("accepts known {{id}} references", () => {
		const ok = structuredClone(minimalValid);
		ok.fields = {
			type: "object",
			properties: { name: { type: "string", title: "Name" } },
		};
		ok.template_data[0].elements = [
			{
				id: "txt",
				type: "text",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 30 },
				properties: {
					value: "Hi {{name}}",
					font: { family: "Comfortaa", size: 16 },
					color: "#000",
				},
			},
		];
		expect(validate(ok).ok).toBe(true);
	});
});

describe("validateValues", () => {
	const fields = {
		type: "object" as const,
		properties: {
			name: { type: "string" as const, maxLength: 32 },
			bio: { type: "string" as const },
		},
		required: ["name"],
	};

	test("accepts values matching the schema", () => {
		const r = validateValues({ name: "Alex", bio: "..." }, fields);
		expect(r.ok).toBe(true);
	});

	test("flags missing required field", () => {
		const r = validateValues({ bio: "..." }, fields);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "missing_required_value")).toBe(
				true,
			);
		}
	});

	test("flags maxLength violation", () => {
		const r = validateValues({ name: "x".repeat(50) }, fields);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => e.code === "value_too_long")).toBe(true);
		}
	});

	test("matches patterns on every call and skips invalid ones", () => {
		const patterned = {
			type: "object" as const,
			properties: {
				code: { type: "string" as const, pattern: "^[A-Z]+$" },
				broken: { type: "string" as const, pattern: "([" },
			},
		};
		for (let i = 0; i < 2; i++) {
			expect(validateValues({ code: "AB", broken: "x" }, patterned).ok).toBe(
				true,
			);
			const r = validateValues({ code: "ab", broken: "x" }, patterned);
			expect(r.ok ? [] : r.errors.map((e) => [e.path, e.code])).toEqual([
				["/code", "value_pattern_mismatch"],
			]);
		}
	});

	test("flags non-string values", () => {
		const r = validateValues({ name: 42 }, fields);
		expect(r.ok).toBe(false);
	});
});

test("FontWeight 800 is accepted by validate", () => {
	const tpl = {
		format_version: "1.0",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "card_cr80",
		width: 100,
		height: 60,
		fields: { type: "object", properties: { displayName: { type: "string" } } },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 100, height: 60 },
					properties: { fill: "#fff" },
				},
				elements: [
					{
						id: "title",
						type: "text",
						pos: { x: 0, y: 0 },
						size: { width: 100, height: 30 },
						properties: {
							value: "x",
							font: { family: "Inter", size: 16, weight: 800 },
							color: "#000",
						},
					},
				],
			},
		],
	};
	const result = validate(tpl);
	expect(result.ok).toBe(true);
});

describe("font weights and variation axes", () => {
	function withFont(font: Record<string, unknown>): Template {
		const tpl = structuredClone(minimalValid) as Template;
		tpl.template_data[0].elements = [
			{
				id: "title",
				type: "text",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 30 },
				properties: {
					value: "x",
					font: { family: "Inter", size: 16, ...font },
					spans: [
						{ text: "x", font: { weight: 900, variations: { wdth: 80 } } },
					],
				},
			} as never,
		];
		return tpl;
	}

	test("accepts Thin through Black", () => {
		for (const weight of [100, 200, 300, 900])
			expect(validate(withFont({ weight })).ok).toBe(true);
	});

	test("rejects a weight between steps", () => {
		expect(validate(withFont({ weight: 350 })).ok).toBe(false);
	});

	test("accepts four-character axis tags", () => {
		expect(
			validate(withFont({ variations: { wght: 350, opsz: 14, GRAD: -50 } })).ok,
		).toBe(true);
	});

	test("rejects a tag that is not four characters", () => {
		expect(validate(withFont({ variations: { weight: 350 } })).ok).toBe(false);
	});
});

test("accepts a frame with a layout block and children carrying layoutChild", () => {
	const tpl: Template = {
		...minimalValid,
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 1012, height: 638 },
					properties: { fill: "#fff" },
				},
				elements: [
					{
						id: "stack",
						type: "frame",
						pos: { x: 0, y: 0 },
						size: { width: 100, height: 50 },
						properties: {
							layout: { direction: "column", gap: 4 },
							children: [
								{
									id: "name",
									type: "text",
									pos: { x: 0, y: 0 },
									size: { width: 100, height: 20 },
									layoutChild: { width: "fill", height: "hug" },
									properties: {
										value: "x",
										font: { family: "Inter", size: 12 },
										color: "#000",
									},
								},
							],
						},
					},
				],
			},
		],
	};
	const res = validate(tpl);
	expect(res.ok).toBe(true);
});

test("accepts a frame nested inside another frame's children", () => {
	const tpl: Template = {
		...minimalValid,
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 1012, height: 638 },
					properties: { fill: "#fff" },
				},
				elements: [
					{
						id: "outer",
						type: "frame",
						pos: { x: 0, y: 0 },
						size: { width: 100, height: 100 },
						properties: {
							layout: { direction: "column" },
							children: [
								{
									id: "inner",
									type: "frame",
									pos: { x: 0, y: 0 },
									size: { width: 100, height: 50 },
									properties: { layout: { direction: "row" }, children: [] },
								},
							],
						},
					},
				],
			},
		],
	};
	expect(validate(tpl).ok).toBe(true);
});

test("the compiled pattern cache evicts the least recently used past its cap", () => {
	const first = compiledPattern("^a");
	expect(compiledPattern("^a")).toBe(first);
	const kept = compiledPattern("^kept");
	for (let i = 0; i < PATTERN_CACHE_MAX - 1; i++) {
		compiledPattern(`^p${i}`);
		if (i === 0) compiledPattern("^kept");
	}
	expect(compiledPattern("^kept")).toBe(kept);
	expect(compiledPattern("^a")).not.toBe(first);
});
