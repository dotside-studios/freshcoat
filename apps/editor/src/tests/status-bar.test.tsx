import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { StatusBar } from "~/app/StatusBar";
import { fastUser } from "./aria";
import { doc } from "./doc-fixture";

afterEach(cleanup);

function mount() {
	const c = new EditorController();
	c.open(doc(), "doc.coat");
	render(
		<ControllerProvider controller={c}>
			<StatusBar />
		</ControllerProvider>,
	);
	return { c, user: fastUser() };
}

describe("status bar zoom", () => {
	it("takes a typed percentage", async () => {
		const { c, user } = mount();
		const field = screen.getByRole("textbox", { name: "Zoom percentage" });
		await user.click(field);
		await user.keyboard("{Control>}a{/Control}250{Enter}");
		expect(c.state.view.zoom).toBe(2.5);
		expect(field).toHaveProperty("value", "250%");
		await user.click(field);
		await user.keyboard("{Control>}a{/Control}x{Escape}");
		expect(c.state.view.zoom).toBe(2.5);
	});

	it("offers Zoom to selection, off while nothing is selected", async () => {
		const { user } = mount();
		await user.click(screen.getByRole("button", { name: "Zoom" }));
		const item = await screen.findByRole("menuitem", {
			name: /Zoom to selection/,
		});
		expect(item.getAttribute("aria-disabled")).toBe("true");
	});
});
