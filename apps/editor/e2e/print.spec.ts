import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type ChartReading,
	createPrintProfile,
	grayBalanceChart,
	type PatchReading,
	type RGB,
} from "@freshcoat/for-print";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { mod, openSample, probePath, settle, state } from "./helpers";

// FRESHCOAT_SHOTS=<dir> also saves pictures of the Print group and the
// printer file for review.
const SHOTS = process.env.FRESHCOAT_SHOTS;

async function download(page: Page, start: () => Promise<void>) {
	const pending = page.waitForEvent("download", { timeout: 120_000 });
	await start();
	const file = await pending;
	return new Uint8Array(await readFile(await file.path()));
}

type Export = { pngs: Record<string, Uint8Array>; report: string[] };

async function exportZip(page: Page): Promise<Export> {
	const bytes = await download(page, () =>
		page.getByRole("button", { name: /^Export \d+ files?$/ }).click(),
	);
	await expect(page.getByTestId("export-job")).toHaveAttribute(
		"data-state",
		"done",
	);
	const entries = unzipSync(bytes);
	const pngs: Record<string, Uint8Array> = {};
	for (const [name, data] of Object.entries(entries))
		if (name.endsWith(".png")) pngs[name] = data;
	const report = strFromU8(entries["export-report.csv"] as Uint8Array)
		.trim()
		.split("\r\n");
	return { pngs, report };
}

/** How many pixels two PNGs of one size disagree on, decoded by the page. */
async function differingPixels(page: Page, a: Uint8Array, b: Uint8Array) {
	return page.evaluate(
		async ([x, y]) => {
			const decode = async (bytes: number[]) => {
				const bitmap = await createImageBitmap(
					new Blob([new Uint8Array(bytes)], { type: "image/png" }),
				);
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				const ctx = canvas.getContext(
					"2d",
				) as OffscreenCanvasRenderingContext2D;
				ctx.drawImage(bitmap, 0, 0);
				return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
			};
			const [p, q] = [await decode(x), await decode(y)];
			if (p.length !== q.length) return -1;
			let n = 0;
			for (let i = 0; i < p.length; i += 4)
				if (
					p[i] !== q[i] ||
					p[i + 1] !== q[i + 1] ||
					p[i + 2] !== q[i + 2] ||
					p[i + 3] !== q[i + 3]
				)
					n++;
			return n;
		},
		[Array.from(a), Array.from(b)] as const,
	);
}

async function openExportWithPreset(page: Page) {
	await openSample(page, "membership-card");
	await page.keyboard.press(`${mod}+3`);
	await expect(page.getByTestId("section-export")).toBeVisible();
	await page
		.getByTestId("export-presets")
		.getByRole("button", { name: "New preset" })
		.click();
	await expect(page.getByTestId("export-preset")).toHaveCount(1);
}

const printSwitch = (page: Page) =>
	page
		.getByTestId("export-settings")
		.getByRole("switch", { name: "Optimize for card printer" });

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** A gray-chart reading off a printer with a warm cast, the shape the print
 *  chart tool reads, so the fitted balance is not neutral. */
function castReading(): ChartReading {
	const exps = [0.85, 1, 1.18];
	const spec = grayBalanceChart(16);
	const patches: PatchReading[] = [];
	for (const p of spec.patches) {
		if (p.role === "fiducial") continue;
		const measured = [0, 1, 2].map((c) =>
			Math.max(0, Math.min(255, 255 * ((p.rgb[c] as number) / 255) ** exps[c])),
		) as RGB;
		patches.push({
			id: p.id,
			role: p.role,
			sent: p.rgb,
			raw: measured,
			measured,
			...(p.repeatOf ? { repeatOf: p.repeatOf } : {}),
		});
	}
	return {
		chartId: spec.id,
		patches,
		stock: [255, 255, 255],
		stockClipped: false,
		lightSpread: 0,
		missed: [],
	};
}

test("a printing PNG export carries the finish, and the report says so", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await openExportWithPreset(page);

	const plain = await exportZip(page);
	expect(plain.report[0]).toBe("file,record,side,status,error,print,gamut");
	expect(plain.report.slice(1).every((l) => l.endsWith(",ok,,off,"))).toBe(
		true,
	);

	await page
		.getByTestId("export-print")
		.getByText("Optimize for card printer")
		.click();
	await expect(printSwitch(page)).toBeChecked();
	expect(
		await page.evaluate(
			() =>
				(
					window as unknown as {
						__freshcoat: {
							controller: {
								state: { workspace: { presets: { print?: unknown }[] } };
							};
						};
					}
				).__freshcoat.controller.state.workspace.presets[0]?.print,
		),
	).toEqual({ enabled: true });

	const printed = await exportZip(page);
	expect(Object.keys(printed.pngs)).toEqual(Object.keys(plain.pngs));
	for (const line of printed.report.slice(1))
		expect(line).toMatch(/,ok,,on,(\d+%)?$/);
	for (const name of Object.keys(plain.pngs)) {
		const a = plain.pngs[name] as Uint8Array;
		const b = printed.pngs[name] as Uint8Array;
		// The finish dithers the whole frame, so far more than a few pixels move.
		expect(await differingPixels(page, a, b)).toBeGreaterThan(1000);
	}

	// The preview offers the printer file, rendered through the same path.
	const preview = page.getByTestId("export-preview");
	await page.getByRole("button", { name: "Printer file" }).click();
	await expect(preview).toHaveAttribute("data-printer-file", "on");
	await expect(page.getByTestId("export-printer-file")).toBeVisible({
		timeout: 60_000,
	});
	await expect(page.getByTestId("export-printer-note")).toHaveText(
		/^Printer file, not a proof of the printed card/,
	);
	await expect(preview).toHaveAttribute("data-state", "ready");
	await shot(page, "printer-file");
	await page.getByRole("button", { name: "Printer file" }).click();
	await expect(page.getByTestId("export-printer-file")).toHaveCount(0);
});

