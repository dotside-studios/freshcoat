import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutsDialog } from "~/app/ShortcutsDialog";
import { fastUser } from "./aria";

afterEach(cleanup);

const groups = () =>
	screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

describe("the shortcuts sheet", () => {
	it("documents the canvas gestures", () => {
		render(<ShortcutsDialog isOpen onOpenChange={() => {}} />);
		const canvas = screen.getByRole("heading", { name: "Canvas" })
			.parentElement as HTMLElement;
		for (const label of [
			"Pan",
			"Drag without snapping",
			"Select inside groups",
			"Lock to one axis",
			"Draw from the center",
			"Resize from the center",
			"Duplicate while moving",
			"Rename layer",
			"Finish editing text",
		])
			expect(within(canvas).getByText(label)).toBeTruthy();
	});

	it("filters by label, group or key, and says when nothing matches", async () => {
		const user = fastUser();
		render(<ShortcutsDialog isOpen onOpenChange={() => {}} />);
		const field = screen.getByRole("searchbox", { name: "Filter shortcuts" });
		await user.type(field, "distribute");
		expect(groups()).toEqual(["Arrange"]);
		expect(screen.getByText("Distribute horizontally")).toBeTruthy();
		expect(screen.queryByText("Undo")).toBeNull();

		await user.clear(field);
		await user.type(field, "canvas");
		expect(groups()).toEqual(["Canvas"]);

		await user.clear(field);
		await user.type(field, "zzz");
		expect(screen.getByText("No matching shortcuts")).toBeTruthy();
	});
});
