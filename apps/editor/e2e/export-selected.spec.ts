import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { mod, openSample, run, state } from "./helpers";

/**
 * Six members bound to the membership card, two already exported, and a
 * preset of fronts whose own filter is "Pending": r1, r3, r4 and r6.
 */
async function seed(page: Page) {
	await openSample(page, "membership-card");
	await run(
		page,
		`
		const keys = Object.keys(c.template.fields.properties);
		const tiers = ["Gold", "Silver", "Bronze"];
		const sample = (k, i) => ({
			display_name: "Member " + (i + 1),
			tier: tiers[i % 3],
			member_id: "LC " + String(i + 1).padStart(4, "0") + " 0000",
		})[k] ?? k + " " + (i + 1);
		const dataset = {
			id: "d_members",
			name: "Members",
			columns: keys.map((key) => ({ key, type: "text" })),
			records: Array.from({ length: 6 }, (_, i) => ({
				id: "r" + (i + 1),
				status: i === 1 || i === 4 ? "exported" : "pending",
				values: Object.fromEntries(keys.map((k) => [k, sample(k, i)])),
			})),
			assets: [],
		};
		c.dispatch({ type: "datasetEdit", datasets: [dataset], activeId: "d_members" });
		const tid = c.state.workspace.activeTemplateId;
		c.dispatch({
			type: "setBinding",
			id: tid,
			binding: {
				datasetId: "d_members",
				fields: Object.fromEntries(keys.map((k) => [k, { kind: "column", column: k }])),
			},
		});
		c.dispatch({
			type: "setPreset",
			preset: {
				id: "p_pending", name: "Pending fronts", templateId: tid,
				records: "pending", sides: ["front"], format: "png-zip", scale: 1,
				dpi: 300, fileName: "{{display_name}}", markExported: true,
			},
		});
		c.dispatch({ type: "setActivePreset", id: "p_pending" });
	`,
	);
	return state<unknown>(page, "s.workspace.presets[0]");
}

async function download(page: Page, start: () => Promise<void>) {
	const pending = page.waitForEvent("download", { timeout: 120_000 });
	await start();
	const file = await pending;
	const path = await file.path();
	return { name: file.suggestedFilename(), bytes: await readFile(path) };
}

function pngs(bytes: Uint8Array) {
	const entries = unzipSync(bytes);
	return {
		names: Object.keys(entries)
			.filter((n) => n.endsWith(".png"))
			.sort(),
		report: Object.keys(entries).includes("export-report.csv"),
	};
}

const statuses = (page: Page) =>
	state<string[]>(page, "s.workspace.datasets[0].records.map((r) => r.status)");

test("Data: export three selected records with a Pending preset, which stays as it was", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const preset = await seed(page);
	await page.keyboard.press(`${mod}+2`);
	await expect(page.getByTestId("section-data")).toBeVisible();
	await page.getByRole("radio", { name: "Gallery" }).click();
	const card = (id: string) =>
		page.locator(`[data-testid=records-gallery] [role=row][data-row="${id}"]`);
	await expect(card("r1")).toBeVisible();

	// Nothing selected, no "Export selected".
	await expect(page.getByTestId("export-selected")).toHaveCount(0);
	// One pending and two exported records: the preset's own filter would
	// take none of the exported ones.
	await card("r1").click();
	await card("r2").click({ modifiers: ["Shift"] });
	await card("r5").click({ modifiers: [mod] });
	await expect(page.getByTestId("data-status-selected")).toHaveText(
		"3 selected",
	);

	await page.getByTestId("export-selected").click();
	const popover = page.getByTestId("export-selected-popover");
	await expect(popover).toBeVisible();
	await expect(popover.getByRole("heading")).toHaveText("Export 3 selected");
	await expect(popover.getByRole("button", { name: /Preset/ })).toContainText(
		"Pending fronts",
	);
	await expect(page.getByTestId("export-selected-summary")).toHaveText(
		"3 files · PNG zip · Download",
	);
	// Escape puts it away; Mod+E brings it back.
	await page.keyboard.press("Escape");
	await expect(popover).toHaveCount(0);
	await card("r5").focus();
	await page.keyboard.press(`${mod}+E`);
	await expect(popover).toBeVisible();

	const zip = await download(page, () =>
		popover.getByRole("button", { name: "Export", exact: true }).click(),
	);
	expect(zip.name).toBe("pending_fronts.zip");
	const out = pngs(new Uint8Array(zip.bytes));
	expect(out.names).toEqual(["Member-1.png", "Member-2.png", "Member-5.png"]);
	expect(out.report).toBe(true);

	// Still in Data, with the job in its bar.
	await expect(page.getByTestId("section-data")).toBeVisible();
	const bar = page.getByTestId("export-job");
	await expect(bar).toHaveAttribute("data-state", "done");
	await expect(page.getByTestId("export-summary")).toContainText(
		"Pending fronts · 3 selected records · 3 ok",
	);
	// Statuses change as for any run, and the preset is untouched.
	await expect
		.poll(() => statuses(page))
		.toEqual([
			"exported",
			"exported",
			"pending",
			"pending",
			"exported",
			"pending",
		]);
	expect(await state<unknown>(page, "s.workspace.presets")).toEqual([preset]);
	await bar.getByRole("button", { name: "Close" }).click();
	await expect(bar).toHaveCount(0);
});

