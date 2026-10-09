import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import {
	dragTemplate,
	mod,
	openSample,
	probePath,
	run,
	settle,
	state,
} from "./helpers";

/** Draws a barcode with the tool (B) over the card's lower left, and returns
 *  its key. */
async function drawBarcode(page: Page): Promise<string> {
	await page.getByTestId("artboard").hover();
	await page.keyboard.press("b");
	expect(await state<string>(page, "s.tool")).toBe("barcode");
	await dragTemplate(page, { x: 60, y: 440 }, { x: 420, y: 140 });
	const key = await state<string>(page, "s.selection[0]");
	expect(
		await state<string>(
			page,
			`c.template.template_data[0].elements.at(-1).type`,
		),
	).toBe("barcode");
	await expect(page.getByLabel("Barcode value")).toHaveValue("FRESHCOAT");
	return key;
}

async function setValue(page: Page, value: string) {
	const input = page.getByLabel("Barcode value");
	await input.fill(value);
	await settle(page);
}

async function chooseType(page: Page, label: string) {
	await page.getByRole("button", { name: /Barcode type/ }).click();
	await page.getByRole("listbox").getByRole("option", { name: label }).click();
	await settle(page);
}

test("draw a barcode, bind it to a field, and step records", async ({
	page,
}) => {
	await openSample(page);
	await page.evaluate(async (path) => {
		const { bindSampleRecords } = await import(/* @vite-ignore */ path);
		bindSampleRecords(["ALPHA-1", "WWWWWWWWWWWW", "Q9"]);
	}, probePath("record-probe"));
	await settle(page);
	await page.getByRole("tab", { name: "Design" }).click();
	await drawBarcode(page);
	const el = "c.template.template_data[0].elements.at(-1)";
	expect(await state<unknown>(page, `${el}.properties`)).toEqual({
		value: "FRESHCOAT",
		symbology: "code128",
	});
	// The encoder loaded; nothing drew as a placeholder.
	expect(await state<string[]>(page, "s.render.warnings")).toEqual([]);

	// White behind the bars, so spaces read against the card's dark art.
	await page.getByRole("button", { name: "Add background" }).click();
	await page.getByLabel("Barcode value").fill("");
	await page.getByRole("button", { name: "Insert field" }).click();
	await page.getByRole("menuitem", { name: /display_name/ }).click();
	await settle(page);
	expect(await state<string>(page, `${el}.properties.value`)).toBe(
		"{{display_name}}",
	);

	// A stripe across the bars, just under the top of the box, from one paint.
	const stripe = () =>
		page.evaluate(async () => {
			const f = (
				window as unknown as {
					__freshcoat: {
						snapshot(): Promise<HTMLCanvasElement>;
						controller: { template: { width: number } };
					};
				}
			).__freshcoat;
			const c = await f.snapshot();
			const s = c.width / f.controller.template.width;
			const ctx = c.getContext("2d") as CanvasRenderingContext2D;
			const data = ctx.getImageData(
				Math.round(64 * s),
				Math.round(470 * s),
				Math.round(416 * s),
				1,
			).data;
			return Array.from(data.filter((_, i) => i % 4 === 0));
		});
	await page.getByRole("tab", { name: "Content" }).click();
	const stepper = page.getByTestId("record-stepper");
	await expect(stepper).toBeVisible();
	await stepper.getByRole("button", { name: "Next record" }).click();
	await settle(page);
	expect(await state<string>(page, "s.values.display_name")).toBe("ALPHA-1");
	const first = await stripe();
	// Bars: both black and white columns along the stripe.
	expect(first.some((v) => v < 60)).toBe(true);
	expect(first.some((v) => v > 200)).toBe(true);
	await stepper.getByRole("button", { name: "Next record" }).click();
	await settle(page);
	const second = await stripe();
	expect(second).not.toEqual(first);
	await stepper.getByRole("button", { name: "Next record" }).click();
	await settle(page);
	expect(await stripe()).not.toEqual(second);
	expect(await state<string[]>(page, "s.render.warnings")).toEqual([]);
});

