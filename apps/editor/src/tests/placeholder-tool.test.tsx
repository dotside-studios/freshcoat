import type { Element, Template } from "@freshcoat-js/coatfile";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { ToolStrip } from "~/app/ToolStrip";
import { placeholderSrc } from "~/doc/factories";
import { getElement } from "~/doc/path";
import { fastUser } from "./aria";
import { doc } from "./doc-fixture";

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

function setup(t: Template = doc()) {
	const controller = new EditorController();
	controller.open(t, "doc.coat");
	const pickImage = vi.fn();
	const ctx = { controller, pickImage } as unknown as CommandContext;
	render(
		<ControllerProvider controller={controller}>
			<ToolStrip ctx={ctx} />
		</ControllerProvider>,
	);
	return { controller, pickImage };
}

describe("placeholderSrc", () => {
	it("binds to the first image field", () => {
		const t = doc();
		t.fields.properties.photo = { type: "string", format: "image" };
		expect(placeholderSrc(t)).toBe("{{photo}}");
	});

	it("is empty without an image field", () => {
		const t = doc();
		t.fields = { type: "object", properties: {} };
		expect(placeholderSrc(t)).toBe("");
	});
});

describe("Image tool group", () => {
	it("opens the picker on a click", async () => {
		const user = fastUser();
		const { pickImage } = setup();
		await user.click(screen.getByTestId("tool-image"));
		expect(pickImage).toHaveBeenCalledOnce();
	});

	it("switches to the placeholder tool from the right-click menu", async () => {
		const user = fastUser();
		const { controller, pickImage } = setup();
		fireEvent.contextMenu(screen.getByTestId("tool-image"));
		await user.click(
			await screen.findByRole("menuitem", { name: /Image placeholder/ }),
		);
		expect(controller.state.tool).toBe("placeholder");
		expect(pickImage).not.toHaveBeenCalled();
		expect(screen.getByTestId("tool-placeholder")).toBeTruthy();
		expect(screen.queryByTestId("tool-image")).toBeNull();
	});
});

describe("placeholder", () => {
	it("creates an image bound to the first image field", () => {
		const t = doc();
		t.fields.properties.photo = { type: "string", format: "image" };
		const controller = new EditorController();
		controller.open(t, "doc.coat");
		const key = controller.create(
			"image",
			{ x: 10, y: 10, width: 100, height: 80 },
			{ x: 10, y: 10 },
		) as string;
		const el = getElement(controller.template as Template, key) as Element;
		expect(el.type).toBe("image");
		expect((el.properties as { src: string }).src).toBe("{{photo}}");
	});
});
