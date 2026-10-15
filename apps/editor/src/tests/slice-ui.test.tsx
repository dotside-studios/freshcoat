import type { Element, Template } from "@freshcoat-js/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { LeftPanel } from "~/panels/LeftPanel";
import { PrintPanel } from "~/panels/print/PrintPanel";
import { chooseOption, fastUser, spinbutton } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

function open(selection: string[], t: Template = doc()) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	c.select(selection);
	return c;
}

function setup(selection: string[], t?: Template) {
	const c = open(selection, t);
	render(
		<ControllerProvider controller={c}>
			<PrintPanel />
		</ControllerProvider>,
	);
	return c;
}

/** `doc()` with `slice` on the front's top-level `a` (0/0). */
function withSlice(slice: object = {}): Template {
	const t = doc();
	const front = t.template_data[0];
	if (!front) throw new Error("fixture");
	return {
		...t,
		template_data: [
			{
				...front,
				elements: front.elements.map((e) =>
					e.id === "a"
						? ({ ...e, properties: { ...e.properties, slice } } as Element)
						: e,
				),
			},
			...t.template_data.slice(1),
		],
	};
}

const slice = (c: EditorController, key = "0/0") =>
	(getElement(c.template as Template, key)?.properties as { slice?: object })
		.slice;
const addSlice = () =>
	fireEvent.click(screen.getByRole("button", { name: "Add slice" }));
const removeSlice = () =>
	fireEvent.click(screen.getByRole("button", { name: "Remove slice" }));

