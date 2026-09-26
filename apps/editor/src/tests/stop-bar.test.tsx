import type { Template } from "@freshcoat/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { updateElement } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import type { Gradient, Stop } from "~/panels/design/fills";
import { StopBar } from "~/panels/design/StopBar";
import { doc, geometryOf } from "./doc-fixture";

// The bar is 100px wide from x = 0 and 24px tall, so clientX is a percentage.
beforeEach(() => {
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
		left: 0,
		top: 0,
		right: 100,
		bottom: 24,
		width: 100,
		height: 24,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const BW: Stop[] = [
	{ offset: 0, color: "#000000" },
	{ offset: 1, color: "#ffffff" },
];

function Harness({
	initial,
	log,
}: {
	initial: Stop[];
	log: { field: string; stops: Stop[] }[];
}) {
	const [stops, setStops] = useState(initial);
	const [selected, setSelected] = useState(0);
	return (
		<>
			<StopBar
				stops={stops}
				selected={selected}
				onSelect={setSelected}
				onChange={(field, next) => {
					log.push({ field, stops: next });
					setStops(next);
				}}
			/>
			<output data-testid="selected">{selected}</output>
		</>
	);
}

function setup(initial: Stop[] = BW) {
	const log: { field: string; stops: Stop[] }[] = [];
	render(<Harness initial={initial} log={log} />);
	const bar = screen.getByTestId("stop-bar");
	const last = () => log.at(-1)?.stops;
	const selected = () => Number(screen.getByTestId("selected").textContent);
	return { log, bar, last, selected };
}

const press = (el: Element, x: number, y = 12) =>
	fireEvent.pointerDown(el, {
		button: 0,
		pointerId: 1,
		clientX: x,
		clientY: y,
	});
const move = (el: Element, x: number, y = 12) =>
	fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y });
const release = (el: Element, x: number, y = 12) =>
	fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y });

describe("StopBar", () => {
	it("adds a stop where the bar is clicked, coloured by interpolation", () => {
		const { bar, last, selected } = setup();
		press(bar, 25);
		release(bar, 25);
		expect(last()).toEqual([
			{ offset: 0, color: "#000000" },
			{ offset: 0.25, color: "#404040" },
			{ offset: 1, color: "#ffffff" },
		]);
		expect(selected()).toBe(1);
		expect(screen.getByRole("slider", { name: "Stop 2" })).toBe(
			document.activeElement,
		);
	});

	it("moves a dragged stop and keeps the stops in order", () => {
		const { bar, log, last, selected } = setup([
			...BW,
			{ offset: 0.5, color: "#ff0000" },
		]);
		const red = screen.getByRole("slider", { name: "Stop 3" });
		press(red, 50);
		move(bar, 60);
		move(bar, 90);
		release(bar, 90);
		expect(last()?.map((s) => s.offset)).toEqual([0, 0.9, 1]);
		expect(last()?.[1]?.color).toBe("#ff0000");
		expect(selected()).toBe(1);
		// One drag writes under one field, so the inspector merges it.
		expect(new Set(log.map((e) => e.field)).size).toBe(1);
	});

	it("clamps a drag to the bar's ends", () => {
		const { bar, last } = setup([...BW, { offset: 0.5, color: "#ff0000" }]);
		press(screen.getByRole("slider", { name: "Stop 3" }), 50);
		move(bar, -40);
		release(bar, -40);
		expect(last()?.map((s) => s.offset)).toEqual([0, 0, 1]);
		expect(last()?.[1]?.color).toBe("#ff0000");
	});

	it("removes a stop dragged well off the bar, and brings it back", () => {
		const { bar, last } = setup([...BW, { offset: 0.5, color: "#ff0000" }]);
		press(screen.getByRole("slider", { name: "Stop 3" }), 50);
		move(bar, 50, 120);
		expect(last()).toEqual(BW);
		move(bar, 40, 12);
		expect(last()?.map((s) => s.offset)).toEqual([0, 0.4, 1]);
		move(bar, 40, 120);
		release(bar, 40, 120);
		expect(last()).toEqual(BW);
	});

	it("never drags away one of the last two stops", () => {
		const { bar, last } = setup();
		press(screen.getByRole("slider", { name: "Stop 2" }), 100);
		move(bar, 70, 140);
		release(bar, 70, 140);
		expect(last()).toHaveLength(2);
	});

	it("moves the selected stop with the arrow keys, 1% or 10% with Shift", () => {
		const { last } = setup([...BW, { offset: 0.5, color: "#ff0000" }]);
		const red = screen.getByRole("slider", { name: "Stop 3" });
		act(() => red.focus());
		fireEvent.keyDown(red, { key: "ArrowRight" });
		expect(last()?.map((s) => s.offset)).toEqual([0, 0.51, 1]);
		const moved = screen.getByRole("slider", { name: "Stop 2" });
		expect(moved).toBe(document.activeElement);
		fireEvent.keyDown(moved, { key: "ArrowLeft", shiftKey: true });
		expect(last()?.map((s) => s.offset)).toEqual([0, 0.41, 1]);
	});

	it("deletes the selected stop with Delete, but keeps two", () => {
		const { last } = setup([...BW, { offset: 0.5, color: "#ff0000" }]);
		const red = screen.getByRole("slider", { name: "Stop 3" });
		act(() => red.focus());
		fireEvent.keyDown(red, { key: "Delete" });
		expect(last()).toEqual(BW);
		const first = screen.getByRole("slider", { name: "Stop 1" });
		act(() => first.focus());
		const event = fireEvent.keyDown(first, { key: "Backspace" });
		expect(last()).toEqual(BW);
		// Swallowed, so the layer's Delete shortcut never sees it.
		expect(event).toBe(false);
	});
});

