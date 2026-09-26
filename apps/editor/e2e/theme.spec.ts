import { expect, test } from "@playwright/test";
import { openSample } from "./helpers";

const theme = (page: import("@playwright/test").Page) =>
	page.evaluate(() => document.documentElement.dataset.theme ?? null);

test("light by default", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("sample-membership-card").waitFor();
	expect(await theme(page)).toBe("light");
	const bg = await page.evaluate(
		() => getComputedStyle(document.documentElement).colorScheme,
	);
	expect(bg).toBe("light");
});

test("View > Theme > Dark persists across a reload", async ({ page }) => {
	await openSample(page);
	await page.getByRole("button", { name: "View" }).click();
	await page.getByRole("menuitem", { name: "Theme" }).hover();
	await page.getByRole("menuitemradio", { name: "Dark" }).click();
	expect(await theme(page)).toBe("dark");
	await page.reload();
	await page.getByTestId("sample-membership-card").waitFor();
	expect(await theme(page)).toBe("dark");
	expect(
		await page.evaluate(() => localStorage.getItem("freshcoat.theme")),
	).toBe("dark");
});

test("?theme=dark applies without persisting", async ({ page }) => {
	await page.goto("/?theme=dark");
	await page.getByTestId("sample-membership-card").waitFor();
	expect(await theme(page)).toBe("dark");
	expect(
		await page.evaluate(() => localStorage.getItem("freshcoat.theme")),
	).toBeNull();
	await page.goto("/");
	expect(await theme(page)).toBe("light");
});

test("the menu bar is set in Inter", async ({ page }) => {
	await openSample(page);
	const menu = page.getByRole("button", { name: "File", exact: true });
	const family = await menu.evaluate((el) => getComputedStyle(el).fontFamily);
	expect(family).toMatch(/^"?Inter/);
	expect(
		await page.evaluate(async () => {
			await document.fonts.ready;
			return document.fonts.check('12px "Inter Variable"');
		}),
	).toBe(true);
});
