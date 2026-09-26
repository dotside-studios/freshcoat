import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, type Page, test } from "@playwright/test";
import { mod, probePath, state } from "./helpers";
import { PHOTO_INPUT, pickGeneratedPhotos } from "./photo-folder";

// Filmstrip memory check: stepping the Export
// preview through 200 camera-sized photos keeps the main thread's heap
// bounded. The photos are the same 200 generated 12 MP JPEGs on disk as the
// export half in watermark.spec.ts, picked into a file input and imported
// as "New dataset from photos" does.

test("stepping the filmstrip through 200 12 MP photos keeps the heap bounded", async ({
	browserName,
}, info) => {
	test.setTimeout(900_000);
	test.skip(browserName !== "chromium", "performance.memory is Chromium's");
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-filmstrip-"));
	// Precise heap numbers need a launch flag, so this runs in its own
	// persistent context, as the export half does.
	const context = await chromium.launchPersistentContext(dir, {
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
		viewport: { width: 1440, height: 900 },
		args: [
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
			"--enable-precise-memory-info",
		],
		baseURL: info.project.use.baseURL,
	});
	try {
		await stepFilmstrip(
			context.pages()[0] ?? (await context.newPage()),
			join(dir, "photos"),
		);
	} finally {
		await context.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

/** The page's JS heap, after a full collection when `gc` is set. Without
 *  one, a reading counts whatever garbage the collector has not reached
 *  yet, which swings by 100 MB or so with the collector's timing and the
 *  machine's load, while the collected heap stays within a few MB. */
async function heap(page: Page, gc = false): Promise<number> {
	if (gc) {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("HeapProfiler.collectGarbage");
		await cdp.detach();
	}
	return page.evaluate(
		() =>
			(performance as Performance & { memory?: { usedJSHeapSize: number } })
				.memory?.usedJSHeapSize ?? 0,
	);
}

async function stepFilmstrip(page: Page, dir: string) {
	const COUNT = 200;
	await page.goto("/?starter=photo-watermark");
	await expect
		.poll(() => state<number>(page, "s.workspace?.presets.length ?? 0"))
		.toBe(1);
	await pickGeneratedPhotos(page, dir, {
		count: COUNT,
		width: 4000,
		height: 3000,
	});
	await page.evaluate(
		async ({ selector, actionsPath }) => {
			const actions = await import(/* @vite-ignore */ actionsPath);
			const input = document.querySelector(selector) as HTMLInputElement;
			const c = (
				window as unknown as {
					__freshcoat: {
						controller: {
							state: { workspace: { activeTemplateId: string } };
							dispatch(a: unknown): void;
						};
					};
				}
			).__freshcoat.controller;
			const dataset = await actions.newDatasetFromPhotos(
				c,
				[...(input.files ?? [])],
				"Photos",
			);
			c.dispatch({
				type: "setBinding",
				id: c.state.workspace.activeTemplateId,
				binding: {
					datasetId: dataset.id,
					fields: { photo: { kind: "column", column: "photo" } },
				},
			});
		},
		{ selector: PHOTO_INPUT, actionsPath: probePath("app-probe") },
	);
	await page.keyboard.press(`${mod}+3`);
	const strip = page.getByTestId("export-filmstrip");
	await expect(strip.getByRole("option").first()).toBeVisible();
	const preview = page.getByTestId("export-preview");
	const ids = await state<string[]>(
		page,
		"s.workspace.datasets.find((d) => d.name === 'Photos').records.map((r) => r.id)",
	);
	expect(ids).toHaveLength(COUNT);
	await expect(preview).toHaveAttribute("data-item", `${ids[0]}:photo`, {
		timeout: 60_000,
	});

	await strip.focus();
	const baseline = await heap(page, true);
	// What stepping keeps: the heap after a collection, every 20 steps.
	const kept: number[] = [];
	let raw = baseline;
	const t0 = Date.now();
	for (let i = 1; i < COUNT; i++) {
		await page.keyboard.press("ArrowRight");
		// Every photo is decoded and painted before the next step.
		await expect(preview).toHaveAttribute("data-item", `${ids[i]}:photo`, {
			timeout: 60_000,
		});
		if (i % 20 === 0) {
			raw = Math.max(raw, await heap(page));
			kept.push(await heap(page, true));
		}
	}
	const ms = Date.now() - t0;
	const settled = await heap(page, true);
	kept.push(settled);
	const mb = (n: number) => Math.round(n / 1024 / 1024);
	const most = Math.max(...kept);
	const half = kept[Math.floor(kept.length / 2) - 1] ?? baseline;
	console.log(
		`filmstrip: ${COUNT} photos stepped in ${Math.round(ms / 1000)} s (${Math.round(ms / COUNT)} ms a step), heap ${mb(baseline)} MB, after gc at most ${mb(most)} MB (+${mb(most - baseline)}), ${mb(settled)} MB at the end, ${mb(raw)} MB before gc at most`,
	);
	expect(await state<string>(page, "s.exportRecordId")).toBe(ids.at(-1));
	await expect(page.getByTestId("export-stepper-position")).toHaveText(
		`${COUNT} / ${COUNT}`,
	);
	// the strip mounts only what is in view
	expect(await strip.getByRole("option").count()).toBeLessThan(40);
	expect(baseline).toBeGreaterThan(0);
	// Bounded: the preview and thumbnail caches fill and then stay full.
	expect(most - baseline).toBeLessThan(150 * 1024 * 1024);
	// And not leaking: the second hundred steps keep what the first did.
	// A decoded preview left behind is 12 MB or more a step.
	expect(settled - half).toBeLessThan(40 * 1024 * 1024);
}
