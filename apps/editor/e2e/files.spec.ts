import { readFile } from "node:fs/promises";
import { LEGACY_TKIT_MEDIA_TYPE } from "@freshcoat-js/coatfile/coat";
import { expect, test } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { mod, openSample, run, settle, state } from "./helpers";

test("export as .coat, reopen, and get the same template back", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["0/6"]); c.nudge(7, 3)`);
	const before = await state<unknown>(page, "t");
	expect(await state<boolean>(page, "c.dirty")).toBe(true);

	const download = page.waitForEvent("download");
	await run(page, `c.save("coat")`);
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/\.coat$/);
	const path = await file.path();

	await run(page, "c.close()");
	await expect(page.getByTestId("sample-membership-card")).toBeVisible();
	await page.getByTestId("open-file-input").setInputFiles({
		name: file.suggestedFilename(),
		mimeType: "application/zip",
		buffer: await readFile(path),
	});
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	expect(await state<unknown>(page, "t")).toEqual(before);
});

test("a .tkit package from before the rename still opens", async ({ page }) => {
	await openSample(page);
	const before = await state<unknown>(page, "t");
	const download = page.waitForEvent("download");
	await run(page, `c.save("coat")`);
	const entries = unzipSync(
		new Uint8Array(await readFile(await (await download).path())),
	);
	entries.mimetype = strToU8(LEGACY_TKIT_MEDIA_TYPE);

	await run(page, "c.close()");
	await expect(page.getByTestId("sample-membership-card")).toBeVisible();
	await page.getByTestId("open-file-input").setInputFiles({
		name: "membership-card.tkit",
		mimeType: "application/zip",
		buffer: Buffer.from(zipSync(entries)),
	});
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	expect(await state<unknown>(page, "t")).toEqual(before);
});

test("save as .coat.json writes template JSON", async ({ page }) => {
	await openSample(page, "minimal");
	const download = page.waitForEvent("download");
	await page.keyboard.press(`${mod}+Shift+s`);
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/\.coat\.json$/);
	const json = JSON.parse(await readFile(await file.path(), "utf8"));
	expect(json.format_version).toMatch(/^1\./);
	expect(json.template_data.length).toBe(1);
});

test("export writes a PNG at the chosen density", async ({ page }) => {
	await openSample(page);
	const download = page.waitForEvent("download");
	await page.keyboard.press(`${mod}+Shift+e`);
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/-front@2x\.png$/);
	const png = await readFile(await file.path());
	expect(png.subarray(1, 4).toString()).toBe("PNG");
	expect(png.readUInt32BE(16)).toBe(2024);
	expect(png.readUInt32BE(20)).toBe(1276);
});

test("an invalid document refuses to save and says why", async ({ page }) => {
	await openSample(page, "minimal");
	await run(page, `c.edit((t) => ({ ...t, name: "" }))`);
	expect(await state<number>(page, "s.doc.issues.length")).toBeGreaterThan(0);
	let downloaded = false;
	page.on("download", () => {
		downloaded = true;
	});
	await page.keyboard.press(`${mod}+s`);
	await expect(page.getByText(/before saving/)).toBeVisible();
	expect(downloaded).toBe(false);
	await expect(page.getByTestId("issues-popover")).toBeVisible();
	await expect(
		page
			.getByTestId("issues-popover")
			.getByRole("region", { name: "Validation" }),
	).toBeVisible();
});

test("Template setup opens from the File menu and its shortcut", async ({
	page,
}) => {
	await openSample(page);
	const setup = page.getByTestId("template-setup");
	await page.getByRole("button", { name: "File", exact: true }).click();
	await page.getByRole("menuitem", { name: "Template setup…" }).click();
	await expect(
		setup.getByRole("heading", { name: "Template setup" }),
	).toBeVisible();
	for (const name of ["General", "Size", "Fonts"])
		await expect(setup.getByRole("region", { name })).toBeVisible();
	await setup.getByRole("textbox", { name: "Name" }).fill("Club card");
	expect(await state<string>(page, "t.name")).toBe("Club card");
	await page.keyboard.press("Escape");
	await expect(setup).toHaveCount(0);

	await page.keyboard.press(`${mod}+Alt+Comma`);
	await expect(setup).toBeVisible();
	await setup.getByRole("button", { name: "Done" }).click();
	await expect(setup).toHaveCount(0);

	await page.keyboard.press("Shift+?");
	await expect(
		page
			.getByRole("dialog", { name: "Keyboard shortcuts" })
			.getByText("Template setup…"),
	).toBeVisible();
});

test("an unnamed template is named on its first .coat export", async ({
	page,
}) => {
	await page.goto("/");
	await run(page, "c.newDocument({ width: 400, height: 300 })");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await run(page, `c.save("coat")`);
	const prompt = page.getByTestId("template-setup");
	await expect(
		prompt.getByRole("heading", { name: "Name this template" }),
	).toBeVisible();
	await expect(prompt.getByTestId("naming-file")).toHaveText(
		"Untitled.coat has no name yet",
	);
	await expect(prompt.getByRole("textbox", { name: "Name" })).toBeFocused();
	await page.keyboard.type("Spring badge");
	await expect(prompt.getByRole("textbox", { name: "ID" })).toHaveValue(
		"spring-badge",
	);
	const download = page.waitForEvent("download");
	await prompt.getByRole("button", { name: "Save" }).click();
	expect((await download).suggestedFilename()).toBe("spring-badge.coat");
	await expect(prompt).toHaveCount(0);
	expect(await state<string>(page, "t.name")).toBe("Spring badge");
});

test("saving a workspace asks about each unnamed template in turn", async ({
	page,
}) => {
	await page.goto("/");
	await run(page, "c.newDocument({ width: 400, height: 300 })");
	await run(page, "c.newTemplate({ width: 300, height: 400 })");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	const ids = await state<string[]>(
		page,
		"s.workspace.templates.map((e) => e.id)",
	);
	await page.keyboard.press(`${mod}+s`);
	const prompt = page.getByTestId("template-setup");
	await expect(prompt.getByRole("textbox", { name: "Name" })).toBeFocused();
	expect(await state<string>(page, "s.workspace.activeTemplateId")).toBe(
		ids[0],
	);
	await page.keyboard.type("Front desk");
	await prompt.getByRole("button", { name: "Save" }).click();

	await expect
		.poll(() => state<string>(page, "s.workspace.activeTemplateId"))
		.toBe(ids[1]);
	await expect(prompt.getByRole("textbox", { name: "Name" })).toHaveValue(
		"Untitled",
	);
	const download = page.waitForEvent("download");
	await prompt.getByRole("button", { name: "Skip" }).click();
	expect((await download).suggestedFilename()).toMatch(/\.coatworkspace$/);
	await expect(prompt).toHaveCount(0);
	expect(await state<string>(page, "s.workspace.activeTemplateId")).toBe(
		ids[1],
	);
	expect(
		await state<string[]>(
			page,
			"s.workspace.saved.templates.map((e) => e.template.id)",
		),
	).toEqual(["front-desk", "untitled"]);
});

test("copy and paste duplicates layers with fresh ids", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openSample(page);
	await run(page, `c.select(["0/6"])`);
	const id = await state<string>(page, `t.template_data[0].elements[6].id`);
	const count = await state<number>(page, "t.template_data[0].elements.length");
	await page.getByTestId("viewport").click({ position: { x: 5, y: 5 } });
	await run(page, `c.select(["0/6"])`);
	await page.keyboard.press(`${mod}+c`);
	await page.keyboard.press(`${mod}+v`);
	await settle(page);
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		count + 1,
	);
	const pasted = await state<string>(
		page,
		"c.template.template_data[0].elements[7].id",
	);
	expect(pasted).not.toBe(id);
	expect(pasted.startsWith(id)).toBe(true);
});

test("pasting SVG markup places a drawn image, not text", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openSample(page);
	const svg =
		'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#e11d48"/></svg>';
	await page.evaluate((text) => navigator.clipboard.writeText(text), svg);
	const count = await state<number>(page, "t.template_data[0].elements.length");
	await page.getByTestId("viewport").click({ position: { x: 5, y: 5 } });
	await page.keyboard.press(`${mod}+v`);
	await expect
		.poll(() => state<number>(page, "t.template_data[0].elements.length"))
		.toBe(count + 1);
	await settle(page);
	const placed = await state<{
		type: string;
		size: { width: number; height: number };
		contentType: string;
	}>(
		page,
		`(() => {
			const el = t.template_data[0].elements.at(-1);
			const sha = el.properties.src.split(/[:/]/).at(-1);
			const asset = t.assets.find((a) => a.sha256 === sha);
			return { type: el.type, size: el.size, contentType: asset.contentType };
		})()`,
	);
	expect(placed).toEqual({
		type: "image",
		size: { width: 40, height: 20 },
		contentType: "image/png",
	});
	expect(await state<string[]>(page, "s.render.warnings")).toEqual([]);
});

test("autosave offers to restore unsaved work", async ({ page }) => {
	await openSample(page);
	await run(page, `c.select(["0/6"]); c.nudge(5, 0)`);
	const edited = await state<unknown>(page, "t");
	await page.waitForTimeout(1500);
	await page.reload();
	await expect(page.getByTestId("restore-banner")).toBeVisible();
	await page.getByRole("button", { name: "Restore" }).click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	expect(await state<unknown>(page, "t")).toEqual(edited);
});
