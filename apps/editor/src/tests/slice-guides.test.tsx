import type { Element, Template } from "@freshcoat-js/coatfile";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { COMMAND_BY_ID } from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { setSlicesShown, toggleSlices } from "~/canvas/slice-guides";
import { SliceGuides } from "~/canvas/SliceGuides";
import { doc } from "./doc-fixture";

const VIEW = { x: 100, y: 50, zoom: 0.5 };

/** `doc()` with slices on `a` (kiss, "Card", bleed 4) and the rotated `rot`
 *  (no output, shown only while `show` is on), and on the back's `a`. */
function sliced(): Template {
	const t = doc();
	const mark = (id: string, slice: object, extra: object = {}) => (e: Element) =>
		e.id === id
			? ({ ...e, ...extra, properties: { ...e.properties, slice } } as Element)
			: e;
	const front = t.template_data[0];
	const back = t.template_data[1];
	if (!front || !back) throw new Error("fixture");
	return {
		...t,
		template_data: [
			{
				...front,
				elements: front.elements
					.map(mark("a", { name: "Card", edge: "kiss", bleed: 4 }))
					.map(
						mark(
							"rot",
							{ output: "none", edge: "through" },
							{ visibleWhen: { field: "show" } },
						),
					),
			},
			{
				...back,
				elements: back.elements.map(mark("a", { edge: "score" })),
			},
		],
	};
}

function canvas(t: Template) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	render(
		<ControllerProvider controller={c}>
			<svg>
				<title>overlay</title>
				<SliceGuides view={VIEW} />
			</svg>
		</ControllerProvider>,
	);
	return c;
}

const outline = (id: string) =>
	document.querySelector(`path[data-slice-id="${id}"]`);

beforeEach(() => setSlicesShown(true));
afterEach(cleanup);

describe("slices on the canvas", () => {
	test("outlines each slice of the side, by edge, in trim coordinates", () => {
		canvas(sliced());
		const group = screen.getByTestId("slice-guides");
		expect(group.getAttribute("transform")).toBe("translate(100 50) scale(0.5)");
		const a = outline("a");
		expect(a?.getAttribute("data-slice-edge")).toBe("kiss");
		expect(a?.getAttribute("data-slice-output")).toBe("piece");
		expect(a?.getAttribute("d")).toMatch(/^M\s*10[ ,]20/);
		expect(a?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
		expect(a?.getAttribute("fill")).toBe("none");
		const rot = outline("rot");
		expect(rot?.getAttribute("data-slice-edge")).toBe("through");
		expect(rot?.getAttribute("data-slice-output")).toBe("none");
		expect(rot?.getAttribute("d")).not.toMatch(/^M\s*700[ ,]300/);
	});

	test("draws edge kinds with their own colour and dashes", () => {
		const t = sliced();
		const c = canvas(t);
		const look = () => {
			const a = outline("a");
			return [a?.getAttribute("stroke"), a?.getAttribute("stroke-dasharray")];
		};
		const kiss = look();
		const through = [
			outline("rot")?.getAttribute("stroke"),
			outline("rot")?.getAttribute("stroke-dasharray"),
		];
		expect(kiss[0]).not.toBe(through[0]);
		c.select([]);
		act(() => c.setSide(1));
		const score = look();
		expect(score[0]).not.toBe(kiss[0]);
		expect(score[0]).not.toBe(through[0]);
		expect(score[1]).not.toBe(through[1]);
	});

	test("labels pieces at the top-left of their box and leaves other outlines bare", () => {
		canvas(sliced());
		const labels = screen.getAllByTestId("slice-label");
		expect(labels.map((l) => l.textContent)).toEqual(["Card"]);
		// Box (10, 20) at zoom 0.5 from (100, 50).
		expect(labels[0]?.getAttribute("x")).toBe("105");
		expect(Number(labels[0]?.getAttribute("y"))).toBeLessThanOrEqual(60);
	});

	test("labels an unnamed piece with its layer id", () => {
		const t = sliced();
		const front = t.template_data[0];
		if (!front) throw new Error("fixture");
		const plain = {
			...t,
			template_data: [
				{
					...front,
					elements: front.elements.map((e) =>
						e.id === "a"
							? ({ ...e, properties: { ...e.properties, slice: {} } } as Element)
							: e,
					),
				},
			],
		};
		canvas(plain);
		expect(screen.getByTestId("slice-label").textContent).toBe("a");
	});

	test("follows the side, the values and a hidden layer", () => {
		const c = canvas(sliced());
		act(() => c.dispatch({ type: "setValue", field: "show", value: "false" }));
		expect(outline("rot")).toBeNull();
		expect(outline("a")).not.toBeNull();
		act(() => c.setSide(1));
		expect(outline("a")?.getAttribute("data-slice-edge")).toBe("score");
	});

	test("draws nothing without slices", () => {
		canvas(doc());
		expect(screen.queryByTestId("slice-guides")).toBeNull();
	});

	test("View > Slices toggles them, on by default", async () => {
		const command = COMMAND_BY_ID.get("view.slices");
		expect(command?.label).toBe("Slices");
		const c = canvas(sliced());
		expect(screen.getByTestId("slice-guides")).toBeTruthy();
		await act(() => command?.run({ controller: c } as never));
		expect(screen.queryByTestId("slice-guides")).toBeNull();
		act(() => toggleSlices());
		expect(screen.getByTestId("slice-guides")).toBeTruthy();
	});
});
