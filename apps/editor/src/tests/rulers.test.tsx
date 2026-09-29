import type { Template } from "@freshcoat-js/coatfile";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { COMMAND_BY_ID, findCommand } from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { Rulers } from "~/canvas/Rulers";
import {
	majorStep,
	rulerLabel,
	rulerTicks,
	selectionExtent,
} from "~/canvas/rulers";
import { doc, geometryOf } from "./doc-fixture";

function open(t: Template = doc()) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	return c;
}

afterEach(cleanup);

describe("ruler ticks", () => {
	test("labels stay at least 56 screen px apart on a 1, 2, 5 step", () => {
		expect(majorStep(1)).toBe(100);
		expect(majorStep(0.5)).toBe(200);
		expect(majorStep(2)).toBe(50);
		expect(majorStep(8)).toBe(10);
		expect(majorStep(0.02)).toBe(5000);
		for (const zoom of [0.02, 0.1, 0.33, 1, 3, 17, 64])
			expect(majorStep(zoom) * zoom).toBeGreaterThanOrEqual(56);
	});

	test("follow the view's origin and zoom", () => {
		const ticks = rulerTicks(40, 1, 400);
		const majors = ticks.filter((t) => t.major);
		expect(majors.map((t) => t.value)).toEqual([0, 100, 200, 300]);
		expect(majors.map((t) => t.at)).toEqual([40, 140, 240, 340]);
		const zoomed = rulerTicks(-500, 2, 300).filter((t) => t.major);
		expect(zoomed[0]?.value).toBe(250);
		expect(zoomed[0]?.at).toBe(0);
	});

	test("minor ticks divide a step when there is room", () => {
		const ticks = rulerTicks(0, 1, 100);
		expect(ticks.filter((t) => !t.major).length).toBeGreaterThan(0);
		expect(
			ticks.every((t, i) => i === 0 || t.at > (ticks[i - 1]?.at ?? 0)),
		).toBe(true);
	});

	test("labels read as design px", () => {
		expect(rulerLabel(-0)).toBe("0");
		expect(rulerLabel(0.1 + 0.2)).toBe("0.3");
		expect(rulerLabel(-250)).toBe("-250");
	});

	test("the selection's extent is its painted bounds", () => {
		const t = doc();
		const geometry = geometryOf(t);
		expect(selectionExtent([], geometry)).toBeNull();
		expect(selectionExtent(["0/0"], geometry)).toEqual({
			x: [10, 110],
			y: [20, 70],
		});
	});
});

describe("rulers", () => {
	test("Shift+R toggles them", () => {
		const c = open();
		const cmd = findCommand(
			{
				key: "R",
				code: "KeyR",
				shiftKey: true,
				metaKey: false,
				ctrlKey: false,
				altKey: false,
			},
			true,
			false,
		);
		expect(cmd?.id).toBe("view.rulers");
		expect(c.state.rulers).toBe(false);
		void COMMAND_BY_ID.get("view.rulers")?.run({ controller: c } as never);
		expect(c.state.rulers).toBe(true);
		void COMMAND_BY_ID.get("view.rulers")?.run({ controller: c } as never);
		expect(c.state.rulers).toBe(false);
	});

	test("draw the selection's extent and follow the view", () => {
		const c = open();
		render(
			<ControllerProvider controller={c}>
				<Rulers />
			</ControllerProvider>,
		);
		expect(screen.queryByTestId("ruler-x")).toBeNull();
		act(() => {
			c.dispatch({ type: "setRulers", on: true });
			c.setView({ x: 30, y: 40, zoom: 2 });
			c.select(["0/0"]);
		});
		const x = screen.getByTestId("ruler-x");
		expect(x.dataset.origin).toBe("30");
		expect(x.dataset.zoom).toBe("2");
		expect(screen.getByTestId("ruler-y").dataset.origin).toBe("40");
		const band = screen.getByTestId("ruler-x-selection");
		expect(band.getAttribute("data-from")).toBe("10");
		expect(band.getAttribute("data-to")).toBe("110");
		expect(band.getAttribute("x")).toBe("50");
		act(() => c.select([]));
		expect(screen.queryByTestId("ruler-x-selection")).toBeNull();
	});

	test("stay on when the workspace closes", () => {
		const c = open();
		c.dispatch({ type: "setRulers", on: true });
		c.close();
		expect(c.state.rulers).toBe(true);
	});
});
