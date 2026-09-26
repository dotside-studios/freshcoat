import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { mod, probePath, state } from "./helpers";
import { pickGeneratedPhotos, runWatermarkExport } from "./photo-folder";

const PROBE = probePath("watermark-probe");

/** Width and height from a JPEG's frame header. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
	let at = 2;
	while (at < bytes.length) {
		const marker = bytes[at + 1] as number;
		const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			![0xc4, 0xc8, 0xcc].includes(marker)
		)
			return {
				height: ((bytes[at + 5] as number) << 8) | (bytes[at + 6] as number),
				width: ((bytes[at + 7] as number) << 8) | (bytes[at + 8] as number),
			};
		at += 2 + length;
	}
	throw new Error("no frame header");
}

// Four stored sizes, each plain and turned by EXIF, five of each.
const SIZES = [
	[1600, 1200],
	[1500, 1000],
	[1920, 1080],
	[1024, 768],
] as const;

type Spec = {
	name: string;
	width: number;
	height: number;
	orientation: number;
	top: [number, number, number];
};

function specs(): Spec[] {
	const out: Spec[] = [];
	for (let i = 0; i < 40; i++) {
		const [width, height] = SIZES[i % 4] as readonly [number, number];
		out.push({
			name: `photo-${String(i + 1).padStart(2, "0")}.jpg`,
			width,
			height,
			orientation: Math.floor(i / 4) % 2 === 0 ? 1 : 6,
			// distinct bytes: the same photo twice is one photo
			top: [200, 40 + i * 2, 40 + ((i * 3) % 50)],
		});
	}
	return out;
}

const near = (a: number[], b: number[], tolerance = 28) =>
	a.slice(0, 3).every((v, i) => Math.abs(v - (b[i] as number)) <= tolerance);

test("watermarking 40 photos keeps each at its own size, upright, with the mark", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await page.goto("/?starter=photo-watermark");
	await expect
		.poll(() => state<number>(page, "s.workspace?.presets.length ?? 0"))
		.toBe(1);

	const photos = specs();
	// Photos made in the page, through the same import as "New dataset from
	// photos", then bound to the starter's photo field.
	await page.evaluate(
		async ({ path, actionsPath, photos }) => {
			const probe = await import(/* @vite-ignore */ path);
			const actions = await import(/* @vite-ignore */ actionsPath);
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
			const files = await probe.makePhotos(photos);
			const dataset = await actions.newDatasetFromPhotos(c, files, "Photos");
			c.dispatch({
				type: "setBinding",
				id: c.state.workspace.activeTemplateId,
				binding: {
					datasetId: dataset.id,
					fields: { photo: { kind: "column", column: "photo" } },
				},
			});
		},
		{ path: PROBE, actionsPath: probePath("app-probe"), photos },
	);

	await expect
		.poll(() =>
			state<number>(
				page,
				"s.workspace?.datasets.find((d) => d.name === 'Photos')?.records.length ?? 0",
			),
		)
		.toBe(40);
	// the dataset holds each photo's size as seen
	const columns = await state<{ width: number; height: number }[]>(
		page,
		"s.workspace.datasets.find((d) => d.name === 'Photos').records.map((r) => ({ width: r.values.width, height: r.values.height }))",
	);
	expect(columns[4]).toEqual({ width: 1200, height: 1600 });

	await page.keyboard.press(`${mod}+3`);
	await expect(page.getByTestId("section-export")).toBeVisible();
	const exportButton = page.getByRole("button", { name: "Export 40 files" });
	await expect(exportButton).toBeEnabled();
	const [download] = await Promise.all([
		page.waitForEvent("download", { timeout: 200_000 }),
		exportButton.click(),
	]);
	expect(download.suggestedFilename()).toBe("watermarked_photos.zip");
	const zip = new Uint8Array(readFileSync(await download.path()));
	const files = unzipSync(zip);
	const names = Object.keys(files);
	expect(names).toHaveLength(41);
	expect(names.at(-1)).toBe("export-report.csv");

	const report = strFromU8(files["export-report.csv"] as Uint8Array)
		.trim()
		.split("\r\n")
		.slice(1);
	expect(report).toHaveLength(40);
	expect(report.every((row) => row.split(",")[3] === "ok")).toBe(true);

	const jpegs = names.filter((n) => n.endsWith(".jpg"));
	expect(jpegs).toHaveLength(40);
	// each output is named after its photo
	expect(jpegs.slice(0, 2)).toEqual(["photo-01.jpg", "photo-02.jpg"]);
	const checks: {
		name: string;
		bytes: number[];
		spec: Spec;
		expected: { width: number; height: number };
	}[] = [];
	jpegs.forEach((name, i) => {
		const bytes = files[name] as Uint8Array;
		expect(Array.from(bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
		const spec = photos[i] as Spec;
		const expected =
			spec.orientation >= 5
				? { width: spec.height, height: spec.width }
				: { width: spec.width, height: spec.height };
		// the output carries no EXIF, so its stored size is its size as seen
		expect(jpegSize(bytes), name).toEqual(expected);
		checks.push({ name, bytes: Array.from(bytes), spec, expected });
	});

	// Pixels, decoded in the page: the photo is upright and the mark is in
	// the bottom-right corner.
	const outcome = await page.evaluate(
		async ({ path, checks }) => {
			const probe = await import(/* @vite-ignore */ path);
			const out = [];
			for (const check of checks) {
				const bytes = new Uint8Array(check.bytes);
				const { width, height } = check.expected;
				// 1200 design units along the short side; the mark sits 48 units
				// in from the bottom and right, 56 units tall and up to about 300
				// units wide.
				const unit = Math.min(width, height) / 1200;
				const mark = await probe.brightPixels(bytes, {
					x0: width - 330 * unit,
					y0: height - 110 * unit,
					x1: width - 40 * unit,
					y1: height - 40 * unit,
				});
				const clean = await probe.brightPixels(bytes, {
					x0: 40 * unit,
					y0: height - 110 * unit,
					x1: 330 * unit,
					y1: height - 40 * unit,
				});
				const turned = check.spec.orientation >= 5;
				const { pixels } = await probe.samplePixels(
					bytes,
					turned
						? [
								[0.75, 0.25],
								[0.25, 0.25],
							]
						: [
								[0.5, 0.25],
								[0.25, 0.75],
							],
				);
				out.push({ name: check.name, mark, clean, pixels });
			}
			return out;
		},
		{ path: PROBE, checks },
	);
	for (const [i, o] of outcome.entries()) {
		const spec = checks[i]?.spec as Spec;
		expect(o.mark, `${o.name} has the mark`).toBeGreaterThan(200);
		expect(o.clean, `${o.name} has no mark bottom-left`).toBe(0);
		// top half coloured, bottom half dark, as seen after orientation
		expect(near(o.pixels[0] as number[], spec.top), `${o.name} colour`).toBe(
			true,
		);
		expect(near(o.pixels[1] as number[], [32, 32, 32]), `${o.name} dark`).toBe(
			true,
		);
	}
});