test("a print profile imports, shows, changes the output, and a malformed one is refused", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await openExportWithPreset(page);
	await page
		.getByTestId("export-print")
		.getByText("Optimize for card printer")
		.click();
	const group = page.getByTestId("export-print-profile");
	await expect(group).toContainText("None");

	const chooseFile = async (name: string, content: string) => {
		const chooser = page.waitForEvent("filechooser");
		await group.getByRole("button", { name: "Import…" }).click();
		await (await chooser).setFiles({
			name,
			mimeType: "application/json",
			buffer: Buffer.from(content),
		});
	};

	await chooseFile(
		"bad.json",
		JSON.stringify({ name: "Printer", balance: { r: 40, g: 1, b: 1 } }),
	);
	const error = page.getByTestId("export-print-profile-error");
	await expect(error).toContainText("Couldn't import bad.json");
	await expect(error).toContainText("balance.r");
	await expect(group).toContainText("None");
	await chooseFile("worse.json", "{not json");
	await expect(error).toContainText("not valid JSON");

	const noProfile = await exportZip(page);

	const created = createPrintProfile(castReading(), {
		name: "Smart-51 / ribbon A / PVC",
		measuredAt: "2026-09-01T09:00:00Z",
	});
	if (!created.ok) throw new Error(`no profile: ${created.reason}`);
	expect(created.profile.balance?.r).not.toBeCloseTo(1, 2);
	await chooseFile("smart-51.json", JSON.stringify(created.profile, null, 2));
	await expect(error).toHaveCount(0);
	await expect(group).toContainText("Smart-51 / ribbon A / PVC");
	await expect(group).toContainText("Sep 1, 2026");
	if (SHOTS) {
		await page
			.getByTestId("export-print")
			.getByRole("button", { name: "More" })
			.click();
		await expect(
			page.getByRole("switch", { name: "Analyze photos" }),
		).toBeChecked();
		await shot(page, "print-group");
		await page
			.getByTestId("export-print")
			.getByRole("button", { name: "More" })
			.click();
	}

	const profiled = await exportZip(page);
	for (const line of profiled.report.slice(1))
		expect(line).toMatch(/,ok,,on,(\d+%)?$/);
	for (const name of Object.keys(noProfile.pngs))
		expect(
			await differingPixels(
				page,
				noProfile.pngs[name] as Uint8Array,
				profiled.pngs[name] as Uint8Array,
			),
		).toBeGreaterThan(1000);

	await group.getByRole("button", { name: "Remove profile" }).click();
	await expect(group).toContainText("None");
});

test("a photo pulled into printer range says how much, in the preview and the report", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await page.goto("/?starter=photo-watermark");
	await expect
		.poll(() => state<number>(page, "s.workspace?.presets.length ?? 0"))
		.toBe(1);
	// A dim, muted photo: the analysis lifts it, and part of it lands past
	// what the printer can hold.
	await page.evaluate(async (actionsPath) => {
		const actions = await import(/* @vite-ignore */ actionsPath);
		const c = (
			window as unknown as {
				__freshcoat: {
					controller: {
						state: {
							workspace: {
								activeTemplateId: string;
								presets: Record<string, unknown>[];
							};
						};
						dispatch(a: unknown): void;
					};
				};
			}
		).__freshcoat.controller;
		const [w, h] = [800, 600];
		const canvas = new OffscreenCanvas(w, h);
		const g = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
		const image = g.createImageData(w, h);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const k = (y * w + x) * 4;
				image.data[k] = 60 + (x / w) * 128;
				image.data[k + 1] = 30 + (y / h) * 96;
				image.data[k + 2] = 90;
				image.data[k + 3] = 255;
			}
		g.putImageData(image, 0, 0);
		const blob = await canvas.convertToBlob({ type: "image/png" });
		const dataset = await actions.newDatasetFromPhotos(
			c,
			[new File([blob], "dim.png", { type: "image/png" })],
			"Shoot",
		);
		c.dispatch({
			type: "setBinding",
			id: c.state.workspace.activeTemplateId,
			binding: {
				datasetId: dataset.id,
				fields: { photo: { kind: "column", column: "photo" } },
			},
		});
		const preset = c.state.workspace.presets[0];
		c.dispatch({
			type: "setPreset",
			preset: { ...preset, format: "png-zip", print: { enabled: true } },
		});
	}, probePath("app-probe"));
	await settle(page);
	await page.keyboard.press(`${mod}+3`);
	await expect(page.getByTestId("section-export")).toBeVisible();

	await page.getByRole("button", { name: "Printer file" }).click();
	await expect(page.getByTestId("export-printer-file")).toBeVisible({
		timeout: 60_000,
	});
	await expect(page.getByTestId("export-printer-note")).toHaveText(
		/^Printer file, not a proof of the printed card · \d+% of photo color pulled into printer range$/,
	);

	const out = await exportZip(page);
	expect(out.report).toHaveLength(2);
	expect(out.report[1]).toMatch(/,ok,,on,\d+%$/);
});
