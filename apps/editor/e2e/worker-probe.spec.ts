import { expect, test } from "@playwright/test";
import { probePath } from "./helpers";

test("CanvasKit renders a template inside a module worker", async ({
	page,
}) => {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	const out = await page.evaluate(async (p) => {
		const { runWorkerProbe } = await import(/* @vite-ignore */ p);
		return runWorkerProbe();
	}, probePath("worker-probe"));
	console.log(JSON.stringify(out));
	expect((out as { bytes: number }).bytes).toBeGreaterThan(1000);
});
