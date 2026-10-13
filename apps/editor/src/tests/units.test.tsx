import type { Element, Template } from "@freshcoat-js/coatfile";
import { newPreset } from "@freshcoat-js/workspace";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { COMMAND_BY_ID } from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import {
	documentDpi,
	getDisplayUnit,
	parseLengthInput,
	setDisplayUnit,
	UNITS_STORAGE_KEY,
} from "~/app/units";
import { Rulers } from "~/canvas/Rulers";
import { majorStep, rulerTicks } from "~/canvas/ruler-geometry";
import { customSize } from "~/doc/new-document";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { spinbutton } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const MM = 300 / 25.4;

function cr80(): Template {
	const t = doc();
	const a = t.template_data[0]?.elements[0] as Element;
	a.pos = { x: 0, y: 0 };
	a.size = { width: 1012, height: 638 };
	return t;
}

function open(t: Template = cr80()) {
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

function type(input: HTMLElement, value: string) {
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value } });
	fireEvent.keyDown(input, { key: "Enter" });
}

const width = (c: EditorController) =>
	(getElement(c.template as Template, "0/0") as Element).size?.width;

afterEach(() => {
	cleanup();
	setDisplayUnit("px");
	localStorage.clear();
});

describe("display unit", () => {
	test("is remembered per user and set from the View menu", () => {
		expect(getDisplayUnit()).toBe("px");
		void COMMAND_BY_ID.get("view.units.mm")?.run({} as never);
		expect(getDisplayUnit()).toBe("mm");
		expect(localStorage.getItem(UNITS_STORAGE_KEY)).toBe("mm");
		void COMMAND_BY_ID.get("view.units.px")?.run({} as never);
		expect(localStorage.getItem(UNITS_STORAGE_KEY)).toBeNull();
	});

	test("converts at the active template's export DPI", () => {
		const c = open();
		expect(documentDpi(c.state)).toBe(300);
		const id = c.state.workspace?.activeTemplateId ?? "";
		const preset = { ...newPreset(id, []), dpi: 600 };
		c.dispatch({ type: "setPreset", preset });
		expect(documentDpi(c.state)).toBe(600);
	});
});

describe("unit rulers", () => {
	test("step 1, 5 or 10 mm", () => {
		expect(majorStep(MM, "mm")).toBe(5);
		expect(majorStep(MM * 3, "mm")).toBe(2);
		expect(majorStep(MM / 2, "mm")).toBe(10);
		const ticks = rulerTicks(0, 1, 1012, "mm", MM);
		const majors = ticks.filter((t) => t.major).map((t) => t.value);
		expect(majors.slice(0, 4)).toEqual([0, 5, 10, 15]);
		expect(ticks.filter((t) => !t.major)[0]?.value).toBe(0.5);
		const zoomed = rulerTicks(0, 3, 1012, "mm", MM).filter((t) => !t.major);
		expect(zoomed[0]?.value).toBe(0.2);
		const out = rulerTicks(0, 0.25, 1012, "mm", MM).filter((t) => !t.major);
		expect(out[0]?.value).toBe(2);
		expect(ticks.find((t) => t.value === 85)?.at).toBeCloseTo(85 * MM, 6);
	});

	test("step in halves of an inch down to 1/16", () => {
		expect(majorStep(300, "in")).toBe(0.25);
		expect(majorStep(150, "in")).toBe(0.5);
		expect(majorStep(75, "in")).toBe(1);
		expect(majorStep(30, "in")).toBe(2);
		expect(majorStep(3000, "in")).toBe(1 / 16);
		const minors = rulerTicks(0, 0.5, 600, "in", 300).filter((t) => !t.major);
		expect(minors[0]?.value).toBe(0.0625);
	});

	test("label a CR80 card's edges in mm", () => {
		const c = open();
		render(
			<ControllerProvider controller={c}>
				<Rulers />
			</ControllerProvider>,
		);
		act(() => {
			setDisplayUnit("mm");
			c.dispatch({ type: "setRulers", on: true });
			c.setView({ x: 30, y: 40, zoom: 0.5 });
			c.select(["0/0"]);
		});
		expect(screen.getByTestId("ruler-x").dataset.unit).toBe("mm");
		expect(screen.getByTestId("ruler-x-ticks").textContent).toContain("85.68");
		expect(screen.getByTestId("ruler-y-ticks").textContent).toContain("54.02");
		expect(screen.getByLabelText("Units: Millimeters")).toBeTruthy();
	});
});

describe("unit inspector fields", () => {
	function setup() {
		const c = open();
		c.select(["0/0"]);
		render(
			<ControllerProvider controller={c}>
				<DesignPanel />
			</ControllerProvider>,
		);
		return c;
	}

	test("show a CR80 card in mm", () => {
		setup();
		act(() => setDisplayUnit("mm"));
		expect(spinbutton("W")).toHaveProperty("value", "85.68mm");
		expect(spinbutton("H")).toHaveProperty("value", "54.02mm");
		act(() => setDisplayUnit("in"));
		expect(spinbutton("W")).toHaveProperty("value", "3.373in");
	});

	test("read typed suffixes in any unit", () => {
		const c = setup();
		type(spinbutton("W"), "3mm");
		expect(width(c)).toBe(35.43);
		act(() => setDisplayUnit("mm"));
		type(spinbutton("W"), "0.125in");
		expect(width(c)).toBe(37.5);
		type(spinbutton("W"), "12pt");
		expect(width(c)).toBe(50);
		type(spinbutton("W"), "40px");
		expect(width(c)).toBe(40);
		type(spinbutton("W"), "10");
		expect(width(c)).toBe(118.11);
	});

	test("leave px alone when the shown value is typed back", () => {
		const c = setup();
		act(() => setDisplayUnit("mm"));
		type(spinbutton("W"), "85.68");
		expect(width(c)).toBe(1012);
	});
});

describe("length input", () => {
	test("evaluates expressions with suffixes", () => {
		expect(parseLengthInput("10mm + 2", null, "mm", 300)).toBe(12);
		expect(parseLengthInput("1in/2", null, "in", 300)).toBe(0.5);
		expect(parseLengthInput("*2", 3, "mm", 300)).toBe(6);
		expect(parseLengthInput("3 parsecs", null, "mm", 300)).toBeNull();
	});
});

describe("custom document size", () => {
	test("reads mm and in at the DPI, rounded up to whole px", () => {
		expect(customSize(85.6, 53.98, "mm")).toEqual({ width: 1012, height: 638 });
		expect(customSize(2, 3.5, "in")).toEqual({ width: 600, height: 1050 });
		expect(customSize(4, 6, "in", 150)).toEqual({ width: 600, height: 900 });
		expect(customSize(1080, 1350, "px")).toEqual({ width: 1080, height: 1350 });
		expect(customSize(0, 0, "mm")).toEqual({ width: 1, height: 1 });
	});
});
