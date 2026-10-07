import type { Template } from "@freshcoat-js/coatfile";
import { afterEach, expect, it, vi } from "vitest";
import { EditorController } from "~/app/controller";
import { doc } from "./doc-fixture";

const toast = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("@freshcoat-js/ui/toast", async (actual) => ({
	...(await actual<object>()),
	toast,
}));
vi.mock("~/app/svg", async (actual) => ({
	...(await actual<object>()),
	loadSvgImport: () => Promise.reject(new Error("offline")),
}));

const ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><path d="M0 0h24v12H0z"/></svg>';

afterEach(() => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: undefined,
	});
});

it("pastes SVG-looking text as text when the importer fails to load", async () => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { readText: async () => ICON, writeText: async () => {} },
	});
	const c = new EditorController();
	c.open(doc(), "doc.coat");
	await c.paste();
	const placed = (c.template as Template).template_data[0].elements.at(-1);
	expect(placed?.type === "text" && placed.properties.value).toBe(ICON);
	expect(toast).toHaveBeenCalledWith(
		"Couldn't load the SVG importer",
		expect.anything(),
	);
});
