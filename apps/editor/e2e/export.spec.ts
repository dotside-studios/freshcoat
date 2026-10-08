import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { mod, openSample, probePath, settingsTab, state } from "./helpers";

/** Adds a dataset of `count` members whose columns are the template's field keys. */
async function addDataset(
	page: Page,
	id: string,
	name: string,
	count: number,
	names: Record<number, string> = {},
) {
	await page.evaluate(
		({ id, name, count, names }) => {
			const c = (
				window as unknown as {
					__freshcoat: {
						controller: {
							template: { fields: { properties: Record<string, unknown> } };
							state: { workspace: { datasets: unknown[] } };
							dispatch(action: unknown): void;
						};
					};
				}
			).__freshcoat.controller;
			const keys = Object.keys(c.template.fields.properties);
			const tiers = ["Gold", "Silver", "Bronze"];
			const values = (i: number): Record<string, string> => ({
				display_name: names[i] ?? `Member ${i + 1}`,
				tier: tiers[i % 3] as string,
				profile_url: `https://example.com/u/${i + 1}`,
				member_since: String(2000 + i),
				member_id: `LC ${String(i + 1).padStart(4, "0")} 0000`,
				verified: i % 2 === 0 ? "true" : "false",
			});
			const dataset = {
				id,
				name,
				columns: keys.map((key) => ({ key, type: "text" })),
				records: Array.from({ length: count }, (_, i) => ({
					id: `${id}_r${i + 1}`,
					status: "pending",
					values: Object.fromEntries(
						keys.map((k) => [k, values(i)[k] ?? `${k} ${i + 1}`]),
					),
				})),
				assets: [],
			};
			c.dispatch({
				type: "datasetEdit",
				datasets: [...c.state.workspace.datasets, dataset],
			});
		},
		{ id, name, count, names },
	);
}

async function chooseDataset(page: Page, name: string) {
	await settingsTab(page, "Content");
	const editor = page.getByTestId("binding-editor");
	if (!(await editor.isVisible()))
		await page
			.getByTestId("export-settings")
			.getByRole("button", { name: /^Binding/ })
			.click();
	await editor.getByRole("button", { name: /Dataset/ }).click();
	await page.getByRole("option", { name }).click();
}

function statuses(page: Page, datasetId: string) {
	return state<string[]>(
		page,
		`s.workspace.datasets.find((d) => d.id === ${JSON.stringify(datasetId)}).records.map((r) => r.status)`,
	);
}

async function download(page: Page, start: () => Promise<void>) {
	const pending = page.waitForEvent("download", { timeout: 120_000 });
	await start();
	const file = await pending;
	const path = await file.path();
	return { name: file.suggestedFilename(), bytes: await readFile(path) };
}

