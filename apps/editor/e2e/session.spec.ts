import { expect, test } from "@playwright/test";
import { probePath } from "./helpers";

// Drives the render session through Vite's module server, so the WebGL surface
// reuse is exercised in a real browser without any UI.
test("the render session reuses one surface across repaints", async ({
	page,
}) => {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	const result = await page.evaluate(async (probe) => {
		const { runSessionProbe } = await import(/* @vite-ignore */ probe);
		return runSessionProbe(30);
	}, probePath("session-probe"));
	console.log(JSON.stringify(result));
	expect(result.canvases).toBe(1);
	expect(result.stats.surfaceCreates).toBe(1);
	expect(result.stats.paints).toBe(30);
	expect(result.probe[3]).toBeGreaterThan(0);
});

test("records the uncached baseline for comparison", async ({ page }) => {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	const result = await page.evaluate(async (probe) => {
		const { runUncachedProbe } = await import(/* @vite-ignore */ probe);
		return runUncachedProbe(30);
	}, probePath("session-probe"));
	console.log(`uncached ${JSON.stringify(result)}`);
	expect(result.p50).toBeGreaterThan(0);
});
