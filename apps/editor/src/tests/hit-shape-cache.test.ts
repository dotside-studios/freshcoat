import type { Element } from "@freshcoat-js/coatfile";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import type { CanvasKit, Path } from "canvaskit-wasm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorController } from "~/app/controller";
import type { LayerBox } from "~/doc/geometry";
import { MAX_ENTRIES, ShapeHits } from "~/doc/hit-shape";
import { doc } from "./doc-fixture";

let ck: CanvasKit;

vi.mock("~/render/canvaskit", () => ({
	loadedCanvasKit: () => ck,
	getCanvasKit: async () => ck,
}));

beforeAll(async () => {
	ck = await loadCanvasKit();
});

afterEach(() => vi.restoreAllMocks());

const box: LayerBox = {
	rect: { x: 0, y: 0, width: 100, height: 100 },
	worldRotation: 0,
} as LayerBox;

function vector(stroke = false): Element {
	return {
		id: "v",
		type: "vector",
		pos: { x: 0, y: 0 },
		size: { width: 100, height: 100 },
		properties: {
			d: "M0 0H100V100H0Z",
			fill: "#000000",
			...(stroke ? { stroke: { color: "#000000", width: 4 } } : {}),
		},
	} as Element;
}

function trackPaths() {
	const made: Path[] = [];
	const make = ck.Path.MakeFromSVGString.bind(ck.Path);
	const spy = vi
		.spyOn(ck.Path, "MakeFromSVGString")
		.mockImplementation((d: string) => {
			const path = make(d);
			if (path) {
				vi.spyOn(path, "delete");
				made.push(path);
			}
			return path;
		});
	return { made, spy };
}

describe("ShapeHits cache", () => {
	it("evicts the least recently used entry and deletes its paths", () => {
		const { made } = trackPaths();
		const shapes = new ShapeHits(ck);
		const point = { x: 50, y: 50 };
		const el = vector();
		for (let i = 0; i < MAX_ENTRIES; i++) shapes.hits(`k${i}`, el, box, point);
		shapes.hits("k0", el, box, point);
		shapes.hits("extra", el, box, point);
		expect(made).toHaveLength(MAX_ENTRIES + 1);
		expect(made[0]?.delete).not.toHaveBeenCalled();
		expect(made[1]?.delete).toHaveBeenCalledTimes(1);
		for (const path of made.slice(2))
			expect(path.delete).not.toHaveBeenCalled();
		shapes.clear();
		for (const path of made.slice(2))
			expect(path.delete).toHaveBeenCalledTimes(1);
	});

	it("keeps the fill path across zoom changes", () => {
		const { spy } = trackPaths();
		const shapes = new ShapeHits(ck);
		const el = vector(true);
		for (const zoom of [1, 1.1, 2, 4, 0.25])
			expect(shapes.hits("k", el, box, { x: 102, y: 50 }, 3 / zoom)).toBe(true);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(shapes.hits("k", el, box, { x: 120, y: 50 }, 3)).toBe(false);
		shapes.clear();
	});
});

describe("EditorController shape cache", () => {
	function hovered() {
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		const clear = vi.spyOn(ShapeHits.prototype, "clear");
		c.hitTest({ x: 0, y: 0 });
		return { c, clear };
	}

	it("clears on dispose", () => {
		const { c, clear } = hovered();
		c.dispose();
		expect(clear).toHaveBeenCalledTimes(1);
	});

	it("clears when the document changes and not on edits", () => {
		const { c, clear } = hovered();
		c.select(["0/0"]);
		c.deleteSelection();
		expect(clear).not.toHaveBeenCalled();
		c.open({ ...doc(), id: "other" }, "other.coat");
		expect(clear).toHaveBeenCalledTimes(1);
	});
});
