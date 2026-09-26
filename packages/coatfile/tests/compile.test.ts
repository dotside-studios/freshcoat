import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import type {
	Command,
	CompileOptions,
	DrawCommand,
	DrawRectCommand,
	FrameElement,
	Node,
	RectElement,
	Template,
	TextElement,
	TextNode,
} from "../src/types";
import { compileToCommands } from "./helpers/compile-commands";

// ─────────────── Command-IR helpers ───────────────
//
// compile() now emits a freshcoat GroupNode tree; the stable, asserted-against
// surface is the flat Command IR compileToCanvasCommands lowers it to. These
// helpers pull draw commands out of that IR — including draws nested inside a
// drawGroup (frame elements + QR lower to nested groups).

function getCommands(
	template: Template,
	values: Record<string, unknown>,
	opts: CompileOptions,
): Command[] {
	return compileToCommands(template, values, opts)[0]!.commands;
}

function isDraw(c: Command): c is DrawCommand {
	return "op" in c && c.op.startsWith("draw");
}

// Every top-level draw command (frame background + top-level elements), in order.
function topDraws(commands: Command[]): DrawCommand[] {
	return commands.filter(isDraw);
}

// All draw commands of a given op, descending into drawGroup.children.
function findDraws<T extends DrawCommand["op"]>(
	commands: Command[],
	op: T,
): Extract<DrawCommand, { op: T }>[] {
	const out: Extract<DrawCommand, { op: T }>[] = [];
	for (const c of commands) {
		if (!isDraw(c)) continue;
		if (c.op === op) out.push(c as Extract<DrawCommand, { op: T }>);
		if (c.op === "drawGroup") out.push(...findDraws(c.children, op));
	}
	return out;
}

function findDraw<T extends DrawCommand["op"]>(
	commands: Command[],
	op: T,
): Extract<DrawCommand, { op: T }> | undefined {
	return findDraws(commands, op)[0];
}

const baseTemplate: Template = {
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
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 60 },
				properties: { fill: "#fef3c7" },
			},
			elements: [
				{
					id: "title",
					type: "text",
					pos: { x: 10, y: 20 },
					size: { width: 80, height: 30 },
					properties: {
						value: "Hi {{displayName}}",
						font: { family: "Comfortaa", size: 16 },
						color: "#1a1a1a",
					},
				},
			],
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
						id: "bg",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: 100, height: 60 },
						properties: { fill: "#3b82f6" },
					},
				},
			],
		},
	],
};

