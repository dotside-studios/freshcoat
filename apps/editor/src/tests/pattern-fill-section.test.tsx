import type { Element, Template } from "@freshcoat-js/coatfile";
import { minimumFormatVersion, validate } from "@freshcoat-js/coatfile";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { button, chooseOption, fastUser, spinbutton } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const RECT = "0/0";

function setup(t: Template = doc()) {
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
	return c;
}

const fill = (c: EditorController) =>
	(getElement(c.template as Template, RECT) as Element).properties as {
		fill?: unknown;
	};

function typeInto(input: HTMLElement, value: string) {
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value } });
	fireEvent.keyDown(input, { key: "Enter" });
}

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("pattern fill controls", () => {
	it("turns a fill into a pattern and edits its parameters", async () => {
		const user = fastUser();
		const c = setup();
		await chooseOption(user, button("Fill 1 kind"), "Pattern");
		expect(fill(c).fill).toEqual({
			kind: "pattern",
			pattern: "noise",
			colors: ["#111111", "#00000040"],
		});
		expect(screen.getByTestId("pattern-swatch").dataset.pattern).toBe("noise");

		await chooseOption(user, button("Fill 1 pattern"), "Hatching");
		expect(fill(c).fill).toEqual({
			kind: "pattern",
			pattern: "hatching",
			colors: ["#111111", "#00000040"],
		});
		expect(spinbutton("Pattern angle")).toHaveProperty("value", "45°");
		expect(spinbutton("Pattern seed")).toHaveProperty("disabled", true);

		typeInto(spinbutton("Pattern scale"), "12");
		typeInto(spinbutton("Pattern density"), "40");
		typeInto(spinbutton("Pattern angle"), "30");
		expect(fill(c).fill).toEqual({
			kind: "pattern",
			pattern: "hatching",
			colors: ["#111111", "#00000040"],
			scale: 12,
			density: 0.4,
			angle: 30,
		});
		expect(validate(c.template).ok).toBe(true);
		expect(minimumFormatVersion(c.template as Template)).toBe("1.7");
	});

	it("keeps authored colours when switching pattern", async () => {
		const user = fastUser();
		const t = doc();
		(getElement(t, RECT) as Element).properties = {
			...(getElement(t, RECT) as Element).properties,
			fill: {
				kind: "pattern",
				pattern: "dots",
				colors: ["#000000", "#ff0000"],
			},
		} as never;
		const c = setup(t);
		await chooseOption(user, button("Fill 1 pattern"), "Paper");
		expect(fill(c).fill).toEqual({
			kind: "pattern",
			pattern: "paper",
			colors: ["#000000", "#ff0000"],
		});
		typeInto(spinbutton("Pattern seed"), "4");
		expect(fill(c).fill).toMatchObject({ seed: 4 });
	});

	it("converts a pattern back to a gradient with its colours", async () => {
		const user = fastUser();
		const t = doc();
		(getElement(t, RECT) as Element).properties = {
			...(getElement(t, RECT) as Element).properties,
			fill: {
				kind: "pattern",
				pattern: "dots",
				colors: ["#000000", "#ff0000"],
			},
		} as never;
		const c = setup(t);
		await chooseOption(user, button("Fill 1 kind"), "Linear");
		expect(fill(c).fill).toEqual({
			kind: "linear",
			angle: 90,
			stops: [
				{ offset: 0, color: "#000000" },
				{ offset: 1, color: "#ff0000" },
			],
		});
	});
});
