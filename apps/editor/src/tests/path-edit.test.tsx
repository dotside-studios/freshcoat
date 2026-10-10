import type { Template, VectorElement } from "@freshcoat-js/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { findCommand } from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { ShortcutsDialog } from "~/app/ShortcutsDialog";
import { Viewport } from "~/canvas/Viewport";
import { getElement } from "~/doc/path";
import { frameToWorld, parseVectorPath, vectorFrame } from "~/doc/vector-edit";
import { doc, geometryOf } from "./doc-fixture";

vi.mock("~/canvas/use-live-render", () => ({
	useLiveRender: () => ({ canvas: null, scale: 1, fontsLoading: false }),
}));

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		disconnect() {}
	},
);

afterEach(cleanup);

const TRIANGLE = "M0 0L200 0L100 100Z";
const SMOOTH = "M0 0C30 0 70 50 100 50C130 50 170 0 200 0";

const vector = (
	d: string,
	extra: Partial<VectorElement> = {},
): VectorElement => ({
	id: "shape",
	type: "vector",
	pos: { x: 300, y: 330 },
	size: { width: 200, height: 100 },
	properties: { d, fill: "#000000" },
	...extra,
});

/** The fixture with a vector on the free part of the artboard (key `0/N`),
 *  one in the rotated frame and one in the auto-layout row. */
function withVector(d: string, extra: Partial<VectorElement> = {}) {
	const t = doc();
	const side = t.template_data[0] as NonNullable<Template["template_data"][0]>;
	const elements = side.elements.map((el) => {
		if (el.type !== "frame") return el;
		if (el.id === "spin" || el.id === "row")
			return {
				...el,
				properties: {
					...el.properties,
					children: [
						...el.properties.children,
						vector(d, { id: `in-${el.id}` }),
					],
				},
			};
		return el;
	});
	const key = `0/${elements.length}`;
	const next: Template = {
		...t,
		template_data: [
			{ ...side, elements: [...elements, vector(d, extra)] },
			...t.template_data.slice(1),
		],
	};
	return { t: next, key };
}

function mount(d = TRIANGLE, extra: Partial<VectorElement> = {}) {
	const { t, key } = withVector(d, extra);
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	c.setViewportSize(1200, 800);
	c.setView({ x: 0, y: 0, zoom: 1 });
	render(
		<ControllerProvider controller={c}>
			<Viewport />
		</ControllerProvider>,
	);
	return { c, key };
}

const viewport = () => screen.getByTestId("viewport");
const at = (x: number, y: number, mods: object = {}) => ({
	pointerId: 1,
	button: 0,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	...mods,
});
const NO_SNAP = { metaKey: true };
const click = (x: number, y: number, mods: object = {}) => {
	fireEvent.pointerDown(viewport(), at(x, y, mods));
	fireEvent.pointerUp(viewport(), at(x, y, mods));
};
const drag = (
	from: [number, number],
	to: [number, number],
	mods: object = {},
) => {
	fireEvent.pointerDown(viewport(), at(...from, mods));
	fireEvent.pointerMove(viewport(), at(...to, mods));
	fireEvent.pointerUp(viewport(), at(...to, mods));
};
const key = (name: string, mods: object = {}) =>
	fireEvent.keyDown(window, { key: name, ...mods });

const shape = (c: EditorController, k: string) =>
	getElement(c.base as Template, k) as VectorElement;
const d = (c: EditorController, k: string) => shape(c, k).properties.d;
const editing = (c: EditorController) => c.state.pathEdit !== null;

/** The anchors and handles of the vector as they paint, in template space. */
function painted(c: EditorController, k: string) {
	const el = shape(c, k);
	const frame = vectorFrame(c.template as Template, k, c.state.geometry);
	return parseVectorPath(el.properties.d).map((path) =>
		path.points.map((p) => ({
			anchor: frameToWorld(frame as never, p),
			in: p.in && frameToWorld(frame as never, p.in),
			out: p.out && frameToWorld(frame as never, p.out),
		})),
	);
}