function pngSize(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

test("bind, preview, export a zip and a PDF, change statuses, cancel", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await openSample(page, "membership-card");
	await addDataset(page, "d_members", "Members", 3);
	await page.keyboard.press(`${mod}+3`);
	await expect(page.getByTestId("section-export")).toBeVisible();

	await page
		.getByTestId("export-presets")
		.getByRole("button", { name: "New preset" })
		.click();
	await expect(page.getByTestId("export-preset")).toHaveCount(1);
	await expect(page.getByTestId("export-unbound")).toBeVisible();

	await chooseDataset(page, "Members");
	await expect(page.getByTestId("export-unbound")).toHaveCount(0);
	expect(
		await state<unknown>(page, "s.workspace.templates[0].binding.fields.tier"),
	).toEqual({ kind: "column", column: "tier" });
	await expect(
		page.getByRole("button", { name: "Export 6 files" }),
	).toBeEnabled();
	await expect(page.getByTestId("export-warning")).toHaveCount(0);

	// A required field left to its default is flagged, and the export still runs.
	const editor = page.getByTestId("binding-editor");
	await editor.getByRole("button", { name: /Source for display_name/ }).click();
	await page.getByRole("option", { name: "Default" }).click();
	await expect(page.getByTestId("export-warning")).toHaveText(
		"1 required field unfilled",
	);
	await expect(
		page.getByTestId("export-settings").getByTestId("binding-unfilled"),
	).toHaveText("1 required field unfilled");
	await expect(
		page.getByRole("button", { name: "Export 6 files" }),
	).toBeEnabled();
	await editor.getByRole("button", { name: /Source for display_name/ }).click();
	await page.getByRole("option", { name: "Column" }).click();
	await expect(page.getByTestId("export-warning")).toHaveCount(0);

	// The filmstrip holds the three records; a click previews one and the
	// arrow keys step. Record 2 of 3 in the preview.
	const strip = page.getByTestId("export-filmstrip");
	await expect(strip.getByRole("option")).toHaveCount(3);
	await strip.getByRole("option").nth(2).click();
	await expect(page.getByTestId("export-stepper-position")).toHaveText("3 / 3");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByTestId("export-stepper-position")).toHaveText("1 / 3");
	await page.getByRole("button", { name: "Next record" }).click();
	await expect(page.getByTestId("export-stepper-position")).toHaveText("2 / 3");
	await expect(strip.getByRole("option", { selected: true })).toHaveAttribute(
		"data-record",
		"d_members_r2",
	);
	const preview = page.getByTestId("export-preview");
	await expect(preview).toHaveAttribute("data-item", "d_members_r2:front", {
		timeout: 30_000,
	});
	await expect(preview).toHaveAttribute("data-state", "ready");
	const colours = await page.evaluate(() => {
		const c = document.querySelector(
			'[data-testid="export-preview-canvas"]',
		) as HTMLCanvasElement;
		const ctx = c.getContext("2d") as CanvasRenderingContext2D;
		const data = ctx.getImageData(0, 0, c.width, c.height).data;
		const seen = new Set<number>();
		let opaque = 0;
		for (let i = 0; i < data.length; i += 4 * 97) {
			if ((data[i + 3] as number) > 0) opaque++;
			seen.add(
				((data[i] as number) << 16) |
					((data[i + 1] as number) << 8) |
					(data[i + 2] as number),
			);
		}
		return { distinct: seen.size, opaque, width: c.width };
	});
	expect(colours.width).toBeGreaterThan(100);
	expect(colours.opaque).toBeGreaterThan(100);
	expect(colours.distinct).toBeGreaterThan(20);

	// PNG zip: 3 records × 2 sides and the report.
	const zip = await download(page, () =>
		page.getByRole("button", { name: "Export 6 files" }).click(),
	);
	expect(zip.name).toBe("new_preset.zip");
	const entries = unzipSync(new Uint8Array(zip.bytes));
	const names = Object.keys(entries);
	const pngs = names.filter((n) => n.endsWith(".png"));
	expect(pngs).toHaveLength(6);
	expect(names).toContain("export-report.csv");
	for (const name of pngs) {
		expect(pngSize(entries[name] as Uint8Array)).toEqual({
			width: 1012,
			height: 638,
		});
	}
	const report = strFromU8(entries["export-report.csv"] as Uint8Array)
		.trim()
		.split("\r\n");
	expect(report).toHaveLength(7);
	expect(report.slice(1).every((line) => line.includes(",ok,"))).toBe(true);
	await expect(page.getByTestId("export-job")).toHaveAttribute(
		"data-state",
		"done",
	);
	expect(await statuses(page, "d_members")).toEqual([
		"exported",
		"exported",
		"exported",
	]);
	await expect(strip.locator('[data-status="exported"]')).toHaveCount(3);
	await expect(page.getByTestId("export-summary")).toContainText("6 ok");
	await page.getByRole("tab", { name: "Records" }).click();
	await expect(
		page.getByTestId("export-records").locator('[data-status="exported"]'),
	).toHaveCount(3);

	// PDF at 300 dpi: one CR80-sized page per record and side.
	await settingsTab(page, "Output");
	await page
		.getByTestId("export-settings")
		.getByRole("radiogroup", { name: "Format" })
		.getByRole("radio", { name: "PDF" })
		.click();
	await expect(page.getByTestId("export-page-size")).toHaveText(
		"Page 3.37 × 2.13 in · 85.7 × 54.0 mm",
	);
	const pdf = await download(page, () =>
		page.getByRole("button", { name: "Export 6 files" }).click(),
	);
	expect(pdf.name).toMatch(/\.pdf$/);
	const parsed = await PDFDocument.load(new Uint8Array(pdf.bytes));
	expect(parsed.getPageCount()).toBe(6);
	for (const p of parsed.getPages()) {
		const { width, height } = p.getSize();
		expect(width).toBeCloseTo((1012 / 300) * 72, 1);
		expect(height).toBeCloseTo((638 / 300) * 72, 1);
	}

	// Two records back to pending.
	const rows = page.getByTestId("export-records").getByRole("row");
	await rows.nth(1).locator("label").first().click();
	await rows.nth(3).locator("label").first().click();
	await expect(page.getByTestId("export-records-selection")).toHaveText(
		"2 selected",
	);
	await page.getByRole("button", { name: /Set status/ }).click();
	await page.getByRole("menuitem", { name: "Pending" }).click();
	expect(await statuses(page, "d_members")).toEqual([
		"pending",
		"exported",
		"pending",
	]);

	// Cancel a 40-record job: no download, the bar says cancelled.
	await addDataset(page, "d_many", "Many", 40);
	await chooseDataset(page, "Many");
	await settingsTab(page, "Output");
	await page
		.getByTestId("export-settings")
		.getByRole("radiogroup", { name: "Format" })
		.getByRole("radio", { name: "PNG" })
		.click();
	let downloads = 0;
	page.on("download", () => downloads++);
	await page.getByRole("button", { name: "Export 80 files" }).click();
	await expect(page.getByTestId("export-job")).toHaveAttribute(
		"data-state",
		"running",
	);
	await expect(page.getByTestId("export-progress")).toHaveText(/^\d+ \/ 80/, {
		timeout: 30_000,
	});
	await page
		.getByTestId("export-job")
		.getByRole("button", { name: "Cancel" })
		.click();
	await expect(page.getByTestId("export-job")).toHaveAttribute(
		"data-state",
		"cancelled",
	);
	await expect(page.getByTestId("export-summary")).toHaveText(/^Canceled/);
	await page.waitForTimeout(1500);
	expect(downloads).toBe(0);
	expect(await statuses(page, "d_many")).toEqual(
		Array.from({ length: 40 }, () => "pending"),
	);
});

