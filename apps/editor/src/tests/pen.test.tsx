import type { Template, VectorElement } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import {
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
import { DEFAULT_FILL } from "~/doc/factories";
import { applyRect } from "~/doc/geometry";
import { updateElement } from "~/doc/ops";
import { getElement, parentKeyOf } from "~/doc/path";
import {
	closePoint,
	constrain45,
	dragPoint,
	PEN_STROKE,
	type PenPath,
	penBounds,
	penElement,
	penPathData,
	smoothPoint,
	snapPenPoint,
} from "~/doc/pen";
import { doc, geometryOf } from "./doc-fixture";

const pointer = vi.hoisted(() => ({ coarse: false }));

vi.mock("@freshcoat-js/ui/data-table", async (orig) => ({
	...(await orig<object>()),
	useCoarsePointer: () => pointer.coarse,
}));

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

afterEach(() => {
	cleanup();
	pointer.coarse = false;
});

const corners: PenPath = {
	closed: false,
	points: [
		{ x: 10, y: 20 },
		{ x: 110, y: 20 },
		{ x: 60, y: 80 },
	],
};

describe("pen paths", () => {
	test("corner points are lines, relative to the origin", () => {
		expect(penPathData(corners)).toBe("M10 20L110 20L60 80");
		expect(penPathData(corners, { x: 10, y: 20 })).toBe("M0 0L100 0L50 60");
		expect(penPathData({ ...corners, closed: true }, { x: 10, y: 20 })).toBe(
			"M0 0L100 0L50 60Z",
		);
		expect(penBounds(corners)).toEqual({
			x: 10,
			y: 20,
			width: 100,
			height: 60,
			rotation: 0,
		});
	});

	test("a dragged point is smooth, its handles mirrored", () => {
		expect(smoothPoint({ x: 50, y: 50 }, { x: 80, y: 40 })).toEqual({
			x: 50,
			y: 50,
			out: { x: 80, y: 40 },
			in: { x: 20, y: 60 },
		});
		const path: PenPath = {
			closed: false,
			points: [
				{ x: 0, y: 100 },
				smoothPoint({ x: 100, y: 100 }, { x: 150, y: 0 }),
			],
		};
		expect(penPathData(path)).toBe("M0 100C0 100 50 200 100 100");
	});

	test("bounds reach a curve's extremes, not its handles", () => {
		const path: PenPath = {
			closed: false,
			points: [
				{ x: 0, y: 0, out: { x: 0, y: -100 } },
				{ x: 100, y: 0, in: { x: 100, y: -100 } },
			],
		};
		const b = penBounds(path);
		expect(b.y).toBeCloseTo(-75, 5);
		expect(b.height).toBeCloseTo(75, 5);
		expect(b.width).toBe(100);
	});

	test("a closing curve is drawn back to the first point", () => {
		const path: PenPath = {
			closed: true,
			points: [
				{ x: 0, y: 0, in: { x: -10, y: 10 } },
				{ x: 100, y: 0 },
			],
		};
		expect(penPathData(path)).toBe("M0 0L100 0C100 0 -10 10 0 0Z");
	});

	test("Alt drags only the outgoing handle, keeping the incoming one", () => {
		const anchor = { x: 50, y: 50 };
		const drag = { x: 80, y: 40 };
		expect(dragPoint(anchor, drag, undefined, false)).toEqual(
			smoothPoint(anchor, drag),
		);
		expect(dragPoint(anchor, drag, { ...anchor }, true)).toEqual({
			x: 50,
			y: 50,
			out: drag,
		});
		const smooth = smoothPoint(anchor, { x: 60, y: 50 });
		expect(dragPoint(anchor, drag, smooth, true)).toEqual({
			x: 50,
			y: 50,
			out: drag,
			in: { x: 40, y: 50 },
		});
	});

	test("Alt while closing shapes only the incoming handle", () => {
		const anchor = { x: 0, y: 0 };
		const drag = { x: 10, y: 20 };
		expect(closePoint(anchor, drag, anchor, false)).toEqual(
			smoothPoint(anchor, drag),
		);
		expect(
			closePoint(anchor, drag, { ...anchor, out: { x: 30, y: 0 } }, true),
		).toEqual({ x: 0, y: 0, out: { x: 30, y: 0 }, in: { x: -10, y: -20 } });
		expect(closePoint(anchor, drag, anchor, true)).toEqual({
			x: 0,
			y: 0,
			in: { x: -10, y: -20 },
		});
	});

	test("anchors snap to candidates and to placed anchors", () => {
		const candidates = {
			x: [{ value: 100, from: 0, to: 200 }],
			y: [{ value: 40, from: 0, to: 200 }],
		};
		const near = snapPenPoint({ x: 102, y: 90 }, candidates, [], 5);
		expect(near.point).toEqual({ x: 100, y: 90 });
		expect(near.guides).toHaveLength(1);
		const anchored = snapPenPoint(
			{ x: 31, y: 43 },
			candidates,
			[{ x: 30, y: 300 }],
			5,
		);
		expect(anchored.point).toEqual({ x: 30, y: 40 });
		expect(anchored.guides).toHaveLength(2);
		expect(snapPenPoint({ x: 70, y: 90 }, candidates, [], 5).point).toEqual({
			x: 70,
			y: 90,
		});
	});

	test("Shift keeps a segment on 45° lines", () => {
		const p = constrain45({ x: 0, y: 0 }, { x: 100, y: 10 });
		expect(p.x).toBeCloseTo(Math.hypot(100, 10));
		expect(p.y).toBeCloseTo(0);
		const d = constrain45({ x: 0, y: 0 }, { x: 50, y: 60 });
		expect(d.x).toBeCloseTo(d.y);
	});

	test("becomes a vector layer: open ones stroked, closed ones filled", () => {
		const t = doc();
		expect(penElement({ closed: false, points: [{ x: 1, y: 1 }] }, t, 0)).toBe(
			null,
		);
		const open = penElement(corners, t, 0) as VectorElement;
		expect(open).toMatchObject({
			type: "vector",
			pos: { x: 10, y: 20 },
			size: { width: 100, height: 60 },
			properties: { d: "M0 0L100 0L50 60", stroke: PEN_STROKE },
		});
		expect(open.properties.fill).toBeUndefined();
		const closed = penElement(
			{ ...corners, closed: true },
			t,
			0,
		) as VectorElement;
		expect(closed.properties.fill).toBeDefined();
		expect(closed.properties.stroke).toBeUndefined();
		const line = penElement(
			{
				closed: false,
				points: [
					{ x: 0, y: 5 },
					{ x: 50, y: 5 },
				],
			},
			t,
			0,
		);
		expect(line?.size).toEqual({ width: 50, height: 1 });
	});

	test("uses the given style instead of the defaults", () => {
		const stroke = { color: "#ff0000", width: 6 };
		const open = penElement(corners, doc(), 0, { stroke, fill: "#00ff00" });
		expect((open as VectorElement).properties).toMatchObject({ stroke });
		expect((open as VectorElement).properties.fill).toBeUndefined();
		const closed = penElement({ ...corners, closed: true }, doc(), 0, {
			stroke,
			fill: "#00ff00",
		}) as VectorElement;
		expect(closed.properties.fill).toBe("#00ff00");
		expect(closed.properties.stroke).toBeUndefined();
	});

	test("a barely spanned axis is flat, so a later resize keeps the slope", () => {
		const t = doc();
		const el = penElement(
			{
				closed: false,
				points: [
					{ x: 0, y: 5 },
					{ x: 50, y: 5.3 },
				],
			},
			t,
			0,
		) as VectorElement;
		expect(el.properties.d).toBe("M0 0L50 0");
		const at = {
			...t,
			template_data: [{ ...t.template_data[0], elements: [el] }],
		};
		const key = "0/0";
		const rect = { x: 0, y: 5, width: 100, height: 40, rotation: 0 };
		const g = geometryOf(at as Template);
		const out = applyRect(at as Template, key, rect, g);
		if (!out.ok) throw new Error(out.reason);
		const next = getElement(out.template, key) as VectorElement;
		expect(next.properties.d).toBe("M0 0L100 0");
	});
});

describe("pen tool", () => {
	test("P picks it, and a finished path is one selected, undoable layer", () => {
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		const cmd = findCommand(
			{
				key: "p",
				code: "KeyP",
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
			},
			true,
			false,
		);
		expect(cmd?.id).toBe("tool.pen");
		void cmd?.run({ controller: c } as never);
		expect(c.state.tool).toBe("pen");
		const count = c.base?.template_data[0]?.elements.length ?? 0;
		const key = c.createPath({ ...corners, closed: true });
		expect(key).toBe(`0/${count}`);
		expect(c.state.selection).toEqual([key]);
		expect(c.state.tool).toBe("move");
		const el = getElement(c.base as Template, key as string) as VectorElement;
		expect(el.properties.d).toBe("M0 0L100 0L50 60Z");
		expect(validate(c.base as Template).ok).toBe(true);
		c.undo();
		expect(c.base?.template_data[0]?.elements).toHaveLength(count);
	});

	test("a path finished by picking another tool keeps that tool", () => {
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		c.dispatch({ type: "setTool", tool: "rect" });
		expect(c.createPath(corners)).not.toBeNull();
		expect(c.state.tool).toBe("rect");
	});

	test("is in the shortcuts sheet with how to finish a path", () => {
		render(<ShortcutsDialog isOpen onOpenChange={() => {}} />);
		const tools = screen.getByRole("heading", { name: "Tools" })
			.parentElement as HTMLElement;
		expect(within(tools).getByText("Pen")).toBeTruthy();
		expect(within(tools).getByText("Finish path")).toBeTruthy();
		expect(within(tools).getByText("Break handles")).toBeTruthy();
		expect(within(tools).getByText("Undo last point")).toBeTruthy();
	});
});

describe("pen gestures", () => {
	function mount() {
		const t = doc();
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
		c.dispatch({ type: "setTool", tool: "pen" });
		render(
			<ControllerProvider controller={c}>
				<Viewport />
			</ControllerProvider>,
		);
		return c;
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
	const click = (x: number, y: number, mods: object = {}) => {
		fireEvent.pointerDown(viewport(), at(x, y, mods));
		fireEvent.pointerUp(viewport(), at(x, y, mods));
	};
	const points = () =>
		screen.getByTestId("pen-draft").getAttribute("data-points");
	const circles = () =>
		screen.getByTestId("pen-draft").querySelectorAll("circle");
	const created = (c: EditorController) =>
		getElement(
			c.base as Template,
			c.state.selection[0] as string,
		) as VectorElement;

	test("anchors snap to the artboard edge unless Shift or Mod is held", () => {
		const c = mount();
		click(3, 200);
		click(100, 100, { metaKey: true });
		fireEvent.keyDown(window, { key: "Enter" });
		expect(created(c).properties.d).toBe("M0 100L100 0");
	});

	test("Cmd+Z takes back the last point and never undoes the document", () => {
		const c = mount();
		const before = c.base;
		click(100, 100, { metaKey: true });
		click(200, 100, { metaKey: true });
		expect(points()).toBe("2");
		fireEvent.keyDown(window, { key: "z", metaKey: true });
		expect(points()).toBe("1");
		fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
		expect(points()).toBe("1");
		expect(c.base).toBe(before);
	});

	test("Alt-drag breaks the handles, so only the outgoing one shows", () => {
		mount();
		const mods = { metaKey: true };
		fireEvent.pointerDown(viewport(), at(100, 100, mods));
		fireEvent.pointerMove(viewport(), at(160, 100, { ...mods, altKey: true }));
		expect(circles()).toHaveLength(1);
		fireEvent.pointerMove(viewport(), at(160, 100, mods));
		expect(circles()).toHaveLength(2);
		fireEvent.pointerMove(viewport(), at(170, 100, { ...mods, altKey: true }));
		expect(circles()).toHaveLength(2);
	});

	test("dragging from the first point closes the path with a curve", () => {
		const c = mount();
		click(100, 100, { metaKey: true });
		click(300, 100, { metaKey: true });
		click(200, 300, { metaKey: true });
		fireEvent.pointerDown(viewport(), at(100, 100, { metaKey: true }));
		fireEvent.pointerMove(viewport(), at(60, 60, { metaKey: true }));
		fireEvent.pointerUp(viewport(), at(60, 60, { metaKey: true }));
		const el = created(c);
		expect(c.state.tool).toBe("move");
		expect(el.properties.fill).toBeDefined();
		expect(el.properties.d).toMatch(/^M.*C.*Z$/);
	});

	test("a plain click on the first point closes without curves", () => {
		const c = mount();
		click(100, 100, { metaKey: true });
		click(300, 100, { metaKey: true });
		click(200, 300, { metaKey: true });
		click(101, 100, { metaKey: true });
		expect(created(c).properties.d).toMatch(/^M[^C]*Z$/);
	});

	test("the draft previews the stroke an open path will get, scaled by zoom", () => {
		const c = mount();
		c.setView({ x: 0, y: 0, zoom: 2 });
		click(100, 100, { metaKey: true });
		click(300, 100, { metaKey: true });
		const preview = screen.getByTestId("pen-preview");
		expect(preview.getAttribute("stroke")).toBe(PEN_STROKE.color);
		expect(preview.getAttribute("stroke-width")).toBe(
			String(PEN_STROKE.width * 2),
		);
		expect(preview.getAttribute("fill")).toBe("none");
	});

	test("the draft previews the fill once the path will close", () => {
		mount();
		click(100, 100, { metaKey: true });
		click(300, 100, { metaKey: true });
		click(200, 300, { metaKey: true });
		expect(screen.getByTestId("pen-preview").getAttribute("fill")).toBe("none");
		fireEvent.pointerMove(viewport(), at(103, 100, { metaKey: true }));
		const preview = screen.getByTestId("pen-preview");
		expect(preview.getAttribute("fill")).toBe(DEFAULT_FILL);
		expect(preview.getAttribute("stroke")).toBe("none");
	});

	test("a path drawn in a selected frame goes into it, in its space", () => {
		const c = mount();
		c.select(["0/1"]);
		click(250, 150, { metaKey: true });
		click(400, 250, { metaKey: true });
		fireEvent.keyDown(window, { key: "Enter" });
		const key = c.state.selection[0] as string;
		expect(parentKeyOf(key)).toBe("0/1");
		expect(created(c).pos).toEqual({ x: 50, y: 50 });
	});

	test("a path starting outside the selected frame goes on the side", () => {
		const c = mount();
		c.select(["0/1"]);
		click(600, 500, { metaKey: true });
		click(700, 550, { metaKey: true });
		fireEvent.keyDown(window, { key: "Enter" });
		expect(parentKeyOf(c.state.selection[0] as string)).toBeNull();
	});

	test("a coarse pointer closes from further away and gets bigger anchors", () => {
		const first = mount();
		click(100, 100, { metaKey: true });
		click(300, 100, { metaKey: true });
		click(200, 300, { metaKey: true });
		click(112, 100, { metaKey: true });
		expect(points()).toBe("4");
		expect(first.state.tool).toBe("pen");
		const small = screen
			.getByTestId("pen-draft")
			.querySelector("rect")
			?.getAttribute("width");
		cleanup();

		pointer.coarse = true;
		const c = mount();
		click(100, 100, { metaKey: true });
		click(300, 100, { metaKey: true });
		click(200, 300, { metaKey: true });
		fireEvent.pointerMove(viewport(), at(112, 100, { metaKey: true }));
		const big = screen
			.getByTestId("pen-draft")
			.querySelector("rect")
			?.getAttribute("width");
		expect(Number(big)).toBeGreaterThan(Number(small));
		click(112, 100, { metaKey: true });
		expect(created(c).properties.fill).toBeDefined();
	});

	test("new paths reuse the stroke and fill last set on a pen layer", () => {
		const c = mount();
		const open = c.createPath(corners) as string;
		c.edit(
			(t) =>
				updateElement(t, open, {
					properties: { stroke: { color: "#ff0000", width: 9 } },
				}),
			{ scope: "base" },
		);
		const closed = c.createPath({ ...corners, closed: true }) as string;
		c.edit(
			(t) => updateElement(t, closed, { properties: { fill: "#0000ff" } }),
			{
				scope: "base",
			},
		);
		const next = c.createPath(corners) as string;
		const after = c.base as Template;
		expect(
			(getElement(after, next) as VectorElement).properties.stroke,
		).toEqual({
			color: "#ff0000",
			width: 9,
		});
		const filled = c.createPath({ ...corners, closed: true }) as string;
		expect(
			(getElement(c.base as Template, filled) as VectorElement).properties.fill,
		).toBe("#0000ff");
	});
});