const near = (
	a: { x: number; y: number } | undefined,
	x: number,
	y: number,
) => {
	expect(a?.x).toBeCloseTo(x, 1);
	expect(a?.y).toBeCloseTo(y, 1);
};

describe("entering and leaving path editing", () => {
	test("double-clicking a selected vector edits its points", () => {
		const { c, key: k } = mount();
		click(400, 400);
		expect(c.state.selection).toEqual([k]);
		expect(editing(c)).toBe(false);
		fireEvent.doubleClick(viewport(), at(400, 400));
		expect(c.state.pathEdit).toEqual({ key: k, selected: [] });
		const overlay = screen.getByTestId("path-edit");
		expect(overlay.getAttribute("data-points")).toBe("3");
		expect(screen.queryByTestId("handle-nw")).toBeNull();
	});

	test("Enter edits a single selected vector", () => {
		const { c, key: k } = mount();
		c.select([k]);
		const enter = findCommand(
			{
				key: "Enter",
				code: "Enter",
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
			},
			true,
			false,
		);
		void enter?.run({ controller: c } as never);
		expect(editing(c)).toBe(true);
	});

	test("other layers are not edited", () => {
		const { c } = mount();
		c.select(["0/0"]);
		expect(c.beginPathEdit()).toBe(false);
		expect(editing(c)).toBe(false);
	});

	test("Escape, Enter, a click on nothing, another tool or layer all end it", () => {
		const { c, key: k } = mount();
		const enter = () =>
			act(() => {
				c.select([k]);
				expect(c.beginPathEdit()).toBe(true);
			});
		enter();
		key("Escape");
		expect(editing(c)).toBe(false);
		expect(c.state.selection).toEqual([k]);
		enter();
		key("Enter");
		expect(editing(c)).toBe(false);
		enter();
		click(900, 580);
		expect(editing(c)).toBe(false);
		expect(c.state.selection).toEqual([]);
		enter();
		c.dispatch({ type: "setTool", tool: "rect" });
		expect(editing(c)).toBe(false);
		c.dispatch({ type: "setTool", tool: "move" });
		enter();
		c.select(["0/0"]);
		expect(editing(c)).toBe(false);
	});

	test("a click on another layer selects it as it would outside editing", () => {
		const { c, key: k } = mount();
		act(() => {
			c.select([k]);
			c.beginPathEdit();
		});
		click(60, 40);
		expect(editing(c)).toBe(false);
		expect(c.state.selection).toEqual(["0/0"]);
	});

	test("layers in auto layout or under a rotated parent are refused", () => {
		const { c } = mount();
		for (const refused of ["0/3/3", "0/6/1"]) {
			expect(getElement(c.base as Template, refused)?.id).toMatch(/^in-/);
			c.select([refused]);
			expect(c.beginPathEdit()).toBe(false);
			expect(editing(c)).toBe(false);
		}
	});
});

