import { expect, type Page, test } from "@playwright/test";
import { openSample, run, settle, state } from "./helpers";

type Painted = { pixels: string; width: number; geometry: string };

/** The painted artboard and the layer boxes read off the same render. */
async function painted(page: Page): Promise<Painted> {
	return page.evaluate(async () => {
		const f = (
			window as unknown as {
				__freshcoat: {
					snapshot(): Promise<HTMLCanvasElement>;
					controller: { state: { geometry: Map<string, unknown> } };
				};
			}
		).__freshcoat;
		const c = await f.snapshot();
		return {
			pixels: c.toDataURL(),
			width: c.width,
			geometry: JSON.stringify([...f.controller.state.geometry]),
		};
	});
}

function previewMode(page: Page) {
	return page.evaluate(
		() =>
			(window as unknown as { __freshcoat: { previewMode: string } })
				.__freshcoat.previewMode,
	);
}

async function onMainThread(page: Page) {
	await page.addInitScript(() => {
		(
			window as unknown as { __freshcoatPreviewWorker: boolean }
		).__freshcoatPreviewWorker = false;
	});
}

test("the Edit canvas paints from a worker", async ({ page }) => {
	await openSample(page);
	expect(await previewMode(page)).toBe("worker");
	const canvas = page.getByTestId("artboard-canvas");
	expect(await canvas.count()).toBe(1);
	const before = await painted(page);
	expect(before.width).toBeGreaterThan(0);
	await run(page, `c.select(["0/6"])`);
	await page.keyboard.press("ArrowRight");
	await settle(page);
	expect((await painted(page)).pixels).not.toBe(before.pixels);
	// The worker keeps painting the same element.
	expect(await canvas.count()).toBe(1);
});

for (const sample of ["membership-card", "certificate", "minimal"]) {
	test(`worker and main thread paint ${sample} alike`, async ({ browser }) => {
		// Two pages, each making a second surface through SwiftShader.
		test.setTimeout(150_000);
		const worker = await browser.newPage();
		const main = await browser.newPage();
		await onMainThread(main);
		await openSample(worker, sample);
		await openSample(main, sample);
		expect(await previewMode(worker)).toBe("worker");
		expect(await previewMode(main)).toBe("main");
		expect(await painted(worker)).toEqual(await painted(main));

		// A new density makes a new surface on both paths.
		for (const page of [worker, main]) {
			await run(page, "c.zoomTo(c.state.view.zoom * 1.5)");
			await settle(page);
		}
		const zoomedWorker = await painted(worker);
		expect(zoomedWorker).toEqual(await painted(main));
		await worker.close();
		await main.close();
	});
}

test("the worker paints again after losing its GPU context", async ({
	page,
}) => {
	await openSample(page);
	const before = await painted(page);
	await page.evaluate(() =>
		(
			window as unknown as { __freshcoat: { loseContext(): void } }
		).__freshcoat.loseContext(),
	);
	await expect
		.poll(async () => {
			await settle(page);
			return (await painted(page)).pixels;
		})
		.toBe(before.pixels);
	expect(await state<string>(page, "s.render.status")).toBe("ok");
});

test("without a worker the main thread paints, and drags still move layers", async ({
	page,
}) => {
	await onMainThread(page);
	await openSample(page);
	expect(await previewMode(page)).toBe("main");
	const x = await state<number>(page, `s.geometry.get("0/6").rect.x`);
	await run(page, `c.select(["0/6"])`);
	await page.keyboard.press("Shift+ArrowRight");
	await settle(page);
	expect(await state<number>(page, `s.geometry.get("0/6").rect.x`)).toBe(
		x + 10,
	);
});
