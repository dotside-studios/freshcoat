import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { mod, openSample, probePath, run, settle, state } from "./helpers";

test("a sample opens as a one-template workspace", async ({ page }) => {
	await openSample(page);
	expect(await state<number>(page, "s.workspace.templates.length")).toBe(1);
	await expect(page.getByTestId("templates-list")).toContainText(
		"membership-card",
	);
});

test("templates can be added, switched and keep their own undo", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["0/6"]); c.nudge(5, 0)`);
	await page.getByRole("button", { name: "Add template" }).click();
	await page.getByRole("menuitem", { name: /A4 landscape/ }).click();
	await expect
		.poll(() => state<number>(page, "s.workspace.templates.length"))
		.toBe(2);
	await settle(page);
	expect(await state<number>(page, "t.width")).toBe(842);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(0);

	await page
		.getByTestId("templates-list")
		.getByRole("option", { name: /membership-card/ })
		.click();
	await settle(page);
	expect(await state<number>(page, "t.width")).toBe(1012);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(1);
});

test("save a .coatworkspace, reopen it, and get the same workspace", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["0/6"]); c.nudge(7, 3)`);
	await run(
		page,
		`c.dispatch({ type: "addTemplate", template: c.template, fileName: "Second.coat" })`,
	);
	await run(
		page,
		`c.dispatch({ type: "datasetEdit", datasets: [{ id: "d_people", name: "People", columns: [{ key: "display_name", type: "text", required: true }], records: [{ id: "r_1", values: { display_name: "Ada" }, status: "pending" }], assets: [] }] })`,
	);
	const snapshot = () =>
		page.evaluate(async (path) => {
			const { workspaceSnapshot } = await import(/* @vite-ignore */ path);
			const c = (
				window as unknown as {
					__freshcoat: { controller: { state: unknown } };
				}
			).__freshcoat.controller;
			const ws = workspaceSnapshot(c.state as never) as {
				templates: { id: string }[];
			};
			return JSON.parse(JSON.stringify(ws));
		}, probePath("app-probe"));
	const before = await snapshot();
	expect(await state<boolean>(page, "c.dirty")).toBe(true);

	const download = page.waitForEvent("download");
	await page.keyboard.press(`${mod}+s`);
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/\.coatworkspace$/);
	expect(await state<boolean>(page, "c.dirty")).toBe(false);

	await run(page, "c.close()");
	await page.getByTestId("open-file-input").setInputFiles({
		name: file.suggestedFilename(),
		mimeType: "application/zip",
		buffer: await readFile(await file.path()),
	});
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	expect(await snapshot()).toEqual(before);
	expect(await state<boolean>(page, "c.dirty")).toBe(false);
});

test("Save workspace in Unsaved changes writes every template and dataset, then closes", async ({
	page,
}) => {
	await openSample(page);
	await run(
		page,
		`c.dispatch({ type: "addTemplate", template: c.template, fileName: "Second.coat" })`,
	);
	await run(
		page,
		`c.dispatch({ type: "datasetEdit", datasets: [{ id: "d_people", name: "People", columns: [{ key: "name", type: "text" }], records: [], assets: [] }] })`,
	);
	await page.getByRole("button", { name: "File", exact: true }).click();
	await page.getByRole("menuitem", { name: "Close workspace" }).click();
	const dialog = page.getByRole("alertdialog", { name: "Unsaved changes" });
	await expect(dialog).toBeVisible();
	const download = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Save workspace" }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/\.coatworkspace$/);
	const names = Object.keys(
		unzipSync(new Uint8Array(await readFile(await file.path()))),
	);
	const templates = names.filter((n) => n.startsWith("templates/"));
	expect(templates).toHaveLength(2);
	expect(templates.every((n) => n.endsWith(".coat"))).toBe(true);
	expect(names).toContain("data/d_people/schema.json");
	await expect(page.getByTestId("sample-membership-card")).toBeVisible();
	expect(await state<boolean>(page, "s.doc === null")).toBe(true);
});

test("export all templates writes one .coat per template", async ({ page }) => {
	await openSample(page);
	await run(
		page,
		`c.dispatch({ type: "addTemplate", template: c.template, fileName: "Second.coat" })`,
	);
	const download = page.waitForEvent("download");
	await run(page, "c.exportAllTemplates()");
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/templates\.zip$/);
	const names = Object.keys(
		unzipSync(new Uint8Array(await readFile(await file.path()))),
	).sort();
	expect(names).toEqual([
		"templates/Second.coat",
		"templates/membership-card.coat",
	]);
});

test("the section switcher moves between Edit, Data and Export", async ({
	page,
}) => {
	await openSample(page);
	await page.getByTestId("section-switcher").getByText("Data").click();
	await expect(page.getByTestId("section-data")).toBeVisible();
	await expect(page.getByTestId("section-edit")).toBeHidden();
	await page.keyboard.press(`${mod}+3`);
	await expect(page.getByTestId("section-export")).toBeVisible();
	await page.keyboard.press(`${mod}+1`);
	await expect(page.getByTestId("section-edit")).toBeVisible();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
});

test("delete in the Data section does not reach the canvas", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["0/6"])`);
	const count = await state<number>(page, "t.template_data[0].elements.length");
	await page.keyboard.press(`${mod}+2`);
	await page.keyboard.press("Delete");
	await page.keyboard.press(`${mod}+1`);
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		count,
	);
});
