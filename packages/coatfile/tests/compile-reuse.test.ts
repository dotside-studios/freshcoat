import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { approxEngine } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import CanvasKitInit from "canvaskit-wasm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { compile } from "../src/compile";
import { prepareTemplate } from "../src/prepare";
import { renderCompiled } from "../src/render";
import { TemplateSchema } from "../src/schemas";
import type { Template } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

const side = (name: string, fill: string) => ({
	name,
	background: {
		id: `bg-${name}`,
		type: "rect",
		pos: { x: 0, y: 0 },
		size: { width: 40, height: 20 },
		properties: { fill },
	},
	elements: [],
});

const makeTemplate = () =>
	({
		format_version: "1.0",
		version: "1.0.0",
		id: "t",
		name: "T",
		description: "d",
		product: "test",
		width: 40,
		height: 20,
		fields: { type: "object", properties: {} },
		template_data: [side("front", "#ffffff"), side("back", "#000000")],
	}) as unknown as Template;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("compile() frameNames", () => {
	test("compiles only the named frames", () => {
		const compiled = compile(
			makeTemplate(),
			{},
			{ width: 40, height: 20, frameNames: ["back"] },
		);
		expect(compiled.frames.map((f) => f.name)).toEqual(["back"]);
	});

	test("compiles every frame when omitted", () => {
		const compiled = compile(makeTemplate(), {}, { width: 40, height: 20 });
		expect(compiled.frames.map((f) => f.name)).toEqual(["front", "back"]);
	});
});

describe("template preparation reuse", () => {
	test("repeated compiles of one template validate it once", () => {
		const parse = vi.spyOn(TemplateSchema, "safeParse");
		const template = makeTemplate();
		for (let i = 0; i < 3; i++)
			compile(template, { n: i }, { width: 40, height: 20 });
		expect(parse).toHaveBeenCalledTimes(1);
		compile(makeTemplate(), {}, { width: 40, height: 20 });
		expect(parse).toHaveBeenCalledTimes(2);
	});

	test("prepareTemplate is memoized per template and options", () => {
		const template = makeTemplate();
		const a = prepareTemplate(template, { resize: { width: 80, height: 40 } });
		const b = prepareTemplate(template, { resize: { width: 80, height: 40 } });
		const c = prepareTemplate(template, { resize: { width: 60, height: 30 } });
		expect(b).toBe(a);
		expect(c).not.toBe(a);
		expect(prepareTemplate(template)).toBe(template);
	});

	test("an invalid template keeps compile's error", () => {
		const bad = { ...makeTemplate(), width: -1 } as Template;
		expect(() => compile(bad, {}, { width: 40, height: 20 })).toThrow(
			/^invalid template: /,
		);
		expect(() => compile(bad, {}, { width: 40, height: 20 })).toThrow(
			/^invalid template: /,
		);
	});
});

describe("renderCompiled() with a provided text engine", () => {
	test("uses it and leaves it undisposed", async () => {
		const ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
		const dispose = vi.fn();
		const textEngine = { ...approxEngine, dispose };
		const compiled = compile(makeTemplate(), {}, { width: 40, height: 20 });
		const results = await renderCompiled(
			compiled,
			{ frameNames: ["front"] },
			{ ck, env: createHeadlessEnv(), textEngine, fontMetrics: {} },
		);
		expect(results.map((r) => r.name)).toEqual(["front"]);
		expect(dispose).not.toHaveBeenCalled();
	});
});
