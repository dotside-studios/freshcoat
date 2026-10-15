import type { Element, Template } from "@freshcoat-js/coatfile";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { COMMAND_BY_ID } from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import {
	SeparationsLegend,
	SeparationsPreview,
} from "~/canvas/SeparationsPreview";
import { SliceGuides } from "~/canvas/SliceGuides";
import {
	collectSeparations,
	inkColor,
	resetHiddenInks,
	separationsShown,
	setSeparationsShown,
} from "~/canvas/separations";
import { setSlicesShown } from "~/canvas/slice-guides";
import { fastUser } from "./aria";
import { doc } from "./doc-fixture";

const VIEW = { x: 100, y: 50, zoom: 0.5 };

type Spot = {
	fill?: { spot: string; overprint?: boolean };
	stroke?: { spot: string; overprint?: boolean };
};

/** `doc()` with spot inks: `a` fills White (overprinting), `rot` (shown while
 *  `show` is on) strokes Foil, and the back's `a` fills Varnish. */
function spotted(): Template {
	const t = doc();
	const mark =
		(id: string, props: object, extra: object = {}) =>
		(e: Element): Element =>
			e.id === id
				? ({
						...e,
						...extra,
						properties: { ...e.properties, ...props },
					} as Element)
				: e;
	const spot = (s: Spot) => ({ spot: s });
	const front = t.template_data[0];
	const back = t.template_data[1];
	if (!front || !back) throw new Error("fixture");
	return {
		...t,
		template_data: [
			{
				...front,
				elements: front.elements
					.map(mark("a", spot({ fill: { spot: "White", overprint: true } })))
					.map(
						mark(
							"rot",
							{
								...spot({ stroke: { spot: "Foil" } }),
								stroke: { width: 2, color: "#000000" },
							},
							{ visibleWhen: { field: "show" } },
						),
					),
			},
			{
				...back,
				elements: back.elements.map(
					mark("a", spot({ fill: { spot: "Varnish" } })),
				),
			},
		],
	};
}

/** The front of `t` with each element passed through `change`. */
function withFront(t: Template, change: (e: Element) => Element): Template {
	const f = t.template_data[0];
	if (!f) throw new Error("fixture");
	return {
		...t,
		template_data: [
			{ ...f, elements: f.elements.map(change) },
			...t.template_data.slice(1),
		],
	};
}

const front = (t: Template, extra: object = {}) =>
	collectSeparations(t, { frameName: "front", ...extra });
const names = (t: Template, extra: object = {}) =>
	front(t, extra).inks.map((i) => i.name);

describe("inkColor", () => {
	test("gives a name the same color every time and other names other colors", () => {
		expect(inkColor("White")).toBe(inkColor("White"));
		expect(inkColor("White")).toMatch(/^oklch\(0\.68 0\.19 \d+\)$/);
		const inks = ["White", "Foil", "Varnish", "CutContour", "Gold"];
		expect(new Set(inks.map(inkColor)).size).toBe(inks.length);
	});

	test("tells names apart by case", () => {
		expect(inkColor("white")).not.toBe(inkColor("White"));
	});
});

describe("collectSeparations", () => {
	test("lists each ink once, in order of use, with its shapes", () => {
		const { inks, shapes } = front(spotted());
		expect(inks.map((i) => [i.name, i.overprint])).toEqual([
			["White", true],
			["Foil", false],
		]);
		expect(inks[0]?.color).toBe(inkColor("White"));
		expect(shapes.map((s) => [s.id, s.ink, s.paint])).toEqual([
			["a", "White", "fill"],
			["rot", "Foil", "stroke"],
		]);
		expect(shapes[0]?.path).toMatch(/^M\s*10[ ,]20/);
	});

	test("merges overprint when an ink is used twice", () => {
		const twice = withFront(spotted(), (e) =>
			e.id === "rot"
				? ({
						...e,
						properties: {
							...e.properties,
							spot: { fill: { spot: "White" } },
						},
					} as Element)
				: e,
		);
		const { inks, shapes } = front(twice);
		expect(inks.map((i) => [i.name, i.overprint])).toEqual([["White", true]]);
		expect(shapes).toHaveLength(2);
	});

	test("reads the side it is asked for", () => {
		const { inks } = collectSeparations(spotted(), { frameName: "back" });
		expect(inks.map((i) => i.name)).toEqual(["Varnish"]);
	});

	test("finds nothing on a side without spot inks", () => {
		expect(front(doc())).toEqual({ inks: [], shapes: [] });
	});

	test("leaves out a layer that is hidden", () => {
		const hidden = withFront(spotted(), (e) =>
			e.id === "a" ? ({ ...e, hidden: true } as Element) : e,
		);
		expect(names(hidden)).toEqual(["Foil"]);
	});

	test("leaves out a layer whose condition fails", () => {
		const t = spotted();
		expect(names(t, { values: { show: "true" } })).toEqual(["White", "Foil"]);
		expect(names(t, { values: { show: "false" } })).toEqual(["White"]);
	});

	test("leaves out a layer a variant hides", () => {
		const variant = {
			id: "plain",
			label: "Plain",
			overrides: [
				{
					name: "front",
					elements: [{ id: "a", properties: {}, hidden: true }],
				},
			],
		};
		const t = { ...spotted(), variants: [variant] } as Template;
		expect(names(t)).toEqual(["White", "Foil"]);
		expect(names(t, { variantId: "plain" })).toEqual(["Foil"]);
	});

	test("counts a stroke ink only on a layer with a stroke", () => {
		const bare = withFront(spotted(), (e) =>
			e.id === "rot"
				? ({
						...e,
						properties: { ...e.properties, stroke: undefined },
					} as Element)
				: e,
		);
		expect(names(bare)).toEqual(["White"]);
	});
});

