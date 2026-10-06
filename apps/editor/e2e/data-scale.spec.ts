import { expect, type Page, test } from "@playwright/test";
import { mod, openSample, run } from "./helpers";

const N = 100_000;

async function addBigDataset(page: Page, columns: string) {
	await run(
		page,
		`const t = ["Gold", "Silver", "Bronze"];
		const columns = ${columns};
		c.dispatch({ type: "datasetEdit", datasets: [{
			id: "d_big",
			name: "Big",
			columns,
			records: Array.from({ length: ${N} }, (_, i) => ({
				id: "r" + i,
				values: Object.fromEntries(columns.map((col) => [col.key,
					col.type === "integer" ? i : col.type === "boolean" ? i % 3 === 0 : col.key + " " + i])),
				status: "pending",
			})),
			assets: [],
		}] })`,
	);
}

async function watchLongTasks(page: Page) {
	await page.evaluate(() => {
		const w = window as unknown as { __longest: number };
		w.__longest = 0;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries())
				w.__longest = Math.max(w.__longest, e.duration);
		}).observe({ type: "longtask" });
	});
	const start = Date.now();
	return async (what: string, rows: number) => {
		const longest = await page.evaluate(
			() => (window as unknown as { __longest: number }).__longest,
		);
		console.log(
			`data-scale ${what}: shown in ${Date.now() - start} ms, longest task ${longest.toFixed(0)} ms, ${rows} rows mounted`,
		);
		return longest;
	};
}

test("the table opens a 100k-record dataset without a long freeze", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openSample(page);
	await addBigDataset(
		page,
		`[{ key: "name", type: "text" }, { key: "tier", type: "text" }, { key: "points", type: "integer" }, { key: "verified", type: "boolean" }]`,
	);
	const report = await watchLongTasks(page);
	await page.keyboard.press(`${mod}+2`);
	const grid = page.getByTestId("records-grid");
	await expect(grid.locator("[role=row][data-row]").first()).toBeVisible();
	const rows = await grid.locator("[role=row][data-row]").count();
	expect(rows).toBeLessThan(200);
	expect(await report("table", rows)).toBeLessThan(500);

	const cell = (row: number, col: string) =>
		grid.locator(`[role=gridcell][data-row="r${row}"][data-col="${col}"]`);
	await cell(0, "name").click();
	await page.keyboard.press(`${mod}+ArrowDown`);
	await expect(cell(N - 1, "name")).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowRight");
	await expect(cell(N - 2, "tier")).toBeFocused();
	await page.keyboard.press(`${mod}+ArrowUp`);
	await expect(cell(0, "tier")).toBeFocused();
});

test("the gallery opens a 100k-record photo dataset without a long freeze", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openSample(page);
	await addBigDataset(
		page,
		`[{ key: "photo", type: "image" }, { key: "file_name", type: "text" }]`,
	);
	const report = await watchLongTasks(page);
	await page.keyboard.press(`${mod}+2`);
	const gallery = page.getByTestId("records-gallery");
	const card = (i: number) => gallery.locator(`[role=row][data-row="r${i}"]`);
	await expect(card(0)).toBeVisible();
	const rows = await gallery.locator("[role=row]").count();
	expect(rows).toBeLessThan(200);
	expect(await report("gallery", rows)).toBeLessThan(500);

	await card(0).click();
	await page.keyboard.press("End");
	await expect(card(N - 1)).toBeFocused();
	await expect(page.getByTestId("data-status-selected")).toHaveText(
		"1 selected",
	);
	await page.keyboard.press("Shift+ArrowLeft");
	await expect(page.getByTestId("data-status-selected")).toHaveText(
		"2 selected",
	);
	await page.keyboard.press("Home");
	await expect(card(0)).toBeFocused();
});

test("the export records list shows a 100k-record dataset without a long freeze", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openSample(page, "membership-card");
	await addBigDataset(
		page,
		`Object.keys(c.template.fields.properties).map((key) => ({ key, type: "text" }))`,
	);
	await page.keyboard.press(`${mod}+3`);
	await page
		.getByTestId("export-presets")
		.getByRole("button", { name: "New preset" })
		.click();
	await page
		.getByTestId("binding-editor")
		.getByRole("button", { name: /Dataset/ })
		.click();
	await page.getByRole("option", { name: "Big" }).click();
	const report = await watchLongTasks(page);
	await page.getByRole("tab", { name: "Records" }).click();
	const list = page.getByTestId("export-records");
	await expect(list.locator('[role=row][data-row="r0"]')).toBeVisible();
	const rows = await list.locator("[role=row][data-row]").count();
	expect(rows).toBeLessThan(200);
	// Switching to the Records tab costs about 350 ms at any size in the
	// development build.
	expect(await report("export list", rows)).toBeLessThan(800);

	await list.locator("[role=grid]").evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect(list.locator(`[role=row][data-row="r${N - 1}"]`)).toBeVisible();
});
