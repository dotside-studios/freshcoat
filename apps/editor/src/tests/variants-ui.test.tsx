import type { Element, Template } from "@freshcoat/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { IssuesList } from "~/app/IssuesPopover";
import { VariantBar } from "~/canvas/VariantBar";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { LayersTree } from "~/panels/layers/LayersTree";
import { useEditor } from "~/state/hooks";
import { doc, geometryOf } from "./doc-fixture";

beforeEach(() => {
	Element.prototype.scrollIntoView ??= () => {};
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

/** doc() with a second variant, Light, that changes nothing. */
function twoVariants(): Template {
	const t = doc();
	return {
		...t,
		variants: [
			...(t.variants ?? []),
			{ id: "light", label: "Light", overrides: [] },
		],
	};
}

function open(t: Template = twoVariants()) {
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

function Issues() {
	const t = useEditor((s) => s.doc?.history.present ?? null);
	return t ? <IssuesList template={t} /> : null;
}

function mount(c: EditorController, ui: React.ReactNode) {
	render(<ControllerProvider controller={c}>{ui}</ControllerProvider>);
	return userEvent.setup();
}

const base = (c: EditorController) => c.base as Template;
const past = (c: EditorController) => c.state.doc?.history.past.length ?? 0;
describe("the canvas bar", () => {
	it("shows while a variant is active and goes back to Default", async () => {
		const c = open();
		const user = mount(c, <VariantBar />);
		expect(screen.queryByTestId("variant-bar")).toBeNull();
		act(() => c.setVariant("dark"));
		const bar = screen.getByTestId("variant-bar");
		expect(bar.textContent).toContain("Editing Dark");
		expect(bar.textContent).toContain("4 layers changed");
		await user.click(
			within(bar).getByRole("button", { name: "Back to Default" }),
		);
		expect(c.state.variantId).toBeUndefined();
		expect(screen.queryByTestId("variant-bar")).toBeNull();
	});
});

describe("override markers", () => {
	function inspect(selection: string[], variant = "dark") {
		const c = open();
		c.setVariant(variant);
		c.select(selection);
		const user = mount(c, <DesignPanel />);
		return { c, user };
	}
	const delta = (c: EditorController, id: string, side = "front") =>
		base(c)
			.variants?.find((v) => v.id === c.variantId)
			?.overrides.find((o) => o.name === side)
			?.elements?.find((d) => d.id === id);

	it("marks and resets a moved layer's position", async () => {
		const { c, user } = inspect(["0/0"]);
		expect(screen.queryAllByTestId("override-marker")).toHaveLength(1);
		act(() => c.nudge(5, 0));
		expect(delta(c, "a")?.pos).toEqual({ x: 15, y: 20 });
		// X and Y both edit pos; the fill section is the other marker.
		const markers = screen.getAllByRole("button", { name: "Changed in Dark" });
		expect(markers).toHaveLength(3);
		await user.click(markers[0] as HTMLElement);
		const menu = await screen.findByRole("menu");
		await user.click(
			within(menu).getByRole("menuitem", { name: "Reset to Default" }),
		);
		expect(delta(c, "a")?.pos).toBeUndefined();
		expect(delta(c, "a")?.properties).toEqual({ fill: "#ff0000" });
		expect((getElement(base(c), "0/0") as Element).pos).toEqual({
			x: 10,
			y: 20,
		});
	});

	it("marks and resets a property control", async () => {
		const { c, user } = inspect(["0/1/1"]);
		expect(screen.queryAllByTestId("override-marker")).toHaveLength(0);
		const area = screen.getByLabelText("Text content");
		fireEvent.change(area, { target: { value: "Hello" } });
		expect(delta(c, "t1")?.properties).toEqual({ value: "Hello" });
		const marker = screen.getByRole("button", { name: "Changed in Dark" });
		await user.click(marker);
		await user.click(
			within(await screen.findByRole("menu")).getByRole("menuitem", {
				name: "Reset to Default",
			}),
		);
		expect(delta(c, "t1")).toBeUndefined();
		expect(screen.getByLabelText("Text content")).toHaveProperty(
			"value",
			"Hi {{ name }}",
		);
	});

	it("resets a whole section, and the side background", async () => {
		const { c, user } = inspect(["0/0"]);
		await user.click(screen.getByRole("button", { name: "Changed in Dark" }));
		await user.click(
			within(await screen.findByRole("menu")).getByRole("menuitem", {
				name: "Reset to Default",
			}),
		);
		expect(delta(c, "a")).toBeUndefined();
		cleanup();

		const bg = inspect(["0/bg"]);
		await bg.user.click(
			screen.getByRole("button", { name: "Changed in Dark" }),
		);
		await bg.user.click(
			within(await screen.findByRole("menu")).getByRole("menuitem", {
				name: "Reset to Default",
			}),
		);
		const front = base(bg.c).variants?.[0]?.overrides.find(
			(o) => o.name === "front",
		);
		expect(front?.background).toBeUndefined();
		expect(front?.elements?.map((d) => d.id)).toEqual(["a", "f1"]);
	});

	it("no markers without an active variant", () => {
		const c = open();
		c.select(["0/0"]);
		mount(c, <DesignPanel />);
		expect(screen.queryAllByTestId("override-marker")).toHaveLength(0);
	});

	it("hides a layer in the variant from the Visibility section", async () => {
		const { c, user } = inspect(["0/5"]);
		await user.click(screen.getByRole("button", { name: "Hide in Dark" }));
		expect(delta(c, "rot")?.hidden).toBe(true);
		expect(base(c).template_data[0]?.elements[5]).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Show in Dark" }));
		expect(delta(c, "rot")).toBeUndefined();
	});

	it("an effect edited in a variant applies to every variant", () => {
		const { c } = inspect(["0/5"]);
		expect(screen.getAllByText("Same in every variant").length).toBeGreaterThan(
			0,
		);
		fireEvent.click(screen.getByRole("button", { name: "Add shadow" }));
		expect((getElement(base(c), "0/5") as Element).shadow).toBeTruthy();
		expect(delta(c, "rot")).toBeUndefined();
	});
});

describe("the layers tree", () => {
	it("marks changed and hidden layers, and hides from the menu", async () => {
		const c = open();
		const user = mount(c, <LayersTree />);
		expect(screen.queryAllByTestId("layer-variant-changed")).toHaveLength(0);
		act(() => c.setVariant("dark"));
		const row = (key: string) => screen.getByTestId(`layer-row-${key}`);
		expect(
			within(row("0/0")).getByTestId("layer-variant-changed"),
		).toBeTruthy();
		expect(
			within(row("0/bg")).getByTestId("layer-variant-changed"),
		).toBeTruthy();
		expect(
			within(row("0/5")).queryByTestId("layer-variant-changed"),
		).toBeNull();

		act(() => c.select(["0/5"]));
		fireEvent.contextMenu(within(row("0/5")).getByText("rot"));
		const menu = await screen.findByRole("menu");
		await user.click(
			within(menu).getByRole("menuitem", { name: "Hide in Dark" }),
		);
		const hidden = within(row("0/5")).getByTestId("layer-variant-hidden");
		expect(hidden.getAttribute("aria-label")).toBe("Hidden in Dark");
		expect(
			within(row("0/5")).getByText("rot").className.includes("opacity-45"),
		).toBe(true);
		// The editor's own eye is a separate view setting.
		expect(c.state.hidden.has("0/5")).toBe(false);
	});
});

describe("variant issues", () => {
	function orphaned(): Template {
		const t = twoVariants();
		const dark = t.variants?.[0];
		if (!dark) throw new Error("fixture");
		dark.overrides[0]?.elements?.push(
			{ id: "gone", properties: { fill: "#123456" } },
			{ id: "title", properties: {} },
		);
		return t;
	}

	it("lists orphans and empty changes with the layer and the variant", async () => {
		const c = open(orphaned());
		const user = mount(c, <Issues />);
		const entries = screen.getAllByTestId("variant-issue");
		expect(entries.map((e) => e.getAttribute("data-code"))).toEqual([
			"variant_orphan_override",
			"variant_empty_override",
		]);
		// Words and a link; the code only in the tooltip.
		expect(entries[0]?.textContent).toBe(
			"Dark changes gone, which isn't on frontVariant · Dark",
		);
		expect(
			entries[0]
				?.querySelector("[title]")
				?.getAttribute("title")
				?.startsWith("variant_orphan_override"),
		).toBe(true);
		await user.click(
			within(entries[1] as HTMLElement).getByRole("button", {
				name: "Show title in Dark",
			}),
		);
		expect(c.state.variantId).toBe("dark");
		expect(c.state.selection).toEqual(["0/4"]);
	});

	it("Remove unused changes drops every orphan in one undo step", async () => {
		const c = open(orphaned());
		const user = mount(c, <Issues />);
		await user.click(
			screen.getByRole("button", { name: "Remove unused changes" }),
		);
		const ids = base(c).variants?.[0]?.overrides[0]?.elements?.map((d) => d.id);
		expect(ids).toEqual(["a", "f1", "title"]);
		expect(past(c)).toBe(1);
		expect(
			screen
				.getAllByTestId("variant-issue")
				.map((e) => e.getAttribute("data-code")),
		).toEqual(["variant_empty_override"]);
	});
});
