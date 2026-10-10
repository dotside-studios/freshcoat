import type { Element, Template, VectorElement } from "@freshcoat-js/coatfile";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import type { CanvasKit } from "canvaskit-wasm";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { writeAutosave } from "~/app/autosave";
import { EditorController } from "~/app/controller";
import * as download from "~/app/download";
import { booleanElements, unwrap, updateElement } from "~/doc/ops";
import { getElement } from "~/doc/path";

let ck: CanvasKit;
let loaded: CanvasKit | undefined;
let release: () => void = () => {};

vi.mock("~/render/canvaskit", () => ({
	loadedCanvasKit: () => loaded,
	getCanvasKit: () =>
		new Promise<CanvasKit>((resolve) => {
			release = () => {
				loaded = ck;
				resolve(ck);
			};
		}),
}));

vi.mock("~/app/autosave", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/app/autosave")>()),
	writeAutosave: vi.fn(async () => {}),
}));

beforeAll(async () => {
	ck = await loadCanvasKit();
});

afterEach(() => {
	loaded = undefined;
	release = () => {};
	vi.restoreAllMocks();
	vi.mocked(writeAutosave).mockClear();
});

const square = (id: string, x: number): Element => ({
	id,
	type: "rect",
	pos: { x, y: 0 },
	size: { width: 100, height: 100 },
	properties: { fill: "#aa0000" },
});

function template(): Template {
	const shapes: Template = {
		format_version: "1.1",
		id: "shapes",
		name: "Shapes",
		width: 400,
		height: 300,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					size: { width: 400, height: 300 },
					properties: { fill: "#ffffff" },
				},
				elements: [square("a", 0), square("b", 50)],
			},
		],
	};
	return unwrap(booleanElements(shapes, ["0/0", "0/1"], "union", ck)).template;
}

const vectorAt = (c: EditorController) =>
	getElement(c.base as Template, "0/0") as VectorElement;

/** A controller whose session has no CanvasKit yet, with an operand moved. */
function movedWithoutCanvasKit(): EditorController {
	const c = new EditorController();
	c.open(template(), "s.coat");
	c.edit((t) => updateElement(t, "0/0/1", { pos: { x: 120, y: 0 } }));
	return c;
}

describe("a boolean's cache without CanvasKit on the main thread", () => {
	test("is rebuilt once CanvasKit loads", async () => {
		const c = movedWithoutCanvasKit();
		const stale = vectorAt(c);
		expect(stale.size).toEqual({ width: 150, height: 100 });
		release();
		await vi.waitFor(() => expect(vectorAt(c)).not.toBe(stale));
		expect(vectorAt(c).size).toEqual({ width: 220, height: 100 });
		expect(c.dirty).toBe(true);
	});

	test("is rebuilt by the next edit, which loads nothing", () => {
		const c = movedWithoutCanvasKit();
		loaded = ck;
		c.edit((t) => updateElement(t, "0/0/0", { pos: { x: 10, y: 0 } }));
		expect(vectorAt(c).size).toEqual({ width: 210, height: 100 });
	});

	test("is rebuilt before a save writes it", async () => {
		const written = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const c = movedWithoutCanvasKit();
		const saving = c.save("json");
		release();
		expect(await saving).toBe(true);
		const json = written.mock.calls[0]?.[0] as string;
		const saved = JSON.parse(json) as Template;
		const el = getElement(saved, "0/0") as VectorElement;
		expect(el.size).toEqual({ width: 220, height: 100 });
	});

	test("is rebuilt before an autosave writes it", async () => {
		vi.useFakeTimers();
		movedWithoutCanvasKit();
		vi.advanceTimersByTime(1500);
		expect(writeAutosave).not.toHaveBeenCalled();
		release();
		await vi.advanceTimersByTimeAsync(2500);
		vi.useRealTimers();
		const ws = vi.mocked(writeAutosave).mock.calls.at(-1)?.[0].workspace;
		const saved = ws?.templates[0]?.template as Template;
		expect((getElement(saved, "0/0") as VectorElement).size).toEqual({
			width: 220,
			height: 100,
		});
	});

	test("loads nothing for a template without a boolean", () => {
		const c = new EditorController();
		c.open(
			{
				...template(),
				template_data: [
					{
						...(template().template_data[0] as Template["template_data"][0]),
						elements: [square("a", 0)],
					},
				],
			},
			"s.coat",
		);
		c.edit((t) => updateElement(t, "0/0", { pos: { x: 5, y: 5 } }));
		expect(loaded).toBeUndefined();
	});
});