test("Export: the filmstrip selects with Shift, Mod and Mod+A, and exports only the selection", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const preset = await seed(page);
	await page.keyboard.press(`${mod}+3`);
	const exportButton = page.getByTestId("export-job").getByRole("button", {
		name: /^Export /,
	});
	await expect(exportButton).toHaveText("Export 4 files");
	await page.getByRole("radio", { name: /^All/ }).click();
	const strip = page.getByTestId("export-filmstrip");
	await expect(strip.getByRole("option")).toHaveCount(6);
	const cell = (id: string) => strip.locator(`[data-record="${id}"]`);

	await cell("r1").click();
	await cell("r2").click({ modifiers: [mod] });
	await cell("r4").click({ modifiers: ["Shift"] });
	await expect(exportButton).toHaveText("Export 3 selected");
	for (const [id, on] of [
		["r1", "false"],
		["r2", "true"],
		["r3", "true"],
		["r4", "true"],
	])
		await expect(cell(id)).toHaveAttribute("aria-checked", on);
	// The plain click previewed; the selection did not move the preview.
	await expect(strip.getByRole("option", { selected: true })).toHaveAttribute(
		"data-record",
		"r1",
	);
	// The Records tab shares the selection.
	await page.getByRole("tab", { name: "Records" }).click();
	await expect(page.getByTestId("export-records-selection")).toHaveText(
		"3 selected",
	);
	await page.getByRole("tab", { name: "Filmstrip" }).click();

	await strip.focus();
	await page.keyboard.press("Escape");
	await expect(exportButton).toHaveText("Export 4 files");
	await page.keyboard.press(`${mod}+A`);
	await expect(exportButton).toHaveText("Export 6 selected");
	await page.getByRole("button", { name: "Clear selection" }).click();
	await expect(exportButton).toHaveText("Export 4 files");

	await cell("r2").click({ modifiers: [mod] });
	await cell("r5").click({ modifiers: [mod] });
	await expect(exportButton).toHaveText("Export 2 selected");
	const zip = await download(page, () => exportButton.click());
	expect(pngs(new Uint8Array(zip.bytes)).names).toEqual([
		"Member-2.png",
		"Member-5.png",
	]);
	await expect(page.getByTestId("export-summary")).toContainText(
		"2 selected records",
	);
	expect(await state<unknown>(page, "s.workspace.presets")).toEqual([preset]);
});

test("Data: with no preset for the dataset, Export selected opens Export", async ({
	page,
}) => {
	await seed(page);
	await run(page, `c.dispatch({ type: "removePreset", id: "p_pending" })`);
	await page.keyboard.press(`${mod}+2`);
	await page.getByRole("radio", { name: "Gallery" }).click();
	await page
		.locator('[data-testid=records-gallery] [role=row][data-row="r1"]')
		.click();
	await page.getByTestId("export-selected").click();
	const popover = page.getByTestId("export-selected-popover");
	await expect(popover).toContainText("No presets");
	await popover.getByRole("button", { name: "Open Export" }).click();
	await expect(page.getByTestId("section-export")).toBeVisible();
});
