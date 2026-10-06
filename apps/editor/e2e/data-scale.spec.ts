import { expect, test } from "@playwright/test";
import { mod, openSample, run } from "./helpers";

const N = 100_000;

test("the table opens a 100k-record dataset without a long freeze", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openSample(page);
	await run(
		page,
		`c.dispatch({ type: "datasetEdit", datasets: [{
			id: "d_big",
			name: "Big",
			columns: [
				{ key: "name", type: "text" },
				{ key: "tier", type: "text" },
				{ key: "points", type: "integer" },
				{ key: "verified", type: "boolean" },
			],
			records: Array.from({ length: ${N} }, (_, i) => ({
				id: "r" + i,
				values: { name: "Person " + i, tier: i % 2 ? "Gold" : "Silver", points: i, verified: i % 3 === 0 },
				status: "pending",
			})),
			assets: [],
		}] })`,
	);
	await page.evaluate(() => {
		const w = window as unknown as { __longest: number };
		w.__longest = 0;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries())
				w.__longest = Math.max(w.__longest, e.duration);
		}).observe({ type: "longtask" });
	});
	const start = Date.now();
	await page.keyboard.press(`${mod}+2`);
	const grid = page.getByTestId("records-grid");
	await expect(grid.locator("[role=row][data-row]").first()).toBeVisible();
	const opened = Date.now() - start;
	const rows = await grid.locator("[role=row][data-row]").count();
	const longest = await page.evaluate(
		() => (window as unknown as { __longest: number }).__longest,
	);
	console.log(
		`data-scale: opened in ${opened} ms, longest task ${longest.toFixed(0)} ms, ${rows} rows mounted`,
	);
	expect(rows).toBeLessThan(200);
	expect(longest).toBeLessThan(500);

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