test("200 12 MP photos export in zip parts with the window bounded", async ({
	browserName,
}, info) => {
	test.setTimeout(900_000);
	test.skip(browserName !== "chromium", "performance.memory is Chromium's");
	// performance.memory is coarse and cached without precise memory info,
	// which only a launch flag turns on.
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-memory-"));
	const context = await chromium.launchPersistentContext(dir, {
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
		args: [
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
			"--enable-precise-memory-info",
			"--js-flags=--expose-gc",
		],
		baseURL: info.project.use.baseURL,
	});
	try {
		await measureMemory(context.pages()[0] ?? (await context.newPage()), dir);
	} finally {
		await context.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

async function measureMemory(page: Page, dir: string) {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	await pickGeneratedPhotos(page, join(dir, "photos"), {
		count: 200,
		width: 4000,
		height: 3000,
	});
	const out = await runWatermarkExport(page, 64 * 1024 * 1024);
	const mb = (n: number) => Math.round(n / 1024 / 1024);
	console.log(
		`memory: ${out.count} photos (${mb(out.sourceBytes)} MB) imported in ${Math.round(out.importMs)} ms; export ${Math.round(out.ms)} ms, ${out.itemsPerSecond.toFixed(2)} items/s, pool ${out.poolSize}, max held ${out.stats.maxHeld} of ${out.stats.window}, ${out.parts.length} parts (${out.parts.map((p) => mb(p.bytes)).join(", ")} MB), heap ${mb(out.heap.baseline)} -> ${mb(out.heap.peak)} MB (+${mb(out.heap.growth)})`,
	);
	expect(out.failed).toEqual([]);
	expect(out.ok).toBe(200);
	expect(out.parts.length).toBeGreaterThan(2);
	expect(out.parts.at(-1)?.name).toBe(`marked-part-${out.parts.length}.zip`);
	for (const part of out.parts.slice(0, -1))
		expect(part.bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
	expect(out.stats.window).toBe(2 * out.poolSize);
	expect(out.stats.maxHeld).toBeLessThanOrEqual(2 * out.poolSize);
	expect(out.heap.available).toBe(true);
	expect(out.heap.growth).toBeLessThan(150 * 1024 * 1024);
}