describe("editing points", () => {
	function begin(dd = TRIANGLE, extra: Partial<VectorElement> = {}) {
		const m = mount(dd, extra);
		act(() => {
			m.c.select([m.key]);
			m.c.beginPathEdit();
		});
		return m;
	}

	test("clicking picks a point, Shift adds one, nothing picks none", () => {
		const { c } = begin();
		click(300, 330);
		expect(c.state.pathEdit?.selected).toEqual([{ path: 0, index: 0 }]);
		click(500, 330, { shiftKey: true });
		expect(c.state.pathEdit?.selected).toHaveLength(2);
		click(500, 330, { shiftKey: true });
		expect(c.state.pathEdit?.selected).toEqual([{ path: 0, index: 0 }]);
		click(400, 430);
		expect(c.state.pathEdit?.selected).toEqual([{ path: 0, index: 2 }]);
		expect(
			screen.getByTestId("path-point-0-2").getAttribute("data-selected"),
		).toBe("true");
	});

	test("dragging a point moves it and refits the box, as one undo step", () => {
		const { c, key: k } = begin();
		const before = shape(c, k);
		drag([300, 330], [280, 320], NO_SNAP);
		expect(d(c, k)).toBe("M0 0L220 10L120 110Z");
		expect(shape(c, k).pos).toEqual({ x: 280, y: 320 });
		expect(shape(c, k).size).toEqual({ width: 220, height: 110 });
		expect(editing(c)).toBe(true);
		c.undo();
		expect(shape(c, k)).toEqual(before);
		c.redo();
		expect(d(c, k)).toBe("M0 0L220 10L120 110Z");
	});

	test("dragging picked points moves them together", () => {
		const { c, key: k } = begin();
		click(300, 330);
		click(500, 330, { shiftKey: true });
		drag([500, 330], [500, 360], NO_SNAP);
		const [pts] = painted(c, k);
		near(pts?.[0]?.anchor, 300, 360);
		near(pts?.[1]?.anchor, 500, 360);
		near(pts?.[2]?.anchor, 400, 430);
	});

	test("Shift keeps a drag on 45° lines from where it began", () => {
		const { c, key: k } = begin();
		drag([300, 330], [350, 340], { shiftKey: true });
		const [pts] = painted(c, k);
		near(pts?.[0]?.anchor, 300 + Math.hypot(50, 10), 330);
	});

	test("a point snaps to other layers unless Mod is held", () => {
		const { c, key: k } = begin();
		drag([300, 330], [268, 331]);
		const snapped = painted(c, k)[0]?.[0]?.anchor;
		expect(snapped?.x).not.toBeCloseTo(268, 1);
		expect(snapped?.y).toBeCloseTo(330, 1);
		c.undo();
		drag([300, 330], [268, 331], NO_SNAP);
		near(painted(c, k)[0]?.[0]?.anchor, 268, 331);
	});

	test("dragging a smooth point's handle mirrors the other, Alt moves one", () => {
		const { c, key: k } = begin(SMOOTH, { fill: undefined } as never);
		drag([430, 380], [430, 420], NO_SNAP);
		let mid = painted(c, k)[0]?.[1];
		near(mid?.out, 430, 420);
		near(mid?.in, 370, 340);
		c.undo();
		drag([430, 380], [430, 420], { ...NO_SNAP, altKey: true });
		mid = painted(c, k)[0]?.[1];
		near(mid?.out, 430, 420);
		near(mid?.in, 370, 380);
	});

	test("Shift holds a handle to 45° lines", () => {
		const { c, key: k } = begin(SMOOTH);
		drag([430, 380], [470, 390], { ...NO_SNAP, shiftKey: true });
		const mid = painted(c, k)[0]?.[1];
		near(mid?.out, 400 + Math.hypot(70, 10), 380);
	});

	test("double-clicking a point toggles corner and smooth", () => {
		const { c, key: k } = begin();
		expect(d(c, k)).not.toContain("C");
		fireEvent.doubleClick(viewport(), at(300, 330));
		expect(d(c, k)).toContain("C");
		const smooth = d(c, k);
		fireEvent.doubleClick(viewport(), at(300, 330));
		expect(d(c, k)).toBe(TRIANGLE);
		c.undo();
		expect(d(c, k)).toBe(smooth);
	});

	test("Alt-clicking a point toggles it too", () => {
		const { c, key: k } = begin();
		click(500, 330, { altKey: true });
		expect(d(c, k)).toContain("C");
		click(500, 330, { altKey: true });
		expect(d(c, k)).toBe(TRIANGLE);
	});

	test("clicking the path adds a point without changing its shape", () => {
		const { c, key: k } = begin();
		fireEvent.pointerMove(viewport(), at(400, 331));
		expect(screen.getByTestId("path-hover")).toBeTruthy();
		click(400, 331);
		expect(d(c, k)).toBe("M0 0L100 0L200 0L100 100Z");
		expect(c.state.pathEdit?.selected).toEqual([{ path: 0, index: 1 }]);
		c.undo();
		expect(d(c, k)).toBe(TRIANGLE);
		fireEvent.pointerMove(viewport(), at(400, 380));
		expect(screen.queryByTestId("path-hover")).toBeNull();
	});

	test("a point added on a curve keeps the curve", () => {
		const { c, key: k } = begin(SMOOTH);
		const before = painted(c, k)[0];
		click(350, 355);
		const after = painted(c, k)[0];
		expect(after).toHaveLength(4);
		near(after?.[1]?.anchor, 350, 355);
		near(after?.[0]?.anchor, 300, 330);
		near(after?.[3]?.anchor, 500, 330);
		near(
			after?.[2]?.anchor,
			before?.[1]?.anchor.x ?? 0,
			before?.[1]?.anchor.y ?? 0,
		);
	});

	test("Backspace removes the picked points", () => {
		const { c, key: k } = begin();
		click(500, 330);
		key("Backspace");
		expect(d(c, k)).toBe("M0 0L100 100Z");
		expect(c.state.pathEdit?.selected).toEqual([]);
		c.undo();
		expect(d(c, k)).toBe(TRIANGLE);
	});

	test("removing every point deletes the layer and ends editing", () => {
		const { c, key: k } = begin();
		const count = c.base?.template_data[0]?.elements.length as number;
		click(300, 330);
		click(500, 330, { shiftKey: true });
		click(400, 430, { shiftKey: true });
		key("Delete");
		expect(editing(c)).toBe(false);
		expect(c.base?.template_data[0]?.elements).toHaveLength(count - 1);
		c.undo();
		expect(getElement(c.base as Template, k)).toBeDefined();
	});

	test("without picked points Backspace is left to the editor", () => {
		const { c } = begin();
		const event = new KeyboardEvent("keydown", {
			key: "Backspace",
			cancelable: true,
		});
		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		expect(editing(c)).toBe(true);
	});

	test("arrow keys nudge picked points, each an undo step", () => {
		const { c, key: k } = begin();
		click(300, 330);
		key("ArrowRight");
		near(painted(c, k)[0]?.[0]?.anchor, 301, 330);
		key("ArrowDown", { shiftKey: true });
		near(painted(c, k)[0]?.[0]?.anchor, 301, 340);
		c.undo();
		near(painted(c, k)[0]?.[0]?.anchor, 301, 330);
		c.undo();
		near(painted(c, k)[0]?.[0]?.anchor, 300, 330);
		expect(editing(c)).toBe(true);
	});

	test("Escape during a drag takes it back and stays in editing", () => {
		const { c, key: k } = begin();
		fireEvent.pointerDown(viewport(), at(300, 330, NO_SNAP));
		fireEvent.pointerMove(viewport(), at(260, 300, NO_SNAP));
		expect(d(c, k)).not.toBe(TRIANGLE);
		key("Escape");
		expect(d(c, k)).toBe(TRIANGLE);
		expect(editing(c)).toBe(true);
	});

	test("every subpath of a path is editable", () => {
		const { c, key: k } = begin("M0 0L50 0L50 50ZM100 0L200 0L200 100Z");
		expect(screen.getByTestId("path-edit").getAttribute("data-points")).toBe(
			"6",
		);
		drag([400, 330], [400, 350], NO_SNAP);
		const paths = painted(c, k);
		near(paths[1]?.[0]?.anchor, 400, 350);
		near(paths[0]?.[0]?.anchor, 300, 330);
	});

	test("a rotated vector is edited in its own turned frame", () => {
		const { c, key: k } = begin(TRIANGLE, { rotation: 90 });
		const [pts] = painted(c, k);
		near(pts?.[0]?.anchor, 450, 280);
		drag([450, 280], [450, 260], NO_SNAP);
		const after = painted(c, k)[0];
		near(after?.[0]?.anchor, 450, 260);
		near(after?.[1]?.anchor, pts?.[1]?.anchor.x ?? 0, pts?.[1]?.anchor.y ?? 0);
		near(after?.[2]?.anchor, pts?.[2]?.anchor.x ?? 0, pts?.[2]?.anchor.y ?? 0);
		expect(shape(c, k).rotation).toBe(90);
		c.undo();
		near(painted(c, k)[0]?.[0]?.anchor, 450, 280);
	});

	test("nudging a rotated vector moves points along the canvas's axes", () => {
		const { c, key: k } = begin(TRIANGLE, { rotation: 90 });
		click(450, 280);
		key("ArrowRight", { shiftKey: true });
		near(painted(c, k)[0]?.[0]?.anchor, 460, 280);
	});
});

