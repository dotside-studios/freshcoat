import { expect, test } from "@playwright/test";
import { mod, run, settle } from "./helpers";

test("the menu bar panel toggles drive Data and Export", async ({ page }) => {
	await page.goto(`/?theme=light`);
	await page.getByTestId("sample-membership-card").click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	await run(
		page,
		`c.dispatch({ type: "datasetEdit", datasets: [{ id: "d1", name: "people", columns: [{ key: "name", type: "text" }], records: [{ id: "r1", status: "pending", values: { name: "A" } }], assets: [] }] });`,
	);
	const left = page.getByRole("button", { name: "Layers panel" });
	const right = page.getByRole("button", { name: "Inspector panel" });

	await page.keyboard.press(`${mod}+2`);
	await expect(page.getByRole("tab", { name: "Columns" })).toBeVisible();
	await expect(right).toHaveAttribute("aria-pressed", "true");
	await right.click();
	await expect(page.getByRole("tab", { name: "Columns" })).toBeHidden();
	await expect(right).toHaveAttribute("aria-pressed", "false");
	await left.click();
	await expect(left).toHaveAttribute("aria-pressed", "false");
	await right.click();
	await expect(page.getByRole("tab", { name: "Columns" })).toBeVisible();

	await page.keyboard.press(`${mod}+3`);
	await page.getByRole("button", { name: "New preset" }).first().click();
	await page.getByRole("menuitem", { name: "Blank preset" }).click();
	const settings = page.getByTestId("export-settings");
	await expect(settings).toBeVisible();
	await expect(right).toHaveAttribute("aria-pressed", "true");
	await right.click();
	await expect(settings).toBeHidden();
	await left.click();
	await expect(left).toHaveAttribute("aria-pressed", "false");
	await right.click();
	await left.click();
	await expect(settings).toBeVisible();
	await page.keyboard.press(`${mod}+1`);
	await expect(right).toHaveAttribute("aria-pressed", "true");
});
