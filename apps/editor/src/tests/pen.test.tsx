import type { Template, VectorElement } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { findCommand } from "~/app/commands";
import { EditorController } from "~/app/controller";
import { ShortcutsDialog } from "~/app/ShortcutsDialog";
import { getElement } from "~/doc/path";
import {
	constrain45,
	PEN_STROKE,
	type PenPath,
	penBounds,
	penElement,
	penPathData,
	smoothPoint,
} from "~/doc/pen";
import { doc } from "./doc-fixture";

afterEach(cleanup);

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
	});
});
