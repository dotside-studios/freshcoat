import type { Element, Template } from "@freshcoat-js/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { updateElement } from "~/doc/ops";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { LeftPanel } from "~/panels/LeftPanel";
import { doc, geometryOf } from "./doc-fixture";
import { countRenders, trackRenders } from "./render-count";

const SECTIONS = [
	"AlignSection",
	"LayerSection",
	"ConstraintsSection",
	"FillSection",
	"StrokeSection",
	"CornersSection",
	"EffectsSection",
	"AdjustSection",
	"VisibilitySection",
];

function rendered(c: EditorController) {
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(c.template as Template),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
}

/** One side of `n` rects, so `0/i` is rect `r{i}`. */
function rects(n: number): Template {
	const t = doc();
	t.template_data[0].elements = Array.from(
		{ length: n },
		(_, i): Element => ({
			id: `r${i}`,
			type: "rect",
			pos: { x: i, y: i },
			size: { width: 10, height: 10 },
			properties: { fill: "#111111" },
		}),
	);
	return t;
}

function setup(t: Template, ui: React.ReactNode) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	rendered(c);
	render(<ControllerProvider controller={c}>{ui}</ControllerProvider>);
	return c;
}

function scrubHandle(name: string): HTMLElement {
	return screen
		.getByRole("spinbutton", { name })
		.parentElement?.querySelector("[data-scrub-handle]") as HTMLElement;
}

beforeAll(() => {
	Element.prototype.scrollIntoView ??= () => {};
	// jsdom has no CSS.escape, which react-aria uses to find items by key.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
	trackRenders();
});
afterEach(cleanup);

describe("Layers tree renders", () => {
	it("a canvas hover lights the row without re-rendering the tree", () => {
		const c = setup(rects(200), <LeftPanel />);
		const row = (key: string) => screen.getByTestId(`layer-row-${key}`);
		const counts = countRenders(() => {
			act(() => c.dispatch({ type: "hover", key: "0/3" }));
			act(() => c.dispatch({ type: "hover", key: "0/4" }));
		});
		expect(counts.get("LayersTree") ?? 0).toBe(0);
		expect(counts.size).toBe(0);
		expect(row("0/3").hasAttribute("data-canvas-hover")).toBe(false);
		expect(row("0/4").hasAttribute("data-canvas-hover")).toBe(true);
		act(() => c.dispatch({ type: "hover", key: null }));
		expect(row("0/4").hasAttribute("data-canvas-hover")).toBe(false);
	});

	it("hiding a layer re-renders one row's toggles, not the tree", () => {
		const c = setup(rects(200), <LeftPanel />);
		const counts = countRenders(() => {
			act(() => c.toggleHidden(["0/7"]));
		});
		expect(counts.get("LayersTree") ?? 0).toBe(0);
		expect(counts.get("RowToggles")).toBe(1);
	});
});

describe("Design panel renders", () => {
	it("a scrub step re-renders only the geometry fields", () => {
		const c = setup(rects(200), <DesignPanel />);
		act(() => c.select(["0/0"]));
		const handle = scrubHandle("X");
		fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0 });
		act(() => {
			fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10 });
			rendered(c);
		});
		const counts = countRenders(() => {
			act(() => {
				fireEvent.pointerMove(handle, { pointerId: 1, clientX: 11 });
			});
			act(() => rendered(c));
		});
		fireEvent.pointerUp(handle, { pointerId: 1, clientX: 11 });
		expect(counts.get("GeometryFields")).toBe(1);
		for (const name of SECTIONS) expect(counts.get(name) ?? 0).toBe(0);
		expect(screen.getByRole("spinbutton", { name: "X" })).toHaveProperty(
			"value",
			String(c.template?.template_data[0].elements[0].pos?.x),
		);
	});

	it("another layer moving re-renders no section", () => {
		const c = setup(rects(200), <DesignPanel />);
		act(() => c.select(["0/0"]));
		const geometry = new Map(c.state.geometry);
		const box = geometry.get("0/5");
		if (box) geometry.set("0/5", { ...box, rect: { ...box.rect, x: 99 } });
		const counts = countRenders(() => {
			act(() =>
				c.dispatch({
					type: "rendered",
					geometry,
					timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
					stats: {} as never,
					warnings: [],
				}),
			);
		});
		expect(c.state.geometry).toBe(geometry);
		for (const name of [...SECTIONS, "GeometryFields"])
			expect(counts.get(name) ?? 0).toBe(0);
	});

	it("an edit beyond position still reaches the sections", () => {
		const c = setup(rects(200), <DesignPanel />);
		act(() => c.select(["0/0"]));
		const counts = countRenders(() => {
			act(() => {
				c.edit((t) => updateElement(t, "0/0", { opacity: 0.5 }));
			});
		});
		expect(counts.get("LayerSection")).toBe(1);
		expect(
			(screen.getByRole("spinbutton", { name: "Opacity" }) as HTMLInputElement)
				.value,
		).toMatch(/^50/);
	});
});