test("warns about characters the fonts can't draw, without blocking", async ({
	page,
}) => {
	await openSample(page, "membership-card");
	await addDataset(page, "d_intl", "Intl", 3, { 1: "Ship 🚀 \u{10000}" });
	await page.keyboard.press(`${mod}+3`);
	await page
		.getByTestId("export-presets")
		.getByRole("button", { name: "New preset" })
		.click();
	await chooseDataset(page, "Intl");

	const notice = page.getByTestId("export-missing-glyphs");
	await expect(notice).toContainText("1 record has characters", {
		timeout: 30_000,
	});
	await expect(notice).toContainText("\u{10000}");
	await notice.getByRole("button", { expanded: false }).click();
	const list = page.getByTestId("export-missing-glyphs-list");
	await expect(list).toContainText("U+10000");
	await list.getByRole("button", { name: "Ship 🚀 \u{10000}" }).click();
	await expect(page.getByTestId("export-stepper-position")).toHaveText("2 / 3");
	await expect(
		page.getByRole("button", { name: "Export 6 files" }),
	).toBeEnabled();
});

test("photos: filmstrip thumbnails, and Source and Split against the output", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.goto("/?starter=photo-watermark");
	await expect
		.poll(() => state<number>(page, "s.workspace?.presets.length ?? 0"))
		.toBe(1);
	await page.evaluate(
		async ({ probePath, actionsPath }) => {
			const probe = await import(/* @vite-ignore */ probePath);
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
			const files = await probe.makePhotos(
				Array.from({ length: 6 }, (_, i) => ({
					name: `photo-${i + 1}.jpg`,
					width: i % 2 ? 900 : 1200,
					height: i % 2 ? 1200 : 900,
					top: [220, 60 + i * 20, 40],
				})),
			);
			const dataset = await actions.newDatasetFromPhotos(c, files, "Photos");
			c.dispatch({
				type: "setBinding",
				id: c.state.workspace.activeTemplateId,
				binding: {
					datasetId: dataset.id,
					fields: { photo: { kind: "column", column: "photo" } },
					variant: { kind: "image", field: "photo" },
				},
			});
		},
		{
			probePath: probePath("watermark-probe"),
			actionsPath: probePath("app-probe"),
		},
	);
	await page.keyboard.press(`${mod}+3`);
	const strip = page.getByTestId("export-filmstrip");
	await expect(strip.getByRole("option")).toHaveCount(6);
	// every cell shows its photo's thumbnail
	await expect
		.poll(() =>
			strip
				.locator("img")
				.evaluateAll((imgs) =>
					imgs.filter((i) => (i as HTMLImageElement).naturalWidth > 0),
				)
				.then((loaded) => loaded.length),
		)
		.toBe(6);
	await strip.getByRole("option").nth(1).click();
	const preview = page.getByTestId("export-preview");
	await expect(preview).toHaveAttribute("data-state", "ready", {
		timeout: 30_000,
	});
	// The portrait variant, closest to the photo's shape, at 2x.
	await expect(page.getByTestId("export-preview-size")).toHaveText(
		"2400 × 3600",
	);

	await page.getByRole("radio", { name: "Source" }).click();
	await expect(preview).toHaveAttribute("data-mode", "source");
	const source = page.getByTestId("export-preview-source");
	await expect
		.poll(() =>
			source.evaluate((i) => ({
				w: (i as HTMLImageElement).naturalWidth,
				h: (i as HTMLImageElement).naturalHeight,
			})),
		)
		.toEqual({ w: 900, h: 1200 });

	await page.getByRole("radio", { name: "Split" }).click();
	await expect(preview).toHaveAttribute("data-mode", "split");
	const divider = page.getByRole("slider", {
		name: "Split between source and output",
	});
	await expect(divider).toHaveAttribute("aria-valuenow", "50");
	const box = (await page
		.getByTestId("export-preview-canvas")
		.boundingBox()) as { x: number; y: number; width: number; height: number };
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, {
		steps: 5,
	});
	await page.mouse.up();
	const at = Number(await divider.getAttribute("aria-valuenow"));
	expect(at).toBeGreaterThanOrEqual(23);
	expect(at).toBeLessThanOrEqual(27);
	await divider.focus();
	await page.keyboard.press("Shift+ArrowRight");
	await expect(divider).toHaveAttribute("aria-valuenow", String(at + 10));

	await page.getByRole("radio", { name: "Output" }).click();
	await expect(preview).toHaveAttribute("data-mode", "output");
	await expect(divider).toHaveCount(0);
});

test.describe("at tablet width", () => {
	test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

	test("focusing a switch in the settings sheet does not scroll the app", async ({
		page,
	}) => {
		await openSample(page);
		await page.keyboard.press(`${mod}+3`);
		await page.getByRole("button", { name: "New preset" }).first().click();
		await page.getByRole("button", { name: "Settings" }).first().click();
		await settingsTab(page, "Print");
		const toggle = page.getByRole("switch", {
			name: "Optimize for card printer",
		});
		await toggle.focus();
		await page.keyboard.press("Space");
		await expect(toggle).toBeChecked();
		await page.keyboard.press("Tab");
		// Checkboxes and switches keep their hidden input inside the sheet's
		// scroller, so nothing overflows the app's root for focus to reveal.
		const root = await page.evaluate(() => {
			const el = document.querySelector(".h-dvh") as HTMLElement;
			return {
				scrollTop: el.scrollTop,
				over: el.scrollHeight - el.clientHeight,
			};
		});
		expect(root).toEqual({ scrollTop: 0, over: 0 });
	});
});