function canvas(t: Template) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	render(
		<ControllerProvider controller={c}>
			<svg>
				<title>overlay</title>
				<SeparationsPreview view={VIEW} />
				<SliceGuides view={VIEW} />
			</svg>
			<SeparationsLegend />
		</ControllerProvider>,
	);
	return c;
}

const plate = (ink: string) =>
	document.querySelectorAll(`path[data-ink="${ink}"]`);

beforeEach(() => {
	setSeparationsShown(true);
	setSlicesShown(false);
	resetHiddenInks();
});
afterEach(() => {
	cleanup();
	setSeparationsShown(false);
	setSlicesShown(true);
});

describe("the separations preview", () => {
	test("is off until asked for", () => {
		setSeparationsShown(false);
		canvas(spotted());
		expect(screen.queryByTestId("separations-preview")).toBeNull();
		expect(screen.queryByTestId("separations-legend")).toBeNull();
	});

	test("tints and outlines each ink in its own color", () => {
		canvas(spotted());
		const group = screen.getByTestId("separations-preview");
		expect(group.getAttribute("transform")).toBe(
			"translate(100 50) scale(0.5)",
		);
		const white = plate("White")[0];
		expect(white?.getAttribute("fill")).toBe(inkColor("White"));
		expect(white?.getAttribute("stroke")).toBe(inkColor("White"));
		expect(white?.getAttribute("data-paint")).toBe("fill");
		const foil = plate("Foil")[0];
		expect(foil?.getAttribute("fill")).toBe("none");
		expect(foil?.getAttribute("stroke")).toBe(inkColor("Foil"));
		expect(foil?.getAttribute("data-paint")).toBe("stroke");
	});

	test("lists the inks, marking the ones that overprint", () => {
		canvas(spotted());
		const rows = screen.getAllByTestId("separations-ink");
		expect(rows.map((r) => r.textContent)).toEqual(["WhiteOverprint", "Foil"]);
	});

	test("hides and shows one ink from the legend", async () => {
		canvas(spotted());
		const user = fastUser();
		const white = () => screen.getByRole("button", { name: /^White/ });
		await user.click(white());
		expect(plate("White")).toHaveLength(0);
		expect(plate("Foil")).toHaveLength(1);
		expect(white().getAttribute("aria-pressed")).toBe("false");
		await user.click(white());
		expect(plate("White")).toHaveLength(1);
	});

	test("follows the side and the values", () => {
		const c = canvas(spotted());
		act(() => c.dispatch({ type: "setValue", field: "show", value: "false" }));
		expect(plate("Foil")).toHaveLength(0);
		act(() => c.dispatch({ type: "setSide", side: 1 }));
		expect(plate("White")).toHaveLength(0);
		expect(plate("Varnish")).toHaveLength(1);
	});

	test("says so when the side has no spot inks", () => {
		canvas(doc());
		expect(screen.getByTestId("separations-legend").textContent).toBe(
			"No spot inks",
		);
		expect(screen.queryByTestId("separations-preview")).toBeNull();
	});

	test("shows the slice cut lines with it, even with Slices off", () => {
		const sliced = withFront(spotted(), (e) =>
			e.id === "a"
				? ({
						...e,
						properties: { ...e.properties, slice: { edge: "kiss" } },
					} as Element)
				: e,
		);
		canvas(sliced);
		expect(screen.getByTestId("slice-guides")).toBeTruthy();
		cleanup();
		setSeparationsShown(false);
		canvas(sliced);
		expect(screen.queryByTestId("slice-guides")).toBeNull();
	});

	test("View > Separations toggles it", async () => {
		setSeparationsShown(false);
		const command = COMMAND_BY_ID.get("view.separations");
		expect(command?.label).toBe("Separations");
		const c = canvas(spotted());
		await act(() => command?.run({ controller: c } as never));
		expect(separationsShown()).toBe(true);
		expect(screen.getByTestId("separations-preview")).toBeTruthy();
		await act(() => command?.run({ controller: c } as never));
		expect(separationsShown()).toBe(false);
	});
});
