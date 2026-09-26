import { expect, test } from "@playwright/test";

test("the editor boots without console errors", async ({ page }) => {
	const errors: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Freshcoat Studio" }),
	).toBeVisible();
	await page.getByTestId("sample-membership-card").click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	expect(errors).toEqual([]);
});
