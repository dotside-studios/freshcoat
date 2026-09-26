import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, type Page, test } from "@playwright/test";
import { mod, openSample, state } from "./helpers";
import { PHOTO_INPUT, pickGeneratedPhotos } from "./photo-folder";

// A probe more than a test: it records how the gallery scrolls through
// 2,000 photo records and fails only on gross regressions. Run it on its own
// for numbers worth comparing, and against the production build
// (FRESHCOAT_PREVIEW=1) for numbers worth quoting.

// One at a time: the memory probe decodes camera photos on every core.
test.describe.configure({ mode: "serial" });

const card = (page: Page, id: string) =>
	page.locator(`[data-testid=records-gallery] [role=row][data-row="${id}"]`);

test("2,000 photo records scroll in a virtualised gallery that asks only for visible thumbnails", async ({
	page,
}, info) => {
	test.setTimeout(300_000);
	// Count what reaches the thumbnail worker.
	await page.addInitScript(() => {
		const post = Worker.prototype.postMessage;
		const w = window as unknown as { __thumbRequests: number };
		w.__thumbRequests = 0;
		Worker.prototype.postMessage = function (
			this: Worker,
			message: unknown,
			...rest: unknown[]
		) {
			if ((message as { kind?: string })?.kind === "thumb")
				w.__thumbRequests += 1;
			return (post as (...a: unknown[]) => void).call(this, message, ...rest);
		} as typeof Worker.prototype.postMessage;
	});
	await openSample(page);
	await page.keyboard.press(`${mod}+2`);
	const N = 2000;
	await page.evaluate(async (n) => {
		const blobs: Blob[] = [];
		for (let i = 0; i < 16; i++) {
			const c = new OffscreenCanvas(1200, 900);
			const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
			g.fillStyle = `hsl(${i * 22} 55% 50%)`;
			g.fillRect(0, 0, 1200, 900);
			g.fillStyle = "#fff";
			g.fillRect(200, 150, 800, 600);
			blobs.push(await c.convertToBlob({ type: "image/jpeg" }));
		}
		const hex = (i: number) => i.toString(16).padStart(64, "0");
		const assets = Array.from({ length: n }, (_, i) => {
			const blob = blobs[i % blobs.length] as Blob;
			return {
				sha256: hex(i + 1),
				contentType: "image/jpeg",
				name: `IMG_${i + 1}.jpg`,
				size: blob.size,
				width: 1200,
				height: 900,
				blob,
			};
		});
		const c = (
			window as unknown as {
				__freshcoat: { controller: { dispatch(a: unknown): void } };
			}
		).__freshcoat.controller;
		c.dispatch({
			type: "datasetEdit",
			datasets: [
				{
					id: "d_bulk",
					name: "Bulk",
					columns: [
						{ key: "photo", type: "image" },
						{ key: "file_name", type: "text" },
					],
					records: assets.map((a, i) => ({
						id: `r_${i}`,
						values: { photo: `ws:${a.sha256}`, file_name: a.name },
						status: "pending",
					})),
					assets,
				},
			],
			activeId: "d_bulk",
		});
	}, N);
	const grid = page.locator("[data-testid=records-gallery] [role=grid]");
	await expect(grid).toBeVisible();
	await expect(card(page, "r_0").locator("img")).toBeVisible();
	const mounted = await page
		.locator("[data-testid=records-gallery] [role=row]")
		.count();
	expect(mounted).toBeLessThan(120);

	// Let the autosave write the photos before measuring.
	await page.waitForTimeout(4000);

	const result = await page.evaluate(async () => {
		const el = document.querySelector(
			"[data-testid=records-gallery] [role=grid]",
		) as HTMLElement;
		let long = 0;
		const obs = new PerformanceObserver((list) => {
			long += list.getEntries().length;
		});
		try {
			obs.observe({ type: "longtask", buffered: false });
		} catch {}
		const run = (px: number, count: number) =>
			new Promise<number[]>((resolve) => {
				const frames: number[] = [];
				let last = -1;
				const step = (t: number) => {
					if (last >= 0) frames.push(t - last);
					last = t;
					el.scrollTop += px;
					if (frames.length < count) requestAnimationFrame(step);
					else resolve(frames);
				};
				requestAnimationFrame(step);
			});
		const stats = (frames: number[]) => {
			const sorted = [...frames].sort((a, b) => a - b);
			const at = (p: number) =>
				sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
			return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 };
		};
		// About two rows of cards a second, then a fling of a screen a frame.
		const steady = stats(await run(8, 240));
		const fling = stats(await run(600, 100));
		obs.disconnect();
		return {
			steady,
			fling,
			long,
			scrolledTo: el.scrollTop,
			height: el.scrollHeight,
			requests: (window as unknown as { __thumbRequests: number })
				.__thumbRequests,
		};
	});
	const f = (x: { p50: number; p95: number; max: number }) =>
		`p50 ${x.p50.toFixed(1)} / p95 ${x.p95.toFixed(1)} / max ${x.max.toFixed(1)} ms`;
	const summary = `steady ${f(result.steady)}; fling ${f(result.fling)}; long tasks ${result.long}; thumbnails made ${result.requests} of ${N}`;
	info.annotations.push({ type: "gallery-scroll", description: summary });
	console.log(`gallery scroll: ${summary}`);
	expect(result.scrolledTo).toBeGreaterThan(result.height / 2);
	// Cards scrolled past before their thumbnail was made never ask for one:
	// once scrolling stops, only the cards on screen are still being made.
	await page.waitForTimeout(2000);
	const later = await page.evaluate(
		() => (window as unknown as { __thumbRequests: number }).__thumbRequests,
	);
	const onScreen = await page
		.locator("[data-testid=records-gallery] [role=row]")
		.count();
	expect(later - result.requests).toBeLessThanOrEqual(onScreen);
	expect(result.requests).toBeLessThan(N);
	await expect
		.poll(() =>
			page.locator("[data-testid=records-gallery] [role=row] img").count(),
		)
		.toBeGreaterThan(0);

	// The table of the same records, scrolled the same way on the same
	// machine under the same load, is the yardstick. Headless Chromium draws
	// on the CPU, so absolute numbers say little; a gallery far slower than
	// the table has lost its composited scroller and repaints every card.
	await page.getByRole("radio", { name: "Table" }).click();
	const table = await page.evaluate(async () => {
		const el = document.querySelector(
			"[data-testid=records-grid] [role=grid]",
		) as HTMLElement;
		const frames: number[] = [];
		await new Promise<void>((resolve) => {
			let last = -1;
			const step = (t: number) => {
				if (last >= 0) frames.push(t - last);
				last = t;
				el.scrollTop += 8;
				if (frames.length < 240) requestAnimationFrame(step);
				else resolve();
			};
			requestAnimationFrame(step);
		});
		frames.sort((a, b) => a - b);
		return frames[Math.floor(frames.length / 2)] ?? 0;
	});
	console.log(
		`gallery scroll: the table's steady p50 is ${table.toFixed(1)} ms`,
	);
	info.annotations.push({
		type: "gallery-scroll",
		description: `table steady p50 ${table.toFixed(1)} ms`,
	});
	expect(result.steady.p50).toBeLessThanOrEqual(table * 2 + 1);
});

