import type { Element, Template } from "@freshcoat-js/coatfile";
import { fixtures } from "@freshcoat-js/coatfile/fixtures";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { IssuesList } from "~/app/IssuesPopover";
import {
	imageDpiHints,
	printCheckHints,
	printGuideMetrics,
	printGuidesFor,
	printGuidesOn,
	safeAreaHints,
	setPrintGuides,
} from "~/canvas/print-guides";
import { openFile, saveJson } from "~/doc/io";
import { getElement } from "~/doc/path";
import { resizeWithConstraints } from "~/doc/resize";
import { withConstraint } from "~/panels/design/ConstraintsSection";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { SizeSection } from "~/panels/setup/SizeSection";
import { useEditor } from "~/state/hooks";
import { chooseOption, fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

beforeEach(() => {
	vi.stubGlobal("fetch", async () => {
		throw new Error("offline");
	});
	// jsdom has no CSS.escape, which the listbox uses to find the selected
	// option when it opens.
	vi.stubGlobal("CSS", {
		escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

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

function design(selection: string[], t?: Template) {
	const c = open(t);
	c.select(selection);
	render(
		<ControllerProvider controller={c}>
			<DesignPanel />
		</ControllerProvider>,
	);
	return { c, user: fastUser() };
}

const el = (c: EditorController, key: string) =>
	getElement(c.template as Template, key) as Element;

describe("Constraints in Position", () => {
	test("shows for a free layer and an absolute auto-layout child, not a flow child", () => {
		design(["0/0"]);
		expect(screen.getByTestId("constraints-diagram")).toBeTruthy();
		cleanup();
		design(["0/3/2"]);
		expect(screen.getByTestId("constraints-diagram")).toBeTruthy();
		cleanup();
		design(["0/3/0"]);
		expect(screen.queryByTestId("constraints-diagram")).toBeNull();
		cleanup();
		design([]);
		expect(screen.queryByTestId("constraints-diagram")).toBeNull();
	});

	test("sits inside Position with the align buttons, without sections of their own", () => {
		design(["0/0"]);
		const position = document.querySelector("[data-section='Position']");
		if (!(position instanceof HTMLElement)) throw new Error("no Position");
		expect(
			within(position).getByRole("toolbar", { name: "Align" }),
		).toBeTruthy();
		expect(within(position).getByTestId("constraints-diagram")).toBeTruthy();
		expect(
			within(position).getByRole("spinbutton", { name: "Rotation" }),
		).toBeTruthy();
		const titles = screen
			.getAllByRole("heading", { level: 3 })
			.map((h) => h.textContent);
		expect(titles).not.toContain("Align");
		expect(titles).not.toContain("Constraints");
	});

	test("choosing sides writes the constraints as one undo step each, and the diagram follows", async () => {
		const { c, user } = design(["0/0"]);
		const diagram = () => screen.getByTestId("constraints-diagram");
		const pinned = () =>
			[...diagram().querySelectorAll("[data-on='true']")].map((n) =>
				n.getAttribute("data-pin"),
			);
		expect(pinned()).toEqual(["left", "top"]);
		// By label rather than by role over the whole inspector: see chooseOption.
		const trigger = (axis: string) =>
			screen.getByLabelText(new RegExp(`${axis} constraint`), {
				selector: "button",
			});

		await chooseOption(user, trigger("Horizontal"), "Right");
		expect(el(c, "0/0").constraints).toEqual({ horizontal: "end" });
		expect(c.state.doc?.history.past).toHaveLength(1);

		await chooseOption(user, trigger("Vertical"), "Top and bottom");
		expect(el(c, "0/0").constraints).toEqual({
			horizontal: "end",
			vertical: "stretch",
		});
		expect(c.state.doc?.history.past).toHaveLength(2);
		expect(pinned()).toEqual(["right", "top", "bottom"]);
		expect(diagram().getAttribute("aria-label")).toBe(
			"Pinned right, top and bottom",
		);

		await chooseOption(user, trigger("Horizontal"), "Left");
		expect(el(c, "0/0").constraints).toEqual({ vertical: "stretch" });
	});

	test("a mixed selection reads as mixed", () => {
		const t = doc();
		(t.template_data[0]?.elements[0] as Element).constraints = {
			horizontal: "center",
		};
		design(["0/0", "0/5"], t);
		const trigger = screen.getByRole("button", {
			name: /Horizontal constraint/,
		});
		expect(within(trigger).getByText("Mixed")).toBeTruthy();
	});

	test("the default is left out of the document", () => {
		expect(withConstraint(undefined, "horizontal", "start")).toBeUndefined();
		expect(withConstraint({ vertical: "end" }, "horizontal", "start")).toEqual({
			vertical: "end",
		});
		expect(withConstraint(undefined, "vertical", "scale")).toEqual({
			vertical: "scale",
		});
	});
});

describe("Resize with constraints", () => {
	function Size() {
		const t = useEditor((s) => s.doc?.history.present ?? null);
		return t ? <SizeSection template={t} /> : null;
	}

	function pinned(): Template {
		const t = doc();
		const a = t.template_data[0]?.elements[0] as Element;
		a.constraints = { horizontal: "end", vertical: "end" };
		return t;
	}

	test("re-places layers by their constraints, and one undo restores the design", async () => {
		const c = open(pinned());
		render(
			<ControllerProvider controller={c}>
				<Size />
			</ControllerProvider>,
		);
		const user = fastUser();
		await user.click(
			screen.getByRole("checkbox", { name: "Resize with constraints" }),
		);
		const w = screen.getByRole("spinbutton", { name: "Template width" });
		await user.clear(w);
		await user.type(w, "1200{Enter}");

		const t = c.template as Template;
		expect([t.width, t.height]).toEqual([1200, 600]);
		// a sat at 10,20 in a 1000-wide side, pinned right.
		expect(el(c, "0/0").pos).toEqual({ x: 210, y: 20 });
		expect(t.template_data[0]?.background.size).toEqual({
			width: 1200,
			height: 600,
		});
		expect(c.state.doc?.history.past).toHaveLength(1);

		c.undo();
		expect((c.template as Template).width).toBe(1000);
		expect(el(c, "0/0").pos).toEqual({ x: 10, y: 20 });
	});

	test("the plain resize leaves layers where they are", async () => {
		const c = open(pinned());
		render(
			<ControllerProvider controller={c}>
				<Size />
			</ControllerProvider>,
		);
		const user = fastUser();
		const w = screen.getByRole("spinbutton", { name: "Template width" });
		await user.clear(w);
		await user.type(w, "1200{Enter}");
		expect(el(c, "0/0").pos).toEqual({ x: 10, y: 20 });
	});

	test("sets the bleed and the safe area, one undo step each", async () => {
		const c = open();
		render(
			<ControllerProvider controller={c}>
				<Size />
			</ControllerProvider>,
		);
		const user = fastUser();
		const bleed = screen.getByRole("spinbutton", { name: "Template bleed" });
		await user.clear(bleed);
		await user.type(bleed, "12{Enter}");
		const safe = screen.getByRole("spinbutton", {
			name: "Template safe area",
		});
		await user.clear(safe);
		await user.type(safe, "30{Enter}");
		const t = c.template as Template;
		expect([t.bleed, t.safeArea]).toEqual([12, 30]);
		expect(c.state.doc?.history.past).toHaveLength(2);
		c.undo();
		expect((c.template as Template).safeArea).toBeUndefined();
	});

	test("starts linked for one value, unlinked for sides set apart", () => {
		const c = open({
			...doc(),
			bleed: 12,
			safeArea: { top: 1, right: 2, bottom: 3, left: 4 },
		});
		render(
			<ControllerProvider controller={c}>
				<Size />
			</ControllerProvider>,
		);
		const bleed = screen.getByRole("spinbutton", { name: "Template bleed" });
		expect((bleed as HTMLInputElement).value).toBe("12");
		expect(screen.queryByTestId("bleed-sides")).toBeNull();
		const sides = within(screen.getByTestId("safeArea-sides"))
			.getAllByRole("spinbutton")
			.map((f) => (f as HTMLInputElement).value);
		expect(sides).toEqual(["1", "2", "3", "4"]);
	});

	test("sets one side unlinked, keeping the others, one undo step", async () => {
		const c = open({ ...doc(), bleed: 8 });
		render(
			<ControllerProvider controller={c}>
				<Size />
			</ControllerProvider>,
		);
		const user = fastUser();
		await user.click(screen.getByRole("button", { name: "Link bleed sides" }));
		expect((c.template as Template).bleed).toBe(8);
		const left = screen.getByRole("spinbutton", {
			name: "Template bleed left",
		});
		await user.clear(left);
		await user.type(left, "20{Enter}");
		expect((c.template as Template).bleed).toEqual({
			top: 8,
			right: 8,
			bottom: 8,
			left: 20,
		});
		expect(c.state.doc?.history.past).toHaveLength(1);
		c.undo();
		expect((c.template as Template).bleed).toBe(8);
	});

	test("linking sides set apart shows them mixed and leaves the file", async () => {
		const sides = { top: 1, right: 2, bottom: 3, left: 4 };
		const c = open({ ...doc(), bleed: sides });
		render(
			<ControllerProvider controller={c}>
				<Size />
			</ControllerProvider>,
		);
		const user = fastUser();
		await user.click(screen.getByRole("button", { name: "Link bleed sides" }));
		const bleed = screen.getByRole("spinbutton", { name: "Template bleed" });
		expect((bleed as HTMLInputElement).value).toBe("");
		expect(bleed.getAttribute("placeholder")).toBe("Mixed");
		expect((c.template as Template).bleed).toEqual(sides);
		expect(c.state.doc?.history.past).toHaveLength(0);
		await user.type(bleed, "5{Enter}");
		expect((c.template as Template).bleed).toBe(5);
	});

	test("sides set in the file round-trip unchanged", async () => {
		const even = { top: 6, right: 6, bottom: 6, left: 6 };
		const apart = { top: 1, right: 2, bottom: 3, left: 4 };
		const file = JSON.stringify({
			...doc(),
			format_version: "1.5",
			bleed: even,
			safeArea: apart,
		});
		const loaded = await openFile(file, "doc.coat.json");
		if (loaded.kind !== "ok") throw new Error(loaded.kind);
		const c = open(loaded.template);
		render(
			<ControllerProvider controller={c}>
				<Size />
			</ControllerProvider>,
		);
		const user = fastUser();
		await user.click(screen.getByRole("button", { name: "Link bleed sides" }));
		await user.click(
			screen.getByRole("button", { name: "Link safe area sides" }),
		);
		const saved = saveJson(c.template as Template);
		if (!saved.ok) throw new Error("not saved");
		const t = JSON.parse(saved.data) as Template;
		expect(t.bleed).toEqual(even);
		expect(t.safeArea).toEqual(apart);
	});

	test("refuses a size the plain resize refuses", () => {
		const r = resizeWithConstraints(doc(), 0, 600);
		expect(r.ok).toBe(false);
	});
});

describe("print guides", () => {
	const card = (): Template => ({ ...doc(), product: "card_cr80" });

	test("scale with the template's long side", () => {
		const m = printGuideMetrics({ width: 1012, height: 638 });
		expect(m.corner).toBeCloseTo(37.6, 1);
		expect(m.safe).toBeCloseTo(35.47, 1);
		const tall = printGuideMetrics({ width: 638, height: 1012 });
		expect(tall).toEqual(m);
		expect(printGuideMetrics({ width: 2024, height: 1276 }).safe).toBeCloseTo(
			70.93,
			1,
		);
	});

	test("are on by default for a CR80 card only, and a choice sticks per template", () => {
		expect(printGuidesOn("t1", card())).toBe(true);
		expect(printGuidesOn("t2", doc())).toBe(false);
		setPrintGuides("t1", false);
		expect(printGuidesOn("t1", card())).toBe(false);
		expect(printGuidesOn("t3", card())).toBe(true);
	});

	test("hint at layers with an edge inside the safe area, not at bleed", () => {
		const t = card();
		const els = t.template_data[0]?.elements as Element[];
		// a: 10,20 100x50, inside the 35-unit band on the left and top.
		// rot and friends stay clear; add a full-bleed rect that runs past the trim.
		els.push({
			id: "bleed",
			type: "rect",
			pos: { x: -10, y: -10 },
			size: { width: 1020, height: 620 },
			properties: { fill: "#000000" },
		});
		const hints = safeAreaHints(t);
		const ids = hints.map((h) => h.id);
		expect(ids).toContain("a");
		expect(ids).not.toContain("bleed");
		expect(hints.find((h) => h.id === "a")?.message).toMatch(
			/Left and top edges cross the safe area/,
		);
		expect(safeAreaHints(doc())).toEqual([]);
	});

	test("show a template's own bleed and safe area, whatever its product", () => {
		const t: Template = {
			...doc(),
			bleed: 12,
			safeArea: { top: 30, right: 20, bottom: 30, left: 20 },
		};
		expect(printGuidesOn("t4", t)).toBe(true);
		expect(printGuidesFor(t)).toEqual({
			corner: 0,
			safe: { top: 30, right: 20, bottom: 30, left: 20 },
			bleed: { top: 12, right: 12, bottom: 12, left: 12 },
		});
		expect(printGuidesFor({ ...card(), safeArea: 10 }).safe?.left).toBe(10);
		const hints = safeAreaHints(t);
		expect(hints.find((h) => h.id === "a")?.message).toBe(
			"Left and top edges cross the safe area",
		);
	});

	test("are listed with the issues as hints, while the template stays valid", async () => {
		const c = open(card());
		render(
			<ControllerProvider controller={c}>
				<IssuesList template={c.base as Template} />
			</ControllerProvider>,
		);
		const list = screen.getByRole("region", { name: "Print hints" });
		const rows = within(list).getAllByTestId("print-hint");
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0]?.getAttribute("data-level")).toBe("info");
		expect(screen.getByTestId("no-issues")).toBeTruthy();
		const user = fastUser();
		await user.click(
			within(list).getByRole("button", { name: /Select front · a$/ }),
		);
		expect(c.state.selection).toEqual(["0/0"]);
	});

	test("list images that print below the export's resolution", async () => {
		const [hint] = imageDpiHints(doc(), { dpi: 300, min: 300 });
		expect(hint).toMatchObject({
			id: "img",
			code: "image_dpi",
			message: "Prints at 1 DPI, under 300",
		});
		expect(imageDpiHints(doc(), { dpi: 300, min: 1 })).toEqual([]);
		const c = open(doc());
		render(
			<ControllerProvider controller={c}>
				<IssuesList template={c.base as Template} />
			</ControllerProvider>,
		);
		const list = screen.getByRole("region", { name: "Print hints" });
		const row = within(list)
			.getAllByTestId("print-hint")
			.find((r) => r.textContent?.includes("Prints at 1 DPI, under 300"));
		expect(row).toBeTruthy();
		await fastUser().click(within(row as HTMLElement).getByRole("button"));
		expect(c.state.selection).toEqual([hint?.key]);
	});
	test("list layers that may not print as they look, and select them", async () => {
		const t = fixtures.printPreflightCard;
		expect(printCheckHints(t, 300).map((h) => `${h.key} ${h.code}`)).toEqual([
			"0/0 short_of_bleed",
			"0/1 small_text",
			"0/2 small_text",
			"0/3 hairline_stroke",
			"0/4 rich_black_text",
		]);
		expect(printCheckHints(fixtures.minimalCard, 300)).toEqual([]);
		const c = open(t);
		render(
			<ControllerProvider controller={c}>
				<IssuesList template={c.base as Template} />
			</ControllerProvider>,
		);
		const list = screen.getByRole("region", { name: "Print hints" });
		const row = within(list)
			.getAllByTestId("print-hint")
			.find((r) => r.getAttribute("data-code") === "hairline_stroke");
		expect(row?.textContent).toContain("Stroke is 0.12 pt at print size");
		await fastUser().click(within(row as HTMLElement).getByRole("button"));
		expect(c.state.selection).toEqual(["0/3"]);
		expect(screen.getByTestId("no-issues")).toBeTruthy();
	});
});