describe("stop bar in the inspector", () => {
	const RECT = "0/0";
	const gradient: Gradient = { kind: "linear", angle: 0, stops: BW };

	function inspector() {
		let t: Template = doc();
		const r = updateElement(t, RECT, { properties: { fill: gradient } });
		if (r.ok) t = r.template;
		const c = new EditorController();
		c.open(t, "doc.coat");
		c.dispatch({
			type: "rendered",
			geometry: geometryOf(t),
			timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
			stats: {} as never,
			warnings: [],
		});
		c.select([RECT]);
		render(
			<ControllerProvider controller={c}>
				<DesignPanel />
			</ControllerProvider>,
		);
		const fill = () =>
			(
				getElement(c.template as Template, RECT)?.properties as {
					fill: Gradient;
				}
			).fill;
		return { c, fill };
	}

	it("makes one continuous drag one undo step", () => {
		const { c, fill } = inspector();
		const bar = screen.getByTestId("stop-bar");
		press(bar, 30);
		for (const x of [35, 40, 45, 50, 55]) move(bar, x);
		release(bar, 55);
		expect(fill().stops.map((s) => s.offset)).toEqual([0, 0.55, 1]);
		expect(c.state.doc?.history.past).toHaveLength(1);
		c.undo();
		expect(fill().stops).toEqual(BW);
	});

	it("marks the gradient it opened as the one the canvas edits", () => {
		const { c } = inspector();
		expect(c.state.activeFill).toBeNull();
		press(screen.getByTestId("stop-bar"), 30);
		expect(c.state.activeFill).toEqual({ key: RECT, index: 0 });
	});

	it("reverses the stops and turns a linear gradient a quarter", () => {
		const { fill } = inspector();
		fireEvent.click(
			screen.getByRole("button", { name: "Reverse fill 1 stops" }),
		);
		expect(fill().stops).toEqual([
			{ offset: 0, color: "#ffffff" },
			{ offset: 1, color: "#000000" },
		]);
		fireEvent.click(screen.getByRole("button", { name: "Rotate fill 1 90°" }));
		expect(fill()).toMatchObject({ kind: "linear", angle: 90 });
	});

	it("edits the selected stop's position below the bar", () => {
		const { fill } = inspector();
		press(screen.getByRole("slider", { name: "Stop 2" }), 100);
		release(screen.getByTestId("stop-bar"), 100);
		const pos = screen.getByRole("spinbutton", { name: "Stop position" });
		fireEvent.focus(pos);
		fireEvent.change(pos, { target: { value: "40" } });
		fireEvent.keyDown(pos, { key: "Enter" });
		expect(fill().stops.map((s) => s.offset)).toEqual([0, 0.4]);
	});
});