describe("compile (CompiledTemplate)", () => {
	test("emits one CompiledFrame per template_data entry, in order", () => {
		const out = compile(
			baseTemplate,
			{ displayName: "Alex" },
			{
				width: 100,
				height: 60,
			},
		);
		expect(out.frames.length).toBe(1);
		expect(out.frames[0]!.name).toBe("front");
	});

	test("compiled output carries target width/height", () => {
		const out = compile(baseTemplate, {}, { width: 200, height: 120 });
		expect(out.width).toBe(200);
		expect(out.height).toBe(120);
	});

	test("first draw is the background rect, full-bleed at target dims", () => {
		const cmds = getCommands(baseTemplate, {}, { width: 100, height: 60 });
		const bg = topDraws(cmds)[0]!;
		expect(bg.op).toBe("drawRect");
		expect(bg.pos).toEqual({ x: 0, y: 0 });
		expect(bg.size).toEqual({ width: 100, height: 60 });
		if (bg.op === "drawRect") {
			expect(bg.fills).toEqual([{ kind: "solid", color: "#fef3c7" }]);
		}
	});

	test("scales pos/size + font.size by target.width / template.width", () => {
		const cmds = getCommands(baseTemplate, {}, { width: 200, height: 120 });
		const text = topDraws(cmds)[1]!;
		expect(text.op).toBe("drawText");
		expect(text.pos).toEqual({ x: 20, y: 40 });
		expect(text.size).toEqual({ width: 160, height: 60 });
		if (text.op === "drawText") {
			expect(text.layout.font.size).toBe(32);
		}
	});

	test("substitutes mustache with given values + defaults", () => {
		const cmds = getCommands(
			baseTemplate,
			{ displayName: "Alex" },
			{
				width: 100,
				height: 60,
			},
		);
		const text = findDraw(cmds, "drawText")!;
		expect(text.layout.lines.map((l) => l.text)).toEqual(["Hi Alex"]);
	});

	test("falls back to schema default when value missing", () => {
		const cmds = getCommands(baseTemplate, {}, { width: 100, height: 60 });
		const text = findDraw(cmds, "drawText")!;
		expect(text.layout.lines.map((l) => l.text)).toEqual(["Hi Hello"]);
	});

	test("applies Figma case to the substituted text (upper + title)", () => {
		const withCase = (mode: string, value: string) => {
			const tpl = structuredClone(baseTemplate) as typeof baseTemplate;
			const el = tpl.template_data[0]!.elements.find((e) => e.type === "text")!;
			(el.properties as Record<string, unknown>).case = mode;
			const cmds = getCommands(
				tpl,
				{ displayName: value },
				{ width: 300, height: 180 },
			);
			return findDraw(cmds, "drawText")!
				.layout.lines.map((l) => l.text)
				.join(" ");
		};
		expect(withCase("upper", "alex")).toBe("HI ALEX");
		expect(withCase("title", "abc def")).toBe("Hi Abc Def");
	});

	test("variant override replaces background fill", () => {
		const cmds = getCommands(
			baseTemplate,
			{},
			{
				width: 100,
				height: 60,
				variantId: "blue",
			},
		);
		const bg = topDraws(cmds)[0]!;
		if (bg.op === "drawRect") {
			expect(bg.fills).toEqual([{ kind: "solid", color: "#3b82f6" }]);
		}
	});

	test("variant override merges a foreground element property (text color)", () => {
		const tpl = structuredClone(baseTemplate);
		const title = tpl.template_data[0]!.elements[0] as TextElement;
		title.id = "name_text";
		title.properties.color = "#fafafa";
		tpl.variants = [
			{
				id: "ink",
				label: "Ink",
				overrides: [
					{
						name: "front",
						elements: [{ id: "name_text", properties: { color: "#0d0d0d" } }],
					},
				],
			},
		];
		const cmds = getCommands(
			tpl,
			{},
			{ width: 100, height: 60, variantId: "ink" },
		);
		const text = findDraw(cmds, "drawText")!;
		expect(text.color).toBe("#0d0d0d");
	});

	test("variant override reaches a nested element (inside a frame's children)", () => {
		const tpl = structuredClone(baseTemplate);
		const nestedText: TextElement = {
			id: "nested_text",
			type: "text",
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 20 },
			properties: {
				value: "Nested",
				font: { family: "Comfortaa", size: 12 },
				color: "#111111",
			},
		};
		const wrapperFrame: FrameElement = {
			id: "wrapper",
			type: "frame",
			pos: { x: 5, y: 5 },
			size: { width: 50, height: 30 },
			properties: { children: [nestedText] },
		};
		tpl.template_data[0]!.elements.push(wrapperFrame);
		tpl.variants = [
			{
				id: "ink",
				label: "Ink",
				overrides: [
					{
						name: "front",
						elements: [{ id: "nested_text", properties: { color: "#222222" } }],
					},
				],
			},
		];
		const cmds = getCommands(
			tpl,
			{},
			{ width: 100, height: 60, variantId: "ink" },
		);
		// The nested text lives inside the wrapper frame's drawGroup; findDraws
		// descends into it. The override reached it → its color changed.
		const nested = findDraws(cmds, "drawText").find(
			(t) => t.layout.lines[0]?.text === "Nested",
		)!;
		expect(nested.color).toBe("#222222");
	});

	test("variant override with only elements (no background) leaves background unchanged", () => {
		const tpl = structuredClone(baseTemplate);
		const title = tpl.template_data[0]!.elements[0] as TextElement;
		title.id = "name_text";
		title.properties.color = "#fafafa";
		tpl.variants = [
			{
				id: "ink",
				label: "Ink",
				overrides: [
					{
						name: "front",
						elements: [{ id: "name_text", properties: { color: "#0d0d0d" } }],
					},
				],
			},
		];
		const cmds = getCommands(
			tpl,
			{},
			{ width: 100, height: 60, variantId: "ink" },
		);
		const bg = topDraws(cmds)[0]!;
		if (bg.op === "drawRect") {
			expect(bg.fills).toEqual([{ kind: "solid", color: "#fef3c7" }]);
		}
		const text = findDraw(cmds, "drawText")!;
		expect(text.color).toBe("#0d0d0d");
	});

	test("rejects unknown variantId", () => {
		expect(() =>
			compile(baseTemplate, {}, { width: 100, height: 60, variantId: "ghost" }),
		).toThrow(/unknown_variant/);
	});

	test("rejects aspect-ratio mismatch", () => {
		expect(() =>
			compile(baseTemplate, {}, { width: 100, height: 100 }),
		).toThrow(/aspect/);
	});

	test("background pos/size omitted in author input is normalized to frame-fill", () => {
		const tpl = structuredClone(baseTemplate);
		delete (tpl.template_data[0].background as { pos?: unknown }).pos;
		delete (tpl.template_data[0].background as { size?: unknown }).size;
		const cmds = getCommands(tpl, {}, { width: 100, height: 60 });
		const bg = topDraws(cmds)[0]!;
		expect(bg.pos).toEqual({ x: 0, y: 0 });
		expect(bg.size).toEqual({ width: 100, height: 60 });
	});

	test("text alignment is baked into per-line x", () => {
		const tpl = structuredClone(baseTemplate);
		(tpl.template_data[0].elements[0] as TextElement).properties.align =
			"center";
		const cmds = getCommands(
			tpl,
			{ displayName: "X" },
			{ width: 100, height: 60 },
		);
		const text = findDraw(cmds, "drawText")!;
		const run = text.layout.lines[0]!.spans[0]!;
		expect(run.x).toBeCloseTo(10 + (80 - run.width) / 2, 5);
	});

	test("verticalAlign is baked into per-line y", () => {
		const tpl = structuredClone(baseTemplate);
		const el = tpl.template_data[0]!.elements[0] as TextElement;
		el.properties.verticalAlign = "bottom";
		el.properties.leadingTrim = false; // line-box valign path
		const cmds = getCommands(
			tpl,
			{ displayName: "X" },
			{ width: 100, height: 60 },
		);
		const text = findDraw(cmds, "drawText")!;
		const line = text.layout.lines[0]!;
		// bottom align: startY = boxY + boxH − contentHeight; contentHeight is
		// the pixel-rounded line advance (font 16 × default lineHeight 1.2).
		const advance = Math.round(16 * 1.2);
		expect(line.y).toBeCloseTo(20 + (30 - advance), 5);
	});

	test("bottom-aligned clipped text that overflows pins to the top of the box", () => {
		const tpl: Template = {
			format_version: "1.0",
			version: "1.0.0",
			id: "t",
			name: "t",
			product: "card",
			width: 300,
			height: 200,
			fields: { type: "object", properties: {} },
			template_data: [
				{
					name: "front",
					background: {
						id: "bg",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: 300, height: 200 },
						properties: { fill: "#fff" },
					},
					elements: [
						{
							id: "name",
							type: "text",
							pos: { x: 0, y: 100 },
							size: { width: 60, height: 30 },
							properties: {
								value: "a\nb\nc\nd",
								font: { family: "Inter", size: 20, lineHeight: 1.2 },
								color: "#000",
								verticalAlign: "bottom",
								fit: "clip",
							},
						},
					],
				},
			],
		};
		const cmds = getCommands(tpl, {}, { width: 300, height: 200 });
		const text = findDraw(cmds, "drawText")!;
		// The content overflows the box height (30), so bottom-align would push the
		// start above the box top; the first line must instead pin to the box top
		// (y=100) so the START of the text stays visible.
		expect(text.layout.lines[0]!.y).toBe(100);
	});

	test("linear gradient resolves to bbox-normalized from/to", () => {
		const tpl = structuredClone(baseTemplate);
		(tpl.template_data[0].background as RectElement).properties.fill = {
			kind: "linear",
			angle: 0,
			stops: [
				{ offset: 0, color: "#000" },
				{ offset: 1, color: "#fff" },
			],
		};
		const cmds = getCommands(tpl, {}, { width: 100, height: 60 });
		const bg = topDraws(cmds)[0]!;
		const f = bg.op === "drawRect" ? bg.fills?.[0] : undefined;
		if (f?.kind === "linear") {
			expect(f.from).toEqual({ x: 0, y: 0.5 });
			expect(f.to).toEqual({ x: 1, y: 0.5 });
		}
	});

	function radialFill(fill: Record<string, unknown>) {
		const tpl = structuredClone(baseTemplate);
		(tpl.template_data[0].background as RectElement).properties.fill = {
			kind: "radial",
			stops: [
				{ offset: 0, color: "#fff" },
				{ offset: 1, color: "#0000" },
			],
			...fill,
		} as never;
		const cmds = getCommands(tpl, {}, { width: 100, height: 60 });
		const bg = topDraws(cmds)[0]!;
		return bg.op === "drawRect" ? bg.fills?.[0] : undefined;
	}

	test("radial gradient without a radius still reaches the shape's edge", () => {
		// Every template written before `radius` existed assumed this, so the
		// default has to stay 0.5.
		const f = radialFill({});
		expect(f?.kind).toBe("radial");
		if (f?.kind === "radial") expect(f.radius).toBe(0.5);
	});

	test("radial gradient defaults to a circle", () => {
		// radiusY mirrors radius and rotation is 0, so the painter can take the
		// simple path and every pre-existing template renders unchanged.
		const f = radialFill({});
		if (f?.kind === "radial") {
			expect(f.radiusY).toBe(f.radius);
			expect(f.rotation).toBe(0);
		}
	});

	test("radial gradient carries an elliptical reach and its angle", () => {
		// A glow that spreads much further along one axis than the other — a
		// circle in its place washes sideways across the whole design.
		const f = radialFill({ radius: 2.5, radiusY: 0.2, rotation: 90 });
		if (f?.kind === "radial") {
			expect(f.radius).toBe(2.5);
			expect(f.radiusY).toBe(0.2);
			expect(f.rotation).toBe(90);
		}
	});

	test("radial gradient carries a declared radius through to the painter", () => {
		// A glow that keeps fading well past its shape renders as a hard-edged
		// disc when its reach is pinned to the shape's own half-size.
		const f = radialFill({ center: [0.5, 0.5], radius: 1.4 });
		expect(f?.kind).toBe("radial");
		if (f?.kind === "radial") {
			expect(f.radius).toBe(1.4);
			expect(f.center).toEqual({ x: 0.5, y: 0.5 });
		}
	});
});

