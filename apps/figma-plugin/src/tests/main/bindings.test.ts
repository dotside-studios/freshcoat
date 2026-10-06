import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postSelectionDetail, scheduleSelectionDetail } from "~/main/bindings";
import { FIELD_KEY } from "~/main/plugin-data";
import type { SelectionDetailMessage } from "~/shared/protocol";

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