describe("continuing a path with the pen", () => {
	const OPEN = "M0 0L100 50L200 0";
	function pen(dd = OPEN) {
		const m = mount(dd, {
			size: { width: 200, height: 50 },
			properties: { d: dd, stroke: { color: "#000000", width: 2 } },
		});
		act(() => {
			m.c.select([m.key]);
			m.c.dispatch({ type: "setTool", tool: "pen" });
		});
		return m;
	}
	const draftPoints = () =>
		screen.getByTestId("pen-draft").getAttribute("data-points");

	test("clicking the end anchor carries the path on, as one undo step", () => {
		const { c, key: k } = pen();
		const layers = c.base?.template_data[0]?.elements.length as number;
		click(500, 330, NO_SNAP);
		expect(draftPoints()).toBe("3");
		click(550, 400, NO_SNAP);
		expect(draftPoints()).toBe("4");
		key("Enter");
		expect(c.base?.template_data[0]?.elements).toHaveLength(layers);
		expect(c.state.tool).toBe("move");
		expect(c.state.selection).toEqual([k]);
		const [pts] = painted(c, k);
		expect(pts).toHaveLength(4);
		near(pts?.[3]?.anchor, 550, 400);
		near(pts?.[0]?.anchor, 300, 330);
		near(pts?.[2]?.anchor, 500, 330);
		c.undo();
		expect(d(c, k)).toBe(OPEN);
	});

	test("the start anchor continues backwards and keeps the path's direction", () => {
		const { c, key: k } = pen();
		click(300, 330, NO_SNAP);
		click(250, 300, NO_SNAP);
		key("Enter");
		const [pts] = painted(c, k);
		expect(pts).toHaveLength(4);
		near(pts?.[0]?.anchor, 250, 300);
		near(pts?.[1]?.anchor, 300, 330);
		near(pts?.[3]?.anchor, 500, 330);
	});

	test("clicking the other end closes the path", () => {
		const { c, key: k } = pen();
		click(500, 330, NO_SNAP);
		click(400, 430, NO_SNAP);
		click(300, 330, NO_SNAP);
		expect(d(c, k)).toMatch(/Z$/);
		expect(parseVectorPath(d(c, k))[0]?.points).toHaveLength(4);
	});

	test("a click elsewhere starts a new layer as before", () => {
		const { c } = pen();
		const layers = c.base?.template_data[0]?.elements.length as number;
		click(100, 500, NO_SNAP);
		click(200, 500, NO_SNAP);
		key("Enter");
		expect(c.base?.template_data[0]?.elements).toHaveLength(layers + 1);
	});

	test("a closed path is not continued", () => {
		pen(TRIANGLE);
		click(300, 330, NO_SNAP);
		expect(screen.queryByTestId("pen-draft")).toBeTruthy();
		expect(draftPoints()).toBe("1");
	});

	test("finishing without adding a point changes nothing", () => {
		const { c, key: k } = pen();
		const before = c.base;
		click(500, 330, NO_SNAP);
		key("Enter");
		expect(c.base).toBe(before);
		expect(d(c, k)).toBe(OPEN);
	});
});

describe("path editing in the shortcuts sheet", () => {
	test("lists the editing gestures", () => {
		render(<ShortcutsDialog isOpen onOpenChange={() => {}} />);
		const path = screen.getByRole("heading", { name: "Path" })
			.parentElement as HTMLElement;
		for (const label of [
			"Finish editing points",
			"Add a point",
			"Remove points",
			"Toggle corner and smooth",
			"Move one handle only",
		])
			expect(within(path).getByText(label)).toBeTruthy();
		expect(within(path).getAllByText("Edit path points")).toHaveLength(2);
	});
});
