import { describe, expect, it, vi } from "vitest";
import { createFieldsOverview } from "~/main/fields-overview";
import type { FieldOverviewItem } from "~/shared/protocol";

type Frame = { id: string; fields: string[] };

const item = (slot: string, id: string): FieldOverviewItem => ({
	id,
	meta: { id, format: "text", title: id, required: false, source: "user" },
	slot,
	nodeIds: [],
	layerNames: [],
});

function setup() {
	const scan = vi.fn((frame: Frame) =>
		frame.fields.map((id) => item(frame.id, id)),
	);
	return { scan, overview: createFieldsOverview(scan) };
}

describe("createFieldsOverview", () => {
	it("rescans only the edited frame after a binding edit", () => {
		const { scan, overview } = setup();
		const a = { id: "a", fields: ["name"] };
		const b = { id: "b", fields: ["sku"] };
		const c = { id: "c", fields: [] };
		overview.all([a, b, c]);
		expect(scan).toHaveBeenCalledTimes(3);

		scan.mockClear();
		const editedB = { id: "b", fields: ["sku", "price"] };
		const fields = overview.update([a, editedB, c], ["b"]);
		expect(scan.mock.calls.map(([f]) => f.id)).toEqual(["b"]);
		expect(fields.map((f) => `${f.slot}:${f.id}`)).toEqual([
			"a:name",
			"b:sku",
			"b:price",
		]);
	});

	it("scans nothing for an edit outside any frame", () => {
		const { scan, overview } = setup();
		const frames = [{ id: "a", fields: ["name"] }];
		overview.all(frames);
		scan.mockClear();
		expect(overview.update(frames, [])).toHaveLength(1);
		expect(scan).not.toHaveBeenCalled();
	});

	it("scans a new frame and drops a removed one, in page order", () => {
		const { scan, overview } = setup();
		const a = { id: "a", fields: ["name"] };
		const b = { id: "b", fields: ["sku"] };
		overview.all([a, b]);
		scan.mockClear();
		const c = { id: "c", fields: ["tier"] };
		const fields = overview.update([c, a], []);
		expect(scan.mock.calls.map(([f]) => f.id)).toEqual(["c"]);
		expect(fields.map((f) => f.slot)).toEqual(["c", "a"]);
	});

	it("rescans everything on a full refresh", () => {
		const { scan, overview } = setup();
		const frames = [
			{ id: "a", fields: ["name"] },
			{ id: "b", fields: [] },
		];
		overview.all(frames);
		overview.all(frames);
		expect(scan).toHaveBeenCalledTimes(4);
	});
});
