import { expect, test } from "@playwright/test";
import {
	artboardPoint,
	dragTemplate,
	mod,
	openSample,
	run,
	settle,
	state,
} from "./helpers";

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

test("guides come from the rulers, snap layers and undo", async ({ page }) => {
	await openSample(page);
	await page.keyboard.press("Shift+R");
	const ruler = page.getByTestId("ruler-y");
	const rb = (await ruler.boundingBox()) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	const r = await state<{ x: number; y: number; width: number }>(
		page,
		`s.geometry.get("${NAME}").rect`,
	);
	const target = r.x - 17;
	const at = await artboardPoint(page, target, r.y);
	await page.mouse.move(rb.x + 10, at.y);
	await page.mouse.down();
	for (let i = 1; i <= 8; i++)
		await page.mouse.move(rb.x + 10 + ((at.x - rb.x - 10) * i) / 8, at.y);
	await page.mouse.up();
	const guide = page.getByRole("slider", { name: "Vertical guide" });
	await expect(guide).toBeVisible();
	const value = Number(await guide.getAttribute("aria-valuenow"));
	expect(value).toBeCloseTo(target, -0.5);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(1);

	await run(page, `c.select(["${NAME}"])`);
	await dragTemplate(page, { x: r.x + 20, y: r.y + 20 }, { x: -15, y: 0 });
	const moved = await state<{ x: number }>(
		page,
		`s.geometry.get("${NAME}").rect`,
	);
	expect(moved.x).toBeCloseTo(value, 1);

	await page.keyboard.press(`${mod}+z`);
	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	await expect(guide).toHaveCount(0);
	await page.keyboard.press(`${mod}+Shift+z`);
	await expect(guide).toBeVisible();

	const gb = (await guide.boundingBox()) as { x: number; y: number };
	await page.mouse.move(gb.x + 3, at.y + 200);
	await page.mouse.down();
	await page.mouse.move(gb.x - 20, at.y + 200, { steps: 4 });
	await page.mouse.move(rb.x + 8, at.y + 200, { steps: 4 });
	await page.mouse.up();
	await expect(guide).toHaveCount(0);
});

test("guides work from the keyboard", async ({ page }) => {
	await openSample(page);
	await page.keyboard.press("Shift+R");
	await page.getByRole("button", { name: "Add horizontal guide" }).focus();
	await page.keyboard.press("Enter");
	const guide = page.getByRole("slider", { name: "Horizontal guide" });
	await expect(guide).toBeFocused();
	const start = Number(await guide.getAttribute("aria-valuenow"));
	await page.keyboard.press("Shift+ArrowDown");
	await page.keyboard.press("ArrowUp");
	await expect(guide).toHaveAttribute("aria-valuenow", String(start + 9));
	await page.keyboard.press("Delete");
	await expect(guide).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Add horizontal guide" }),
	).toBeFocused();
});
