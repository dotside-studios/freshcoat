import { expect, test } from "@playwright/test";
import { artboardPoint, openSample, settle } from "./helpers";

test("the separations preview marks a spot ink and hides it from the legend", async ({
	page,
}) => {
	await openSample(page);
	await page.keyboard.press("r");
	const p = await artboardPoint(page, 500, 300);
	await page.mouse.click(p.x, p.y);
	await settle(page);

	await page.getByRole("tab", { name: "Print" }).click();
	await page.getByRole("button", { name: "Add spot ink" }).click();
	await page.getByRole("menuitem", { name: "Fill" }).click();
	await settle(page);

	await expect(page.getByTestId("separations-legend")).toHaveCount(0);
	const toggle = page.getByRole("button", { name: "Separations" });
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");

	const legend = page.getByTestId("separations-legend");
	await expect(legend).toContainText("White");
	await expect(legend).toContainText("Overprint");
	await expect(page.locator('path[data-ink="White"]')).toHaveCount(1);

	await page.getByTestId("separations-ink").click();
	await expect(page.locator('path[data-ink="White"]')).toHaveCount(0);
	await page.getByTestId("separations-ink").click();
	await expect(page.locator('path[data-ink="White"]')).toHaveCount(1);

	await toggle.click();
	await expect(page.getByTestId("separations-legend")).toHaveCount(0);
});

test("View > Separations says when the side has no spot inks", async ({
	page,
}) => {
	await openSample(page);
	await page.getByRole("button", { name: "View" }).click();
	await page.getByRole("menuitem", { name: "Separations" }).click();
	await expect(page.getByTestId("separations-legend")).toHaveText(
		"No spot inks",
	);
});
