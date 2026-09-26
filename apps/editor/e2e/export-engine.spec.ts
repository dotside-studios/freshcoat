import { expect, type Page, test } from "@playwright/test";
import { probePath } from "./helpers";

const PROBE = probePath("export-engine-probe");

// Drives the render worker pool and the export job through Vite's module
// server, with no UI: the membership-card sample bound to a generated dataset.
async function probe<T>(
	page: Page,
	fn: string,
	...args: unknown[]
): Promise<T> {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	return page.evaluate(
		async ({ path, fn, args }) => {
			const mod = await import(/* @vite-ignore */ path);
			return mod[fn](...args);
		},
		{ path: PROBE, fn, args },
	) as Promise<T>;
}

type ZipProbe = {
	poolSize: number;
	initMs: number;
	ms: number;
	itemsPerSecond: number;
	fileName: string;
	zipBytes: number;
	names: string[];
	pngs: { name: string; width: number; height: number }[];
	report: string;
	failed: unknown[];
	progressEvents: number;
	lastProgress: {
		done: number;
		failed: number;
		total: number;
		etaMs: number;
		bytes: number;
	};
	template: { width: number; height: number };
};

test("a 20-record png-zip renders every side through the worker pool", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const out = await probe<ZipProbe>(page, "runZipProbe", 20);
	console.log(
		`export png-zip: 40 items in ${Math.round(out.ms)} ms, ${out.itemsPerSecond.toFixed(1)} items/s, pool ${out.poolSize}, init ${Math.round(out.initMs)} ms, zip ${out.zipBytes} bytes`,
	);
	expect(out.failed).toEqual([]);
	expect(out.fileName).toBe("members.zip");
	expect(out.pngs).toHaveLength(40);
	expect(out.names.at(-1)).toBe("export-report.csv");
	expect(out.names.slice(0, 2)).toEqual([
		"LC-0001-0000-front.png",
		"LC-0001-0000-back.png",
	]);
	for (const png of out.pngs) {
		expect(png.width).toBe(out.template.width);
		expect(png.height).toBe(out.template.height);
	}
	const report = out.report.trim().split("\r\n");
	expect(report).toHaveLength(41);
	expect(report[0]).toBe("file,record,side,status,error,print,gamut");
	expect(report[1]).toBe("LC-0001-0000-front.png,r_0001,front,ok,,off,");
	expect(out.progressEvents).toBe(40);
	expect(out.lastProgress).toMatchObject({
		done: 40,
		failed: 0,
		total: 40,
		etaMs: 0,
	});
	expect(out.lastProgress.bytes).toBeGreaterThan(0);
	expect(out.itemsPerSecond).toBeGreaterThan(0);
});

test("a png-zip at 2x has double-size PNGs", async ({ page }) => {
	const out = await probe<ZipProbe>(page, "runZipProbe", 2, 2);
	expect(out.failed).toEqual([]);
	expect(out.pngs.map((p) => p.name)).toEqual([
		"LC-0001-0000-front@2x.png",
		"LC-0001-0000-back@2x.png",
		"LC-0002-0000-front@2x.png",
		"LC-0002-0000-back@2x.png",
	]);
	for (const png of out.pngs) {
		expect(png.width).toBe(out.template.width * 2);
		expect(png.height).toBe(out.template.height * 2);
	}
});

test("a PDF job gives one page per record and side", async ({ page }) => {
	const out = await probe<{
		fileName: string;
		mediaType: string;
		pages: { width: number; height: number }[];
		title: string;
		failed: unknown[];
	}>(page, "runPdfProbe", 3, 192);
	expect(out.failed).toEqual([]);
	expect(out.fileName).toBe("members.pdf");
	expect(out.mediaType).toBe("application/pdf");
	expect(out.title).toBe("Members");
	expect(out.pages).toHaveLength(6);
	// Template pixels are dots at the DPI: a 1012×638 card is 5.27×3.32 in at 192.
	for (const size of out.pages) {
		expect(size.width).toBeCloseTo((1012 / 192) * 72, 1);
		expect(size.height).toBeCloseTo((638 / 192) * 72, 1);
	}
});

test("cancelling a 50-record job stops it with no file", async ({ page }) => {
	const out = await probe<{
		cancelled: boolean;
		hasFile: boolean;
		items: number;
		progressEvents: number;
		settleMs: number;
		afterOk: boolean;
	}>(page, "runCancelProbe", 50);
	console.log(
		`export cancel: settled ${Math.round(out.settleMs)} ms after abort`,
	);
	expect(out.cancelled).toBe(true);
	expect(out.hasFile).toBe(false);
	expect(out.progressEvents).toBe(1);
	expect(out.items).toBe(1);
	expect(out.settleMs).toBeLessThan(500);
	expect(out.afterOk).toBe(true);
});

test("dataset photos reach the workers as Blobs and render", async ({
	page,
}) => {
	const out = await probe<{
		pixels: Record<string, number[]>;
		failed: unknown[];
	}>(page, "runPhotoProbe");
	expect(out.failed).toEqual([]);
	const names = Object.keys(out.pixels).sort();
	expect(names).toHaveLength(2);
	const [green, red] = names.map((n) => out.pixels[n] as number[]);
	expect(green?.[1]).toBeGreaterThan(200);
	expect(green?.[0]).toBeLessThan(40);
	expect(red?.[0]).toBeGreaterThan(200);
	expect(red?.[1]).toBeLessThan(40);
});

test("JPEG and WebP zips hold real JPEG and WebP files", async ({ page }) => {
	// The export workers load CanvasKit's full build: the default one has
	// neither encoder and would answer in PNG.
	type Out = { failed: unknown[]; files: { name: string; head: number[] }[] };
	const jpeg = await probe<Out>(page, "runFormatProbe", 2, "jpeg-zip");
	expect(jpeg.failed).toEqual([]);
	const jpegs = jpeg.files.filter((f) => f.name.endsWith(".jpg"));
	expect(jpegs.map((f) => f.name)).toEqual([
		"LC-0001-0000-front.jpg",
		"LC-0001-0000-back.jpg",
		"LC-0002-0000-front.jpg",
		"LC-0002-0000-back.jpg",
	]);
	for (const f of jpegs) expect(f.head.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);

	const webp = await probe<Out>(page, "runFormatProbe", 1, "webp-zip");
	expect(webp.failed).toEqual([]);
	const webps = webp.files.filter((f) => f.name.endsWith(".webp"));
	expect(webps).toHaveLength(2);
	const text = (bytes: number[]) => String.fromCharCode(...bytes);
	for (const f of webps) {
		expect(text(f.head.slice(0, 4))).toBe("RIFF");
		expect(text(f.head.slice(8, 12))).toBe("WEBP");
	}
});