test("scrolling a gallery of 200 12 MP photos keeps the main thread's heap bounded", async ({
	browserName,
}, info) => {
	test.setTimeout(900_000);
	test.skip(browserName !== "chromium", "performance.memory is Chromium's");
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-gallery-"));
	// Precise heap numbers and a callable gc need launch flags.
	const context = await chromium.launchPersistentContext(dir, {
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
		args: [
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
			"--enable-precise-memory-info",
			"--js-flags=--expose-gc",
		],
		baseURL: info.project.use.baseURL,
		viewport: { width: 1440, height: 900 },
	});
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await openSample(page);
		await page.keyboard.press(`${mod}+2`);
		await pickGeneratedPhotos(page, join(dir, "photos"), {
			count: 200,
			width: 4000,
			height: 3000,
		});
		// Dropped on the empty Data section, as a folder of photos would be.
		await page.evaluate((selector) => {
			const input = document.querySelector(selector) as HTMLInputElement;
			const dt = new DataTransfer();
			for (const file of input.files ?? []) dt.items.add(file);
			const zone = document.querySelector(
				"[data-testid=data-drop-zone]",
			) as HTMLElement;
			for (const type of ["dragenter", "dragover", "drop"])
				zone.dispatchEvent(
					new DragEvent(type, {
						dataTransfer: dt,
						bubbles: true,
						cancelable: true,
					}),
				);
		}, PHOTO_INPUT);
		await expect
			.poll(
				() => state<number>(page, "s.workspace?.datasets[0]?.records.length"),
				{ timeout: 300_000 },
			)
			.toBe(200);
		const grid = page.locator("[data-testid=records-gallery] [role=grid]");
		await expect(grid).toBeVisible();

		const heap = () =>
			page.evaluate(async () => {
				const w = window as unknown as {
					gc?: () => void;
					performance: Performance & { memory?: { usedJSHeapSize: number } };
				};
				w.gc?.();
				await new Promise((r) => setTimeout(r, 100));
				return w.performance.memory?.usedJSHeapSize ?? 0;
			});
		await page.waitForTimeout(3000);
		const baseline = await heap();
		let peak = baseline;
		// Down and back up three times, pausing so thumbnails are made.
		for (let pass = 0; pass < 3; pass++) {
			for (const to of ["end", "start"] as const) {
				await page.evaluate(
					async ({ to }) => {
						const el = document.querySelector(
							"[data-testid=records-gallery] [role=grid]",
						) as HTMLElement;
						const target = to === "end" ? el.scrollHeight : 0;
						while (Math.abs(el.scrollTop - target) > 1) {
							const before = el.scrollTop;
							el.scrollTop += to === "end" ? 300 : -300;
							await new Promise((r) => setTimeout(r, 120));
							if (el.scrollTop === before) break;
						}
					},
					{ to },
				);
				peak = Math.max(peak, await heap());
			}
		}
		await expect(
			page.locator("[data-testid=records-gallery] [role=row] img").first(),
		).toBeVisible();
		const growth = peak - baseline;
		const mb = (n: number) => Math.round(n / 1024 / 1024);
		const summary = `heap ${mb(baseline)} -> ${mb(peak)} MB (+${mb(growth)}) over 3 passes of 200 12 MP photos`;
		info.annotations.push({ type: "gallery-memory", description: summary });
		console.log(`gallery memory: ${summary}`);
		expect(baseline).toBeGreaterThan(0);
		expect(growth).toBeLessThan(150 * 1024 * 1024);
	} finally {
		await context.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
