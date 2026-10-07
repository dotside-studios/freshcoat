import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { probePath } from "./helpers";
import { pickGeneratedPhotos, runWatermarkExport } from "./photo-folder";

// Records how the coat engine keeps up with live editing. Headless Chromium draws
// WebGL through SwiftShader on the CPU, so these numbers are a floor: a GPU
// is faster, and the thresholds only catch gross regressions.
for (const sample of ["membership-card", "certificate"]) {
	test(`bench: ${sample}`, async ({ page }, info) => {
		test.setTimeout(180_000);
		await page.goto(`/?bench&sample=${sample}&frames=90`);
		const handle = await page.waitForFunction(
			() =>
				(window as unknown as { __freshcoatBench?: unknown }).__freshcoatBench,
			undefined,
			{ timeout: 170_000 },
		);
		const result = (await handle.jsonValue()) as {
			error?: string;
			latency: { renders: number; total: { p95: number } };
			throughput: { renders: number };
			cache: { surfaceCreates: number; fontProviderBuilds: number };
		};
		expect(result.error).toBeUndefined();
		console.log(`${sample} ${JSON.stringify(result)}`);
		await info.attach(`bench-${sample}.json`, {
			body: JSON.stringify(result, null, 2),
			contentType: "application/json",
		});
		expect(result.latency.renders).toBeGreaterThan(80);
		expect(result.latency.total.p95).toBeLessThan(250);
		expect(result.throughput.renders).toBeGreaterThan(5);
		expect(result.cache.surfaceCreates).toBe(1);
		expect(result.cache.fontProviderBuilds).toBe(1);
	});
}

// The live preview's worst case, painted from the worker and on the main
// thread, for comparing how each holds the main thread up during a drag. On a
// real GPU, open /bench?sample=stress and /bench?sample=stress&preview=worker
// instead: these runs draw through SwiftShader, which takes seconds a frame
// to raster the selected photo on either path.
test("bench: stress, worker and main thread", async ({ browser }, info) => {
	test.setTimeout(1_200_000);
	const results: Record<string, unknown> = {};
	for (const preview of ["worker", "main"]) {
		const page = await browser.newPage();
		const query = preview === "worker" ? "&preview=worker" : "";
		await page.goto(`/?bench&sample=stress&frames=6${query}`);
		const handle = await page.waitForFunction(
			() =>
				(window as unknown as { __freshcoatBench?: unknown }).__freshcoatBench,
			undefined,
			{ timeout: 580_000 },
		);
		const result = (await handle.jsonValue()) as {
			error?: string;
			previewMode: string;
			latency: { renders: number };
		};
		expect(result.error).toBeUndefined();
		expect(result.previewMode).toBe(preview);
		expect(result.latency.renders).toBe(6);
		results[preview] = result;
		await page.close();
	}
	console.log(`stress ${JSON.stringify(results)}`);
	await info.attach("bench-stress.json", {
		body: JSON.stringify(results, null, 2),
		contentType: "application/json",
	});
});

// 200 records with two sides each through the render worker pool.
test("bench: export 200 records", async ({ page }, info) => {
	test.setTimeout(300_000);
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	const out = (await page.evaluate(async (path) => {
		const mod = await import(/* @vite-ignore */ path);
		return mod.runZipProbe(200);
	}, probePath("export-engine-probe"))) as {
		poolSize: number;
		initMs: number;
		ms: number;
		itemsPerSecond: number;
		zipBytes: number;
		pngs: unknown[];
		failed: unknown[];
	};
	const result = {
		items: out.pngs.length,
		poolSize: out.poolSize,
		initMs: Math.round(out.initMs),
		ms: Math.round(out.ms),
		itemsPerSecond: Number(out.itemsPerSecond.toFixed(1)),
		zipBytes: out.zipBytes,
	};
	console.log(`export ${JSON.stringify(result)}`);
	await info.attach("bench-export.json", {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
	expect(out.failed).toEqual([]);
	expect(out.pngs).toHaveLength(400);
	expect(out.itemsPerSecond).toBeGreaterThan(2);
});

// The mass-watermarking case: 200 camera-sized photos (12 MP, noisy enough
// to weigh what a camera's do) out at their own size as JPEG.
test("bench: watermark 200 photos", async ({ page }, info) => {
	test.setTimeout(900_000);
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-bench-"));
	try {
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await pickGeneratedPhotos(page, dir, {
			count: 200,
			width: 4000,
			height: 3000,
		});
		const out = await runWatermarkExport(page, 512 * 1024 * 1024);
		const result = {
			items: out.ok,
			poolSize: out.poolSize,
			photoPixels: out.largestImagePixels,
			sourceMB: Math.round(out.sourceBytes / 1024 / 1024),
			ms: Math.round(out.ms),
			itemsPerSecond: Number(out.itemsPerSecond.toFixed(2)),
			outputMB: Math.round(
				out.parts.reduce((n, p) => n + p.bytes, 0) / 1024 / 1024,
			),
			parts: out.parts.length,
		};
		console.log(`watermark ${JSON.stringify(result)}`);
		await info.attach("bench-watermark.json", {
			body: JSON.stringify(result, null, 2),
			contentType: "application/json",
		});
		expect(out.failed).toEqual([]);
		expect(out.ok).toBe(200);
		expect(out.itemsPerSecond).toBeGreaterThan(0.2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// A 100,000-record CSV of 20 columns, read and imported as the wizard does
// it: in the import worker, and on the page for comparison.
test("bench: import a 100k-record CSV", async ({ page }, info) => {
	test.setTimeout(300_000);
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	const probe = (inPage: boolean) =>
		page.evaluate(
			async ({ path, inPage }) => {
				const mod = await import(/* @vite-ignore */ path);
				return mod.runImportProbe(100_000, { inPage });
			},
			{ path: probePath("import-probe"), inPage },
		) as Promise<{
			bytes: number;
			records: number;
			read: { ms: number; longestTaskMs: number; blockedMs: number };
			import: { ms: number; longestTaskMs: number; blockedMs: number };
		}>;
	const worker = await probe(false);
	const inPage = await probe(true);
	const result = { worker, inPage };
	console.log(`import ${JSON.stringify(result)}`);
	await info.attach("bench-import.json", {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
	expect(worker.records).toBe(100_000);
	expect(inPage.records).toBe(100_000);
	expect(worker.read.longestTaskMs).toBeLessThan(200);
	expect(worker.import.longestTaskMs).toBeLessThan(200);
});
