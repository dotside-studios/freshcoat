import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	postFieldsOverview,
	postSelectionDetail,
	scheduleFieldsOverview,
	scheduleSelectionDetail,
} from "~/main/bindings";
import { FIELD_KEY, FIELDS_KEY } from "~/main/plugin-data";
import type {
	FieldsOverviewMessage,
	SelectionDetailMessage,
} from "~/shared/protocol";

const shape = (id: string, name: string, type: string) => ({
	id,
	name,
	type,
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	rotation: 0,
	absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
	effects: [],
	fills: [
		{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: true },
	],
	strokes: [],
	getPluginData: vi.fn((_key: string) => ""),
});

let posted: SelectionDetailMessage[];
let selection: unknown[];

beforeEach(() => {
	posted = [];
	selection = [];
	vi.stubGlobal("figma", {
		currentPage: {
			get selection() {
				return selection;
			},
		},
		ui: { postMessage: (msg: SelectionDetailMessage) => posted.push(msg) },
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("postSelectionDetail", () => {
	it("reads the selected node without visiting its children", () => {
		const child = shape("1:2", "child", "RECTANGLE");
		const childrenRead = vi.fn(() => [child]);
		const frame = {
			...shape("1:1", "{{brand}}", "FRAME"),
			get children() {
				return childrenRead();
			},
		};
		frame.getPluginData.mockImplementation((key: string) =>
			key === FIELD_KEY ? JSON.stringify({ bind: { fill: "{{brand}}" } }) : "",
		);
		selection = [frame];

		postSelectionDetail();

		expect(childrenRead).not.toHaveBeenCalled();
		expect(child.getPluginData).not.toHaveBeenCalled();
		expect(posted).toHaveLength(1);
		expect(posted[0].detail).toMatchObject({
			nodeId: "1:1",
			nodeType: "FRAME",
			bind: { fill: "{{brand}}" },
		});
	});

	it("posts null when the selection is not a single node", () => {
		postSelectionDetail();
		expect(posted).toEqual([{ type: "selection-detail", detail: null }]);
	});
});

describe("scheduleSelectionDetail", () => {
	it("coalesces a burst into one post of the latest selection", () => {
		vi.useFakeTimers();
		selection = [shape("1:1", "a", "RECTANGLE")];
		scheduleSelectionDetail();
		selection = [shape("1:2", "b", "RECTANGLE")];
		scheduleSelectionDetail();
		expect(posted).toHaveLength(0);
		vi.advanceTimersByTime(50);
		expect(posted).toHaveLength(1);
		expect(posted[0].detail?.nodeId).toBe("1:2");
	});

	it("drops a scheduled post superseded by a direct one", () => {
		vi.useFakeTimers();
		selection = [shape("1:1", "a", "RECTANGLE")];
		scheduleSelectionDetail();
		postSelectionDetail();
		vi.advanceTimersByTime(50);
		expect(posted).toHaveLength(1);
	});
});

describe("scheduleFieldsOverview", () => {
	type Layer = { id: string; name: string; removed: boolean };

	function canvas() {
		const page = { type: "PAGE" };
		const layers: Layer[] = [
			{ id: "2:1", name: "Title", removed: false },
			{ id: "2:2", name: "Subtitle", removed: false },
		];
		const frame = {
			id: "1:1",
			name: "Front",
			type: "FRAME",
			removed: false,
			parent: page,
			getPluginData: (key: string) =>
				key === FIELDS_KEY
					? JSON.stringify({
							name: { id: "name", format: "text", title: "Name" },
						})
					: "",
			findAllWithCriteria: () =>
				layers.map((l) => ({
					...l,
					parent: frame,
					getPluginData: (key: string) =>
						key === FIELD_KEY
							? JSON.stringify({ bind: { text: "{{name}}" } })
							: "",
				})),
		};
		const overviews: FieldsOverviewMessage[] = [];
		vi.stubGlobal("figma", {
			currentPage: { children: [frame] },
			ui: {
				postMessage: (msg: FieldsOverviewMessage) => overviews.push(msg),
			},
		});
		return { frame, layers, overviews };
	}

	const change = (
		type: "PROPERTY_CHANGE" | "DELETE",
		node: object,
		properties: string[] = [],
	) => ({ id: (node as { id: string }).id, type, node, properties }) as never;

	it("refreshes a frame renamed on the canvas", () => {
		vi.useFakeTimers();
		const { frame, overviews } = canvas();
		postFieldsOverview();
		frame.name = "Back";
		scheduleFieldsOverview([change("PROPERTY_CHANGE", frame, ["name"])]);
		scheduleFieldsOverview([change("PROPERTY_CHANGE", frame, ["name"])]);
		expect(overviews).toHaveLength(1);
		vi.advanceTimersByTime(100);
		expect(overviews).toHaveLength(2);
		expect(overviews[1].fields[0].slot).toBe("Back");
	});

	it("refreshes a frame whose bound layer was deleted", () => {
		vi.useFakeTimers();
		const { layers, overviews } = canvas();
		postFieldsOverview();
		expect(overviews[0].fields[0].nodeIds).toEqual(["2:1", "2:2"]);
		const [gone] = layers.splice(0, 1);
		scheduleFieldsOverview([
			change("DELETE", { id: gone.id, removed: true, type: "TEXT" }),
		]);
		vi.advanceTimersByTime(100);
		expect(overviews).toHaveLength(2);
		expect(overviews[1].fields[0].nodeIds).toEqual(["2:2"]);
		expect(overviews[1].fields[0].layerNames).toEqual(["Subtitle"]);
	});

	it("ignores changes that cannot alter the overview", () => {
		vi.useFakeTimers();
		const { frame, overviews } = canvas();
		postFieldsOverview();
		scheduleFieldsOverview([change("PROPERTY_CHANGE", frame, ["x", "y"])]);
		vi.advanceTimersByTime(100);
		expect(overviews).toHaveLength(1);
	});
});