test("an invalid EAN-13 says why inline and in the issues", async ({
	page,
}) => {
	await openSample(page);
	const key = await drawBarcode(page);
	await chooseType(page, "EAN-13");
	await setValue(page, "12345");
	const message = page.getByTestId("barcode-message");
	await expect(message).toBeVisible();
	await expect(message).toContainText(/EAN-13/i);
	await expect(page.getByLabel("Barcode value")).toHaveAttribute(
		"aria-invalid",
		"true",
	);

	// A hint, not an issue: the count stays at none.
	await run(page, "c.select([])");
	expect(await state<string[]>(page, "s.selection")).toEqual([]);
	const badge = page.getByTestId("issues-badge");
	await expect(badge).toHaveAccessibleName("No issues");
	await badge.click();
	const hint = page.getByTestId("issues-popover").getByTestId("barcode-hint");
	await expect(hint).toBeVisible();
	await expect(hint).toContainText(/EAN-13/i);
	// The layer link selects the code again and closes the list.
	await hint.getByRole("button", { name: /Select/ }).click();
	expect(await state<string[]>(page, "s.selection")).toEqual([key]);
	await expect(page.getByTestId("issues-popover")).toHaveCount(0);

	await setValue(page, "590123412345");
	await expect(message).toHaveCount(0);
	expect(await state<unknown[]>(page, "s.render.barcodes ?? []")).toHaveLength(
		0,
	);
});

test("an export fails only the record whose barcode is invalid", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await openSample(page);
	await drawBarcode(page);
	await chooseType(page, "EAN-13");
	await setValue(page, "{{member_id}}");

	const ids = ["590123412345", "12AB", "4006381333931"];
	await page.evaluate((ids) => {
		const c = (
			window as unknown as {
				__freshcoat: {
					controller: {
						template: { fields: { properties: Record<string, unknown> } };
						state: { workspace: { activeTemplateId: string } };
						dispatch(action: unknown): void;
					};
				};
			}
		).__freshcoat.controller;
		const keys = Object.keys(c.template.fields.properties);
		c.dispatch({
			type: "datasetEdit",
			datasets: [
				{
					id: "d_codes",
					name: "Codes",
					columns: keys.map((key) => ({ key, type: "text" })),
					records: ids.map((id, i) => ({
						id: `r${i + 1}`,
						status: "pending",
						values: Object.fromEntries(
							keys.map((k) => [
								k,
								k === "member_id"
									? id
									: k === "verified"
										? "true"
										: `${k} ${i}`,
							]),
						),
					})),
					assets: [],
				},
			],
		});
		const tid = c.state.workspace.activeTemplateId;
		c.dispatch({
			type: "setBinding",
			id: tid,
			binding: {
				datasetId: "d_codes",
				fields: Object.fromEntries(
					keys.map((k) => [k, { kind: "column", column: k }]),
				),
			},
		});
		c.dispatch({
			type: "setPreset",
			preset: {
				id: "p_png",
				name: "Cards",
				templateId: tid,
				records: "all",
				sides: ["front"],
				dpi: 300,
				format: "png",
				scale: 1,
				fileName: "{{index}}-{{side}}",
				markExported: true,
			},
		});
	}, ids);
	await settle(page);
	await page.keyboard.press(`${mod}+3`);
	await expect(page.getByTestId("section-export")).toBeVisible();

	const pending = page.waitForEvent("download", { timeout: 120_000 });
	await page.getByRole("button", { name: /^Export \d+ files?$/ }).click();
	const file = await pending;
	const entries = unzipSync(new Uint8Array(await readFile(await file.path())));
	const names = Object.keys(entries);
	expect(names.filter((n) => n.endsWith(".png"))).toHaveLength(2);
	const report = strFromU8(entries["export-report.csv"] as Uint8Array)
		.trim()
		.split("\r\n");
	expect(report).toHaveLength(4);
	const row = (id: string) => report.find((l) => l.includes(`,${id},`)) ?? "";
	expect(row("r1")).toContain(",ok,");
	expect(row("r3")).toContain(",ok,");
	expect(row("r2")).toContain(",failed,");
	expect(row("r2")).toMatch(/Barcode: .*EAN-13/i);

	await expect(page.getByTestId("export-job")).toHaveAttribute(
		"data-state",
		"done",
	);
	expect(
		await state<string[]>(
			page,
			`s.workspace.datasets.find((d) => d.id === "d_codes").records.map((r) => r.status)`,
		),
	).toEqual(["exported", "failed", "exported"]);
});