beforeAll(() => {
	Element.prototype.scrollIntoView ??= () => {};
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("Slice section", () => {
	it("shows for a top-level rect or vector and not for nested or other layers", () => {
		setup(["0/0"]);
		expect(screen.getByText("Slice")).toBeTruthy();
		cleanup();
		setup(["0/1/0"]);
		expect(screen.queryByText("Slice")).toBeNull();
		cleanup();
		setup(["0/4"]);
		expect(screen.queryByText("Slice")).toBeNull();
		cleanup();
		setup(["0/0", "0/4"]);
		expect(screen.queryByText("Slice")).toBeNull();
		cleanup();
		setup(["0/bg"]);
		expect(screen.queryByText("Slice")).toBeNull();
	});

	it("adds and removes the modifier as undo steps", () => {
		const c = setup(["0/0"]);
		expect(screen.queryByLabelText("Slice name")).toBeNull();
		addSlice();
		expect(slice(c)).toEqual({});
		expect(screen.getByLabelText("Slice name")).toHaveProperty(
			"placeholder",
			"a",
		);
		removeSlice();
		expect(slice(c)).toBeUndefined();
		expect(
			"slice" in (getElement(c.template as Template, "0/0")?.properties ?? {}),
		).toBe(false);
		act(() => c.undo());
		expect(slice(c)).toEqual({});
		act(() => c.redo());
		expect(slice(c)).toBeUndefined();
	});

	it("edits the name, output, edge and bleed", async () => {
		const c = setup(["0/0"], withSlice());
		const name = screen.getByLabelText("Slice name");
		fireEvent.focus(name);
		fireEvent.change(name, { target: { value: "Front" } });
		fireEvent.keyDown(name, { key: "Enter" });
		expect(slice(c)).toEqual({ name: "Front" });

		fireEvent.click(screen.getByRole("radio", { name: "None" }));
		expect(slice(c)).toEqual({ name: "Front", output: "none" });
		fireEvent.click(screen.getByRole("radio", { name: "Piece" }));
		expect(slice(c)).toEqual({ name: "Front" });

		await chooseOption(
			fastUser(),
			screen.getByLabelText("Slice edge"),
			"Kiss cut",
		);
		expect(slice(c)).toEqual({ name: "Front", edge: "kiss" });
		await chooseOption(fastUser(), screen.getByLabelText("Slice edge"), "None");
		expect(slice(c)).toEqual({ name: "Front" });

		const bleed = spinbutton("Slice bleed");
		fireEvent.focus(bleed);
		fireEvent.change(bleed, { target: { value: "3" } });
		fireEvent.keyDown(bleed, { key: "Enter" });
		expect(slice(c)).toEqual({ name: "Front", bleed: 3 });
	});

	it("clearing the name falls back to the layer id", () => {
		const c = setup(["0/0"], withSlice({ name: "Front", edge: "score" }));
		const name = screen.getByLabelText("Slice name");
		fireEvent.focus(name);
		fireEvent.change(name, { target: { value: "" } });
		fireEvent.keyDown(name, { key: "Enter" });
		expect(slice(c)).toEqual({ edge: "score" });
	});

	it("notes a mixed selection and adds a slice to the rest", () => {
		const t = withSlice({ edge: "through" });
		const c = setup(["0/0", "0/5"], t);
		expect(screen.getByText("Some layers are slices")).toBeTruthy();
		addSlice();
		expect(slice(c, "0/0")).toEqual({ edge: "through" });
		expect(slice(c, "0/5")).toEqual({});
		expect(screen.getByRole("button", { name: "Remove slice" })).toBeTruthy();
	});
});

describe("Slice in the layer menu and the layers panel", () => {
	function tree(t: Template) {
		const c = open([], t);
		render(
			<ControllerProvider controller={c}>
				<LeftPanel />
			</ControllerProvider>,
		);
		return c;
	}

	it("marks sliced rows", () => {
		tree(withSlice({ name: "Front" }));
		const marked = (key: string) =>
			within(screen.getByTestId(`layer-row-${key}`)).queryByTestId(
				"layer-slice",
			);
		expect(marked("0/0")).toBeTruthy();
		expect(marked("0/5")).toBeNull();
	});

	it("offers Use as slice and Remove slice on top-level shapes", async () => {
		const c = tree(doc());
		const user = fastUser();
		await user.click(
			within(screen.getByTestId("layer-row-0/0")).getByText("a"),
		);
		fireEvent.contextMenu(screen.getByTestId("layer-row-0/0"));
		await user.click(
			await screen.findByRole("menuitem", { name: "Use as slice" }),
		);
		expect(slice(c)).toEqual({});
		fireEvent.contextMenu(screen.getByTestId("layer-row-0/0"));
		await user.click(
			await screen.findByRole("menuitem", { name: "Remove slice" }),
		);
		expect(slice(c)).toBeUndefined();
	});

	it("leaves the item out for nested layers and text", async () => {
		tree(doc());
		const user = fastUser();
		await user.click(
			within(screen.getByTestId("layer-row-0/4")).getByText("title"),
		);
		fireEvent.contextMenu(screen.getByTestId("layer-row-0/4"));
		await screen.findByRole("menuitem", { name: /^Group/ });
		expect(screen.queryByRole("menuitem", { name: /slice/i })).toBeNull();
	});
});

describe("Slice section for open paths", () => {
	const front = () => doc().template_data[0]?.elements.length ?? 0;
	const KEY = () => `0/${front()}`;
	function withFold(slice?: object): Template {
		const t = doc();
		const side = t.template_data[0];
		if (!side) throw new Error("fixture");
		const fold = {
			id: "fold",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 10 },
			properties: { d: "M0 5H100", ...(slice ? { slice } : {}) },
		} as Element;
		return {
			...t,
			template_data: [
				{ ...side, elements: [...side.elements, fold] },
				...t.template_data.slice(1),
			],
		};
	}

	it("turns on as a score line with no piece", () => {
		const c = setup([KEY()], withFold());
		addSlice();
		expect(slice(c, KEY())).toEqual({ output: "none", edge: "score" });
	});

	it("disables Piece with a hint, and keeps None usable", () => {
		setup([KEY()], withFold({ output: "none", edge: "score" }));
		expect(screen.getByRole("radio", { name: "Piece" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(screen.getByRole("radio", { name: "None" })).toHaveProperty(
			"disabled",
			false,
		);
		expect(screen.getByTestId("slice-open-hint").textContent).toBe(
			"An open path is a cut line, so it can't be a piece",
		);
	});

	it("leaves Piece on for a closed shape", () => {
		setup(["0/0"], withSlice());
		expect(screen.getByRole("radio", { name: "Piece" })).toHaveProperty(
			"disabled",
			false,
		);
		expect(screen.queryByTestId("slice-open-hint")).toBeNull();
	});
});
