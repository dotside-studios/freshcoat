import { expect, test } from "@playwright/test";
import { openSample, run, settle, state } from "./helpers";

const NAME = "0/6";

test("rulers toggle, follow the view and mark the selection", async ({
	page,
}) => {
	await openSample(page);
	await expect(page.getByTestId("ruler-x")).toHaveCount(0);
	await page.getByTestId("viewport").click({ position: { x: 5, y: 400 } });
	await page.keyboard.press("Shift+R");
	await expect(page.getByTestId("ruler-x")).toBeVisible();
	await expect(page.getByTestId("ruler-y")).toBeVisible();

	const view = await state<{ x: number; y: number; zoom: number }>(
		page,
		"s.view",
	);
	await expect(page.getByTestId("ruler-x")).toHaveAttribute(
		"data-origin",
		String(view.x),
	);
	await page.keyboard.press("=");
	await settle(page);
	const zoomed = await state<number>(page, "s.view.zoom");
	expect(zoomed).toBeGreaterThan(view.zoom);
	await expect(page.getByTestId("ruler-x")).toHaveAttribute(
		"data-zoom",
		String(zoomed),
	);

	await run(page, `c.select(["${NAME}"])`);
	const r = await state<{ x: number; width: number }>(
		page,
		`s.geometry.get("${NAME}").rect`,
	);
	const band = page.getByTestId("ruler-x-selection");
	await expect(band).toBeAttached();
	expect(Number(await band.getAttribute("data-from"))).toBeCloseTo(r.x, 1);
	expect(Number(await band.getAttribute("data-to"))).toBeCloseTo(
		r.x + r.width,
		1,
	);

	await page.getByRole("button", { name: "View" }).click();
	await page.getByRole("menuitem", { name: "Rulers" }).click();
	await expect(page.getByTestId("ruler-x")).toHaveCount(0);
});
