import type { Template } from "@freshcoat-js/coatfile";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { PrintPanel } from "~/panels/print/PrintPanel";
import { RightPanel } from "~/panels/RightPanel";
import { fastUser } from "./aria";
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

function show(c: EditorController, ui: React.ReactNode) {
	render(<ControllerProvider controller={c}>{ui}</ControllerProvider>);
}

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("the Print tab", () => {
	it("is the third inspector tab", async () => {
		const c = open(["0/0"]);
		show(c, <RightPanel />);
		expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
			"Design",
			"Content",
			"Print",
		]);
		await fastUser().click(screen.getByRole("tab", { name: "Print" }));
		expect(c.state.rightTab).toBe("print");
		expect(screen.getByTestId("print-panel")).toBeTruthy();
	});

	it("shows slice and spot for a sliceable rect, and Design does not", () => {
		const c = open(["0/0"]);
		show(
			c,
			<>
				<PrintPanel />
				<DesignPanel />
			</>,
		);
		const print = screen.getByTestId("print-inspector");
		expect(print.textContent).toContain("Slice");
		expect(print.textContent).toContain("Spot color");
		const design = screen.getByTestId("design-inspector");
		expect(design.textContent).not.toContain("Slice");
		expect(design.textContent).not.toContain("Spot color");
	});

	it("says there are no print settings for a layer that takes none", () => {
		const t = doc();
		const c = open(["0/1/1"], t);
		expect(getElement(t, "0/1/1")?.type).toBe("text");
		show(c, <PrintPanel />);
		expect(screen.getByText("No print settings")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("opens Template setup from the empty state with nothing selected", async () => {
		const c = open([]);
		const onTemplateSetup = vi.fn();
		show(c, <PrintPanel onTemplateSetup={onTemplateSetup} />);
		await fastUser().click(
			screen.getByRole("button", { name: "Template setup…" }),
		);
		expect(onTemplateSetup).toHaveBeenCalledOnce();
	});

	it("labels overprint as its own row", async () => {
		const c = open(["0/0"]);
		show(c, <PrintPanel />);
		const user = fastUser();
		await user.click(screen.getByRole("button", { name: "Add spot ink" }));
		await user.click(screen.getByRole("menuitem", { name: "Fill" }));
		expect(screen.getByText("Overprint")).toBeTruthy();
		expect(
			(screen.getByRole("checkbox", { name: "Overprint" }) as HTMLInputElement)
				.checked,
		).toBe(true);
	});
});

describe("the side section in Design", () => {
	it("has no bleed or safe area rows", () => {
		const c = open([]);
		show(c, <DesignPanel />);
		const side = screen.getByTestId("design-inspector");
		expect(side.getAttribute("data-mode")).toBe("side");
		expect(screen.getByTestId("side-size")).toBeTruthy();
		expect(screen.queryByText("Bleed")).toBeNull();
		expect(screen.queryByText("Safe area")).toBeNull();
		expect(
			screen.queryByRole("spinbutton", { name: "Template bleed" }),
		).toBeNull();
	});
});