describe("compile (frame → group)", () => {
	function withFrame(properties: unknown): Template {
		const tpl = structuredClone(baseTemplate);
		tpl.template_data[0].elements = [
			{
				id: "frame1",
				type: "frame",
				pos: { x: 20, y: 10 },
				size: { width: 60, height: 40 },
				properties: properties as never,
			} as never,
		];
		return tpl;
	}

	test("frame lowers to a drawGroup", () => {
		const cmds = getCommands(
			withFrame({ children: [] }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(cmds, "drawGroup")).toBeDefined();
	});

	test("fill produces a synthetic rect as the first child", () => {
		const cmds = getCommands(
			withFrame({ fill: "#000", children: [] }),
			{},
			{ width: 100, height: 60 },
		);
		const group = findDraw(cmds, "drawGroup")!;
		expect(group.children).toHaveLength(1);
		const bg = group.children[0]!;
		expect(bg.op).toBe("drawRect");
		expect(bg.pos).toEqual({ x: 20, y: 10 });
		expect(bg.size).toEqual({ width: 60, height: 40 });
	});

	test("no fill + no stroke = no synthetic bg child", () => {
		const cmds = getCommands(
			withFrame({
				children: [
					{
						id: "c",
						type: "rect",
						pos: { x: 5, y: 5 },
						size: { width: 10, height: 10 },
						properties: { fill: "#f00" },
					},
				],
			}),
			{},
			{ width: 100, height: 60 },
		);
		const group = findDraw(cmds, "drawGroup")!;
		expect(group.children).toHaveLength(1);
		expect(group.children[0]!.op).toBe("drawRect");
	});

	test("frame-local child pos is offset by frame.pos in absolute coords", () => {
		const cmds = getCommands(
			withFrame({
				children: [
					{
						id: "c",
						type: "rect",
						pos: { x: 5, y: 7 },
						size: { width: 10, height: 10 },
						properties: { fill: "#f00" },
					},
				],
			}),
			{},
			{ width: 100, height: 60 },
		);
		const group = findDraw(cmds, "drawGroup")!;
		const child = group.children[0]!;
		// frame at (20, 10), child local (5, 7) → absolute (25, 17)
		expect(child.pos).toEqual({ x: 25, y: 17 });
	});

	test("clipsContent: true → group.clip = rect (or rounded-rect with cornerRadius)", () => {
		const flat = getCommands(
			withFrame({ clipsContent: true, children: [] }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(flat, "drawGroup")!.clip).toEqual({ kind: "rect" });

		const rounded = getCommands(
			withFrame({ clipsContent: true, cornerRadius: 4, children: [] }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(rounded, "drawGroup")!.clip).toEqual({
			kind: "rounded-rect",
			radius: 4,
		});
	});

	test("clipsContent: false (or absent) → no clip", () => {
		const cmds = getCommands(
			withFrame({ children: [] }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(cmds, "drawGroup")!.clip).toBeUndefined();
	});

	test("text inside a frame contributes its font family to assets.fonts", () => {
		const out = compile(
			withFrame({
				children: [
					{
						id: "t",
						type: "text",
						pos: { x: 0, y: 0 },
						size: { width: 60, height: 20 },
						properties: {
							value: "hi",
							font: { family: "InsideFrame", size: 12 },
							color: "#000",
						},
					},
				],
			}),
			{},
			{ width: 100, height: 60 },
		);
		const families = out.frames[0]!.assets.fonts.map((r) => r.family);
		expect(families).toContain("InsideFrame");
	});

	test("scales children pos + size by ratio", () => {
		const cmds = getCommands(
			withFrame({
				children: [
					{
						id: "c",
						type: "rect",
						pos: { x: 5, y: 5 },
						size: { width: 10, height: 10 },
						properties: { fill: "#f00" },
					},
				],
			}),
			{},
			{ width: 200, height: 120 },
		);
		const group = findDraw(cmds, "drawGroup")!;
		const child = group.children[0]!;
		// frame.pos × 2 = (40, 20), child local (5, 5) × 2 = (10, 10),
		// absolute = (50, 30)
		expect(child.pos).toEqual({ x: 50, y: 30 });
		expect(child.size).toEqual({ width: 20, height: 20 });
	});
});

describe("compile (image masks → draw command clip)", () => {
	function withImage(props: Record<string, unknown>): Template {
		return {
			...baseTemplate,
			template_data: [
				{
					...baseTemplate.template_data[0]!,
					elements: [
						{
							id: "avatar",
							type: "image",
							pos: { x: 10, y: 10 },
							size: { width: 40, height: 40 },
							properties: {
								src: "https://x/a.png",
								fit: "cover",
								...props,
							},
						},
					],
				},
			],
		};
	}

	test("cornerRadius lowers to rounded-rect clip and scales with ratio", () => {
		const cmds = getCommands(
			withImage({ cornerRadius: 8 }),
			{},
			{ width: 200, height: 120 },
		);
		expect(findDraw(cmds, "drawImage")!.clip).toEqual({
			kind: "rounded-rect",
			radius: 16,
		});
	});

	test("mask:'circle' lowers to circle clip", () => {
		const cmds = getCommands(
			withImage({ mask: "circle" }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(cmds, "drawImage")!.clip).toEqual({ kind: "circle" });
	});

	test("mask:'ellipse' lowers to ellipse clip", () => {
		const cmds = getCommands(
			withImage({ mask: "ellipse" }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(cmds, "drawImage")!.clip).toEqual({ kind: "ellipse" });
	});

	test("mask:rounded-rect lowers and scales with ratio", () => {
		const cmds = getCommands(
			withImage({ mask: { kind: "rounded-rect", radius: 6 } }),
			{},
			{ width: 200, height: 120 },
		);
		expect(findDraw(cmds, "drawImage")!.clip).toEqual({
			kind: "rounded-rect",
			radius: 12,
		});
	});

	test("mask wins over cornerRadius when both are set, with a console.warn", () => {
		const original = console.warn;
		const calls: unknown[][] = [];
		console.warn = (...a) => calls.push(a);
		try {
			const cmds = getCommands(
				withImage({ cornerRadius: 8, mask: "circle" }),
				{},
				{ width: 100, height: 60 },
			);
			expect(findDraw(cmds, "drawImage")!.clip).toEqual({ kind: "circle" });
			expect(calls.length).toBeGreaterThan(0);
		} finally {
			console.warn = original;
		}
	});

	const clipOutset = (
		mutate: (props: TextElement["properties"]) => void,
	): { top: number; bottom: number } | undefined => {
		const tpl = structuredClone(baseTemplate);
		const props = (tpl.template_data[0].elements[0] as TextElement).properties;
		props.fit = "clip";
		mutate(props);
		const clip = findDraw(
			getCommands(tpl, {}, { width: 100, height: 60 }),
			"drawText",
		)!.clip;
		expect(clip?.kind).toBe("rect");
		return (clip as { outset?: { top: number; bottom: number } }).outset;
	};

	test("text fit:'clip' outsets for the overshoot cap-height trim leaves", () => {
		// Trimmed, the cap line tucks against the box top: the ascent rises above
		// it and descenders drop below the last baseline, so both edges outset.
		const outset = clipOutset((props) => {
			props.leadingTrim = true;
		});
		expect(outset?.top).toBeGreaterThan(0);
		expect(outset?.bottom).toBeGreaterThan(0);
	});

	test("text fit:'clip' outsets only where the line box is too tight", () => {
		// Standard trim centres the glyphs in the line box, so a roomy line height
		// spills nothing …
		expect(clipOutset(() => {})).toEqual({ top: 0, bottom: 0 });
		// … and one tighter than ascent + descent spills equally at both edges.
		const tight = clipOutset((props) => {
			props.font = { ...props.font, lineHeight: 0.5 };
		});
		expect(tight?.top).toBeGreaterThan(0);
		expect(tight?.bottom).toBe(tight?.top);
	});

	test("leadingTrim is off unless the template asks for it", () => {
		// Figma's "Vertical trim" defaults to STANDARD — the first baseline sits at
		// half the leading plus the ascent. Defaulting to the cap-height trim lifted
		// every block by about ascent − capHeight above where the layer put it.
		const node = (leadingTrim?: boolean) => {
			const tpl = structuredClone(baseTemplate);
			const props = (tpl.template_data[0].elements[0] as TextElement)
				.properties;
			if (leadingTrim !== undefined) props.leadingTrim = leadingTrim;
			const compiled = compile(tpl, {}, { width: 100, height: 60 });
			const children = (compiled.frames[0].root as { children: Node[] })
				.children;
			return children.find((c) => c.kind === "text") as TextNode;
		};
		expect(node().leadingTrim).toBe(false);
		expect(node(false).leadingTrim).toBe(false);
		expect(node(true).leadingTrim).toBe(true);
	});

	test("text without fit:'clip' has no clip", () => {
		const cmds = getCommands(baseTemplate, {}, { width: 100, height: 60 });
		expect(findDraw(cmds, "drawText")!.clip).toBeUndefined();
	});

	test("polygon mask lowers, preserves sides + rotation", () => {
		const cmds = getCommands(
			withImage({ mask: { kind: "polygon", sides: 6, rotation: 30 } }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(cmds, "drawImage")!.clip).toEqual({
			kind: "polygon",
			sides: 6,
			rotation: 30,
		});
	});

	test("polygon mask without rotation defaults to undefined", () => {
		const cmds = getCommands(
			withImage({ mask: { kind: "polygon", sides: 5 } }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(cmds, "drawImage")!.clip).toEqual({
			kind: "polygon",
			sides: 5,
			rotation: undefined,
		});
	});

	test("squircle mask lowers and scales radius with ratio", () => {
		const cmds = getCommands(
			withImage({ mask: { kind: "squircle", radius: 8 } }),
			{},
			{ width: 200, height: 120 },
		);
		expect(findDraw(cmds, "drawImage")!.clip).toEqual({
			kind: "squircle",
			radius: 16,
		});
	});

	test("image stroke lowers to drawImage.stroke and scales width with ratio", () => {
		const cmds = getCommands(
			withImage({ stroke: { color: "#fff", width: 3 } }),
			{},
			{ width: 200, height: 120 },
		);
		expect(findDraw(cmds, "drawImage")!.stroke).toEqual({
			color: "#fff",
			width: 6,
		});
	});
});

describe("compile (stroke dash)", () => {
	test("dash array scales with ratio along with width", () => {
		const tpl = structuredClone(baseTemplate);
		(tpl.template_data[0].background as RectElement).properties.stroke = {
			color: "#000",
			width: 2,
			dash: [4, 2],
		};
		const cmds = getCommands(tpl, {}, { width: 200, height: 120 });
		const bg = topDraws(cmds)[0] as DrawRectCommand;
		// background uses ratio = 1 (full-bleed)
		expect(bg.stroke).toEqual({
			color: "#000",
			width: 2,
			dash: [4, 2],
		});
	});

	test("rect stroke cap/join thread through unscaled", () => {
		const tpl = structuredClone(baseTemplate);
		(tpl.template_data[0].background as RectElement).properties.stroke = {
			color: "#000",
			width: 2,
			cap: "round",
			join: "round",
		};
		const cmds = getCommands(tpl, {}, { width: 200, height: 120 });
		const bg = topDraws(cmds)[0] as DrawRectCommand;
		expect(bg.stroke).toEqual({
			color: "#000",
			width: 2,
			dash: undefined,
			cap: "round",
			join: "round",
		});
	});

	test("dash array on element scales with element ratio", () => {
		const tpl = structuredClone(baseTemplate);
		tpl.template_data[0].elements.push({
			id: "outline",
			type: "rect",
			pos: { x: 5, y: 5 },
			size: { width: 30, height: 30 },
			properties: {
				stroke: { color: "#000", width: 2, dash: [4, 2] },
			},
		});
		const cmds = getCommands(tpl, {}, { width: 200, height: 120 });
		const outline = topDraws(cmds)[2] as DrawRectCommand;
		expect(outline.stroke?.dash).toEqual([8, 4]);
		expect(outline.stroke?.width).toBe(4);
	});
});

describe("compile (multiple fills)", () => {
	test("singular fill normalizes to a one-element array", () => {
		const cmds = getCommands(baseTemplate, {}, { width: 100, height: 60 });
		const bg = topDraws(cmds)[0] as DrawRectCommand;
		expect(bg.fills).toEqual([{ kind: "solid", color: "#fef3c7" }]);
	});

	test("array of fills lowers in order (bottom-up)", () => {
		const tpl = structuredClone(baseTemplate);
		(tpl.template_data[0].background as RectElement).properties.fill = [
			"#000",
			{
				kind: "linear",
				angle: 90,
				stops: [
					{ offset: 0, color: "rgba(0,0,0,0.5)" },
					{ offset: 1, color: "rgba(255,255,255,0)" },
				],
			},
		];
		const cmds = getCommands(tpl, {}, { width: 100, height: 60 });
		const bg = topDraws(cmds)[0] as DrawRectCommand;
		expect(bg.fills).toHaveLength(2);
		expect(bg.fills?.[0]).toEqual({ kind: "solid", color: "#000" });
		expect(bg.fills?.[1]?.kind).toBe("linear");
	});

	test("missing fill stays undefined (no empty array)", () => {
		const tpl = structuredClone(baseTemplate);
		delete (tpl.template_data[0].background as RectElement).properties.fill;
		const cmds = getCommands(tpl, {}, { width: 100, height: 60 });
		const bg = topDraws(cmds)[0] as DrawRectCommand;
		expect(bg.fills).toBeUndefined();
	});
});

describe("compile (mixed text spans)", () => {
	function withSpans(spans: unknown): Template {
		const tpl = structuredClone(baseTemplate);
		const text = tpl.template_data[0].elements[0] as TextElement;
		(text.properties as Record<string, unknown>).spans = spans;
		text.properties.value = undefined as never;
		return tpl;
	}

	test("two spans lay out adjacently with their own fonts + colors", () => {
		const cmds = getCommands(
			withSpans([
				{ text: "PLAN: " },
				{ text: "PRO", color: "#f59e0b", font: { weight: 700 } },
			]),
			{},
			{ width: 100, height: 60 },
		);
		const line = findDraw(cmds, "drawText")!.layout.lines[0]!;
		expect(line.spans).toHaveLength(2);
		expect(line.spans[0]!.text).toBe("PLAN: ");
		expect(line.spans[1]!.text).toBe("PRO");
		expect(line.spans[1]!.color).toBe("#f59e0b");
		expect(line.spans[1]!.font.weight).toBe(700);
		// span[1].x = span[0].x + span[0].width
		expect(line.spans[1]!.x).toBeCloseTo(
			line.spans[0]!.x + line.spans[0]!.width,
			5,
		);
	});

	test("span without overrides inherits the element default font + color", () => {
		const cmds = getCommands(
			withSpans([{ text: "Hello" }]),
			{},
			{ width: 100, height: 60 },
		);
		const span = findDraw(cmds, "drawText")!.layout.lines[0]!.spans[0]!;
		expect(span.font.family).toBe("Comfortaa");
		expect(span.color).toBe("#1a1a1a");
	});

	test("dominant font (largest) drives line height", () => {
		const cmds = getCommands(
			withSpans([
				{ text: "small ", font: { size: 10 } },
				{ text: "BIG", font: { size: 30 } },
			]),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(cmds, "drawText")!.layout.font.size).toBe(30);
	});

	test("spans wins over value when both are set", () => {
		const tpl = structuredClone(baseTemplate);
		const text = tpl.template_data[0].elements[0] as TextElement;
		text.properties.value = "ignored";
		(text.properties as Record<string, unknown>).spans = [{ text: "kept" }];
		const cmds = getCommands(tpl, {}, { width: 100, height: 60 });
		expect(findDraw(cmds, "drawText")!.layout.lines[0]!.text).toBe("kept");
	});
});

describe("compile (blur)", () => {
	test("element blur scales with ratio", () => {
		const tpl = structuredClone(baseTemplate);
		tpl.template_data[0].elements[0].blur = 4;
		const cmds = getCommands(tpl, {}, { width: 200, height: 120 });
		expect(findDraw(cmds, "drawText")!.blur).toBe(8);
	});
});

describe("compile (font variations)", () => {
	test("element and span axes reach the text node, span axes merged over", () => {
		const tpl = structuredClone(baseTemplate);
		const title = tpl.template_data[0].elements[0] as TextElement;
		title.properties.font = {
			family: "Comfortaa",
			size: 16,
			weight: 300,
			variations: { wdth: 90 },
		};
		title.properties.spans = [
			{ text: "a" },
			{ text: "b", font: { weight: 900, variations: { wght: 950 } } },
		];
		const layout = findDraw(
			getCommands(tpl, {}, { width: 100, height: 60 }),
			"drawText",
		)!.layout;
		const spans = layout.lines.flatMap((l) => l.spans);
		expect(spans[0].font).toMatchObject({
			weight: 300,
			variations: { wdth: 90 },
		});
		expect(spans.at(-1)!.font).toMatchObject({
			weight: 900,
			variations: { wdth: 90, wght: 950 },
		});
	});
});

describe("compile (vector path)", () => {
	function withVector(props: Record<string, unknown>): Template {
		return {
			...baseTemplate,
			template_data: [
				{
					...baseTemplate.template_data[0]!,
					elements: [
						{
							id: "icon",
							type: "vector",
							pos: { x: 10, y: 10 },
							size: { width: 20, height: 20 },
							properties: { d: "M0,0", ...props } as never,
						} as never,
					],
				},
			],
		};
	}

	test("path lowers to drawPath with d preserved when ratio = 1", () => {
		const cmds = getCommands(
			withVector({ d: "M0,0 L10,10 Z", fill: "#000" }),
			{},
			{ width: 100, height: 60 },
		);
		const path = findDraw(cmds, "drawPath")!;
		expect(path.d).toBe("M0,0 L10,10 Z");
		expect(path.fills).toEqual([{ kind: "solid", color: "#000" }]);
	});

	test("path d coords scale with ratio", () => {
		const cmds = getCommands(
			withVector({ d: "M0,0 L10,10 Z" }),
			{},
			{ width: 200, height: 120 },
		);
		// every number multiplied by 2
		expect(findDraw(cmds, "drawPath")!.d).toBe("M0,0 L20,20 Z");
	});

	test("an arc's rotation and flags survive scaling", () => {
		const cmds = getCommands(
			withVector({ d: "M0 0 A5 5 90 1 0 10 0" }),
			{},
			{ width: 200, height: 120 },
		);
		expect(findDraw(cmds, "drawPath")!.d).toBe("M0 0 A10 10 90 1 0 20 0");
	});

	test("fillRule lowers onto drawPath", () => {
		const cmds = getCommands(
			withVector({ d: "M0 0 H4 V4 H0 Z M1 1 H3 V3 H1 Z", fillRule: "evenodd" }),
			{},
			{ width: 100, height: 60 },
		);
		expect(findDraw(cmds, "drawPath")!.fillRule).toBe("evenodd");
	});

	test("path stroke width scales with ratio", () => {
		const cmds = getCommands(
			withVector({ d: "M0,0 L1,1", stroke: { color: "#f00", width: 2 } }),
			{},
			{ width: 200, height: 120 },
		);
		expect(findDraw(cmds, "drawPath")!.stroke).toEqual({
			color: "#f00",
			width: 4,
		});
	});

	test("path stroke cap/join thread through unscaled", () => {
		const cmds = getCommands(
			withVector({
				d: "M0,0 L1,1",
				stroke: { color: "#f00", width: 2, cap: "round", join: "round" },
			}),
			{},
			{ width: 200, height: 120 },
		);
		expect(findDraw(cmds, "drawPath")!.stroke).toEqual({
			color: "#f00",
			width: 4,
			dash: undefined,
			cap: "round",
			join: "round",
		});
	});

	test("path with negative + decimal coords scales correctly", () => {
		const cmds = getCommands(
			withVector({ d: "M-1.5,2.5 C-3,0 0,-3 1.5,1.5" }),
			{},
			{ width: 200, height: 120 },
		);
		expect(findDraw(cmds, "drawPath")!.d).toBe("M-3,5 C-6,0 0,-6 3,3");
	});
});

describe("compile (shadow)", () => {
	test("element shadow lowers to draw command shadow and scales offsets + blur", () => {
		const tpl = structuredClone(baseTemplate);
		tpl.template_data[0].elements[0].shadow = {
			color: "rgba(0,0,0,0.3)",
			dx: 0,
			dy: 4,
			blur: 8,
		};
		const cmds = getCommands(tpl, {}, { width: 200, height: 120 });
		expect(findDraw(cmds, "drawText")!.shadow).toEqual({
			color: "rgba(0,0,0,0.3)",
			dx: 0,
			dy: 8,
			blur: 16,
		});
	});

	test("background shadow flows through (ratio = 1 since bg is full-bleed)", () => {
		const tpl = structuredClone(baseTemplate);
		tpl.template_data[0].background.shadow = {
			color: "#000",
			dx: 2,
			dy: 2,
			blur: 4,
		};
		const cmds = getCommands(tpl, {}, { width: 200, height: 120 });
		expect(topDraws(cmds)[0]!.shadow).toEqual({
			color: "#000",
			dx: 2,
			dy: 2,
			blur: 4,
		});
	});
});

describe("compile assets (fonts + images)", () => {
	const fontTemplate: Template = {
		format_version: "1.0",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "card_cr80",
		width: 100,
		height: 60,
		fields: { type: "object", properties: {} },
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
						id: "txt1",
						type: "text",
						pos: { x: 0, y: 0 },
						size: { width: 50, height: 20 },
						properties: {
							value: "A",
							font: { family: "Comfortaa", size: 12 },
							color: "#000",
						},
					},
					{
						id: "txt2",
						type: "text",
						pos: { x: 0, y: 25 },
						size: { width: 50, height: 20 },
						properties: {
							value: "B",
							font: { family: "Plus Jakarta Sans", size: 10 },
							color: "#000",
						},
					},
				],
			},
		],
	};

	test("assets.fonts dedupes by family (by-name when no fonts block)", () => {
		const tpl: Template = {
			...baseTemplate,
			template_data: [
				{
					...baseTemplate.template_data[0]!,
					elements: [
						...baseTemplate.template_data[0]!.elements,
						{
							id: "subtitle",
							type: "text",
							pos: { x: 10, y: 40 },
							size: { width: 80, height: 16 },
							properties: {
								value: "x",
								font: { family: "Plus Jakarta Sans", size: 12 },
								color: "#333",
							},
						},
						{
							id: "subtitle2",
							type: "text",
							pos: { x: 10, y: 50 },
							size: { width: 80, height: 16 },
							properties: {
								value: "y",
								font: { family: "Comfortaa", size: 12 },
								color: "#333",
							},
						},
					],
				},
			],
		};
		const out = compile(tpl, {}, { width: 100, height: 60 });
		const fonts = out.frames[0]!.assets.fonts;
		const families = fonts.map((r) => r.family).sort();
		expect(families).toEqual(["Comfortaa", "Plus Jakarta Sans"]);
		expect(fonts.every((r) => !("descriptor" in r))).toBe(true);
	});

	test("assets.fonts attaches descriptors when the template declares a fonts block", () => {
		const tpl: Template = {
			...baseTemplate,
			fonts: [
				{
					kind: "google",
					family: "Comfortaa",
					url: "https://fonts.googleapis.com/css2?family=Comfortaa&display=swap",
				},
			],
		};
		const out = compile(tpl, {}, { width: 100, height: 60 });
		const fonts = out.frames[0]!.assets.fonts;
		expect(fonts).toHaveLength(1);
		const req = fonts[0]!;
		expect(req.family).toBe("Comfortaa");
		expect("descriptor" in req).toBe(true);
		if ("descriptor" in req) {
			expect(req.descriptor.kind).toBe("google");
		}
	});

	test("frame with no text elements has empty assets.fonts", () => {
		const tpl: Template = {
			...baseTemplate,
			template_data: [
				{
					name: "front",
					background: baseTemplate.template_data[0]!.background,
					elements: [],
				},
			],
		};
		const out = compile(tpl, {}, { width: 100, height: 60 });
		expect(out.frames[0]!.assets.fonts).toEqual([]);
	});

	test("assets.images empty when no image elements exist", () => {
		const out = compile(fontTemplate, {}, { width: 100, height: 60 });
		expect(out.frames[0]!.assets.images).toEqual([]);
	});

	test("assets.images dedupes srcs across image elements + image background", () => {
		const tpl: Template = {
			...fontTemplate,
			template_data: [
				{
					name: "front",
					background: {
						id: "bg",
						type: "image",
						pos: { x: 0, y: 0 },
						size: { width: 100, height: 60 },
						properties: { src: "https://example/a.png", fit: "cover" },
					},
					elements: [
						{
							id: "img1",
							type: "image",
							pos: { x: 10, y: 10 },
							size: { width: 30, height: 30 },
							properties: { src: "https://example/b.png", fit: "cover" },
						},
						{
							id: "img2",
							type: "image",
							pos: { x: 50, y: 10 },
							size: { width: 30, height: 30 },
							properties: { src: "https://example/a.png", fit: "cover" },
						},
					],
				},
			],
		};
		const out = compile(tpl, {}, { width: 100, height: 60 });
		const images = out.frames[0]!.assets.images;
		expect(images.sort()).toEqual([
			"https://example/a.png",
			"https://example/b.png",
		]);
	});

	test("QR element gets a module matrix at compile time", () => {
		const tpl: Template = {
			...fontTemplate,
			template_data: [
				{
					name: "front",
					background: fontTemplate.template_data[0]!.background,
					elements: [
						{
							id: "qr",
							type: "qr_code",
							pos: { x: 10, y: 10 },
							size: { width: 30, height: 30 },
							properties: { value: "https://example.com/alex" },
						},
					],
				},
			],
		};
		const cmds = getCommands(tpl, {}, { width: 100, height: 60 });
		// A QR element lowers to a drawGroup containing a drawBitmap whose pixel
		// dimensions are the module-matrix size (square, > 0 for a filled value).
		const bmp = findDraw(cmds, "drawBitmap")!;
		expect(bmp.op).toBe("drawBitmap");
		expect(bmp.pixelWidth).toBeGreaterThan(0);
		expect(bmp.pixelHeight).toBe(bmp.pixelWidth);
	});
});

describe("compile (auto-layout single-bake + rotation)", () => {
	test("auto-layout frame children are single-baked (no double offset)", () => {
		const tpl: Template = {
			format_version: "1.0",
			version: "1.0.0",
			id: "t",
			name: "t",
			product: "card",
			width: 300,
			height: 200,
			fields: { type: "object", properties: {} },
			template_data: [
				{
					name: "front",
					background: {
						id: "bg",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: 300, height: 200 },
						properties: { fill: "#fff" },
					},
					elements: [
						{
							id: "stack",
							type: "frame",
							pos: { x: 77, y: 157 },
							size: { width: 305, height: 86 },
							properties: {
								layout: { direction: "column", gap: 0 },
								children: [
									{
										id: "a",
										type: "text",
										pos: { x: 0, y: 0 },
										size: { width: 305, height: 24 },
										layoutChild: { height: "hug" },
										properties: {
											value: "x",
											font: { family: "Inter", size: 20 },
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
		const cmds = getCommands(tpl, {}, { width: 300, height: 200 });
		const a = findDraw(cmds, "drawText")!;
		// Single bake: child drawn at frame origin (77,157)+local(0,0), NOT (154,314).
		expect(a.pos).toEqual({ x: 77, y: 157 });
	});

	test("a rotated auto-layout frame carries rotation on its group; children stay upright", () => {
		const tpl: Template = {
			format_version: "1.0",
			version: "1.0.0",
			id: "t",
			name: "t",
			product: "card",
			width: 300,
			height: 300,
			fields: { type: "object", properties: {} },
			template_data: [
				{
					name: "front",
					background: {
						id: "bg",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: 300, height: 300 },
						properties: { fill: "#fff" },
					},
					elements: [
						{
							id: "stack",
							type: "frame",
							pos: { x: 10, y: 10 },
							size: { width: 200, height: 40 },
							rotation: 90,
							properties: {
								layout: { direction: "column", gap: 0 },
								children: [
									{
										id: "a",
										type: "text",
										pos: { x: 0, y: 0 },
										size: { width: 200, height: 20 },
										layoutChild: { height: "hug" },
										properties: {
											value: "x",
											font: { family: "Inter", size: 16 },
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
		const cmds = getCommands(tpl, {}, { width: 300, height: 300 });
		// The outer frame group carries the rotation; the nested layout group + its
		// children stay upright (rotation folded onto the group's transform only).
		const rotated = findDraws(cmds, "drawGroup").find((g) => g.rotation === 90);
		expect(rotated).toBeDefined();
		const a = findDraw(cmds, "drawText")!;
		expect(a.rotation ?? 0).toBe(0);
	});
});

describe("compile (auto-layout integration)", () => {
	test("compile lays out an auto-layout column before drawing", () => {
		const tpl: Template = {
			format_version: "1.0",
			version: "1.0.0",
			id: "t",
			name: "t",
			product: "card",
			width: 300,
			height: 200,
			fields: {
				type: "object",
				properties: { name: { type: "string", default: "Jane" } },
			},
			template_data: [
				{
					name: "front",
					background: {
						id: "bg",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: 300, height: 200 },
						properties: { fill: "#fff" },
					},
					elements: [
						{
							id: "stack",
							type: "frame",
							pos: { x: 0, y: 0 },
							size: { width: 300, height: 200 },
							properties: {
								layout: { direction: "column", gap: 10 },
								children: [
									{
										id: "name",
										type: "text",
										pos: { x: 0, y: 0 },
										size: { width: 300, height: 24 },
										layoutChild: { height: "hug" },
										properties: {
											value: "{{name}}",
											font: { family: "Inter", size: 20 },
											color: "#000",
										},
									},
									{
										id: "role",
										type: "text",
										pos: { x: 0, y: 0 },
										size: { width: 300, height: 24 },
										layoutChild: { height: "hug" },
										properties: {
											value: "CEO",
											font: { family: "Inter", size: 20 },
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
		const cmds = getCommands(
			tpl,
			{ name: "A Very Long Name That Wraps" },
			{ width: 300, height: 200 },
		);
		const texts = findDraws(cmds, "drawText");
		const name = texts.find((t) =>
			t.layout.lines[0]!.spans[0]!.text.startsWith("A Very"),
		);
		const role = texts.find((t) => t.layout.lines[0]!.spans[0]!.text === "CEO");
		expect(name).toBeDefined();
		expect(role).toBeDefined();
		expect(texts).toHaveLength(2);
		// The approx engine keeps the name on one line (hug height =
		// font.size * lineHeight = 20 * 1.2 = 24px). resolveLayout places role at
		// y = name.y + 24 + gap(10) = 34, strictly greater than name.y + 24.
		expect(role!.pos.y).toBeGreaterThan(name!.pos.y + 24);
	});
});

describe("compileToCanvasCommands (canvas lowering)", () => {
	test("first command is createCanvas at target dims", () => {
		const frames = compileToCommands(
			baseTemplate,
			{},
			{ width: 200, height: 120 },
		);
		expect(frames[0]!.commands[0]).toEqual({
			op: "createCanvas",
			width: 200,
			height: 120,
		});
	});

	test("setup commands precede draw ops, in createCanvas → loadFonts → loadImages order", () => {
		const tpl: Template = {
			...baseTemplate,
			template_data: [
				{
					name: "front",
					background: baseTemplate.template_data[0]!.background,
					elements: [
						...baseTemplate.template_data[0]!.elements,
						{
							id: "img",
							type: "image",
							pos: { x: 0, y: 0 },
							size: { width: 50, height: 30 },
							properties: { src: "https://example/a.png", fit: "cover" },
						},
					],
				},
			],
		};
		const frames = compileToCommands(tpl, {}, { width: 100, height: 60 });
		const ops = frames[0]!.commands.map((c) => c.op);
		const firstDrawIdx = ops.findIndex((o) => o.startsWith("draw"));
		expect(ops.slice(0, firstDrawIdx)).toEqual([
			"createCanvas",
			"loadFonts",
			"loadImages",
		]);
	});

	test("drawText command carries pre-baked layout (painter does not re-measure)", () => {
		const frames = compileToCommands(
			baseTemplate,
			{ displayName: "Alex" },
			{
				width: 100,
				height: 60,
			},
		);
		const drawText = frames[0]!.commands.find((c) => c.op === "drawText")!;
		if (drawText.op === "drawText") {
			expect(drawText.layout.lines.length).toBeGreaterThan(0);
			expect(drawText.layout.lines[0]!.text).toBe("Hi Alex");
			expect(drawText.color).toBe("#1a1a1a");
		}
	});

	test("drawRect command carries ResolvedFill (gradients normalized)", () => {
		const tpl = structuredClone(baseTemplate);
		(tpl.template_data[0].background as RectElement).properties.fill = {
			kind: "linear",
			angle: 0,
			stops: [
				{ offset: 0, color: "#000" },
				{ offset: 1, color: "#fff" },
			],
		};
		const frames = compileToCommands(tpl, {}, { width: 100, height: 60 });
		const drawRect = frames[0]!.commands.find((c) => c.op === "drawRect")!;
		const f = drawRect.op === "drawRect" ? drawRect.fills?.[0] : undefined;
		if (f?.kind === "linear") {
			expect(f.from).toEqual({ x: 0, y: 0.5 });
			expect(f.to).toEqual({ x: 1, y: 0.5 });
		}
	});
});

describe("compile (substitution inside containers)", () => {
	const text = (id: string) =>
		({
			id,
			type: "text",
			size: { width: 80, height: 10 },
			properties: {
				value: "Hi {{displayName}}",
				font: { family: "Inter", size: 8 },
			},
		}) as TextElement;

	function nested(container: "frame" | "mask"): Template {
		const tpl = structuredClone(baseTemplate);
		tpl.fields.properties.secret = { type: "string", default: "SYSTEM-VALUE" };
		tpl.template_data[0].elements = [
			container === "frame"
				? ({
						id: "c",
						type: "frame",
						size: { width: 100, height: 20 },
						properties: { children: [text("inner")] },
					} as FrameElement)
				: ({
						id: "c",
						type: "mask",
						size: { width: 100, height: 20 },
						properties: {
							mask: { id: "shape", type: "rect", properties: { fill: "#000" } },
							children: [text("inner")],
						},
					} as never),
		];
		return tpl;
	}

	// A rect mask lowers to a clipped drawGroup, which findDraws descends into.
	test.each([
		"frame",
		"mask",
	] as const)("a value that looks like a token is not expanded again inside a %s", (container) => {
		const [inner] = findDraws(
			getCommands(
				nested(container),
				{ displayName: "{{secret}}" },
				{ width: 100, height: 60 },
			),
			"drawText",
		);
		expect(inner.layout.lines.map((l) => l.text).join(" ")).toBe(
			"Hi {{secret}}",
		);
	});
});
