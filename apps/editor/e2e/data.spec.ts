import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";
import { mod, openSample, run, state } from "./helpers";

// SheetJS comes from the workspace package, which owns the dependency.
type Workbook = { SheetNames: string[]; Sheets: Record<string, unknown> };
const XLSX = createRequire(
	new URL("../../../packages/workspace/package.json", import.meta.url),
)("xlsx") as {
	read(data: Buffer, opts: { type: "buffer" }): Workbook;
	utils: { sheet_to_json<T>(sheet: unknown): T[] };
};

type Rec = { id: string; status: string; values: Record<string, unknown> };
type Col = { key: string; type: string; required?: boolean };

const CSV = [
	"Full Name,tier,Points,verified",
	"Ada Lovelace,Gold,120,yes",
	"Grace Hopper,Silver,95,no",
	"Alan Turing,Gold,abc,yes",
].join("\n");

// A 1×1 PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

const records = (page: Page) =>
	state<Rec[]>(page, "s.workspace.datasets[0].records");
const columns = (page: Page) =>
	state<Col[]>(page, "s.workspace.datasets[0].columns");

/** A column's cell texts in the order the rows are shown. */
function columnTexts(page: Page, col: string) {
	return page.evaluate((key) => {
		const rows = [
			...document.querySelectorAll<HTMLElement>("[role=row][data-row]"),
		];
		return rows
			.map((r) => ({
				at: Number(r.getAttribute("aria-rowindex")),
				text: r.querySelector(`[data-col="${key}"]`)?.textContent?.trim() ?? "",
			}))
			.sort((a, b) => a.at - b.at)
			.map((r) => r.text);
	}, col);
}

function cell(page: Page, row: string, col: string) {
	return page.locator(`[role=gridcell][data-row="${row}"][data-col="${col}"]`);
}

function galleryCard(page: Page, row: string) {
	return page.locator(
		`[data-testid=records-gallery] [role=row][data-row="${row}"]`,
	);
}

async function chooseFile(
	page: Page,
	open: () => Promise<unknown>,
	file: { name: string; mimeType: string; buffer: Buffer },
) {
	const chooser = page.waitForEvent("filechooser");
	await open();
	await (await chooser).setFiles(file);
}

async function download(page: Page, menu: string, item: string | RegExp) {
	await page.getByTestId(menu).click();
	const pending = page.waitForEvent("download");
	await page.getByRole("menuitem", { name: item }).click();
	const file = await pending;
	return {
		name: file.suggestedFilename(),
		bytes: await readFile((await file.path()) as string),
	};
}

async function openDataFromTemplate(page: Page) {
	await openSample(page);
	await page.keyboard.press(`${mod}+2`);
	await expect(page.getByTestId("data-empty")).toBeVisible();
	await page.getByRole("button", { name: "From template fields" }).click();
	await expect(page.getByTestId("datasets-list")).toContainText(
		"membership-card",
	);
}

async function importCsv(page: Page) {
	await page.getByTestId("import-records").click();
	const wizard = page.getByTestId("import-wizard");
	await chooseFile(
		page,
		() => wizard.getByRole("button", { name: "Choose file…" }).click(),
		{ name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) },
	);
	await expect(wizard).toContainText("members.csv · 3 records");
	await wizard.getByRole("button", { name: "Next" }).click();

	// "Full Name" goes to the existing display_name column.
	await wizard.getByRole("button", { name: /Target for Full Name/ }).click();
	await page
		.getByRole("option", { name: "display_name · Display name" })
		.click();
	// "Points" becomes a new integer column.
	await expect(wizard.getByLabel("New column key for Points")).toHaveValue(
		"points",
	);
	await wizard
		.getByRole("button", { name: /New column type for Points/ })
		.click();
	await page.getByRole("option", { name: "Integer" }).click();
	await wizard.getByRole("button", { name: "Next" }).click();

	await expect(wizard.getByTestId("import-totals")).toContainText(
		"3 to add · 0 to update · 1 with issues",
	);
	await expect(wizard.locator("[data-bad]")).toHaveCount(1);
	await wizard.getByRole("button", { name: "Import" }).click();
	await expect(wizard).toBeHidden();
}

test("a dataset from template fields takes a CSV through the wizard, then edits, sorts, searches, deletes and undoes", async ({
	page,
}) => {
	await openDataFromTemplate(page);
	const cols = await columns(page);
	expect(cols.map((c) => c.key)).toEqual([
		"display_name",
		"tier",
		"profile_url",
		"member_since",
		"member_id",
		"verified",
	]);
	expect(cols.find((c) => c.key === "display_name")?.required).toBe(true);
	expect(cols.find((c) => c.key === "verified")?.type).toBe("boolean");
	expect(cols.find((c) => c.key === "profile_url")?.type).toBe("url");

	await importCsv(page);
	const recs = await records(page);
	expect(recs).toHaveLength(3);
	expect(recs.map((r) => r.values.display_name)).toEqual([
		"Ada Lovelace",
		"Grace Hopper",
		"Alan Turing",
	]);
	expect(recs[0]?.values).toMatchObject({
		tier: "Gold",
		points: 120,
		verified: true,
	});
	expect(recs[1]?.values.verified).toBe(false);
	expect(recs[2]?.values.points).toBe("abc");
	expect((await columns(page)).at(-1)).toMatchObject({
		key: "points",
		type: "integer",
		title: "Points",
	});
	await expect(page.getByTestId("data-status")).toContainText("3 records");
	await expect(page.getByTestId("data-status")).toContainText("1 issue");

	const [ada, grace, alan] = recs.map((r) => r.id) as [string, string, string];

	// With the side panels closed every column fits without scrolling.
	await page.getByRole("button", { name: "Datasets panel" }).click();
	await page.getByRole("button", { name: "Record and columns panel" }).click();
	await expect(page.getByTestId("data-panel-right")).toBeHidden();

	// The integer column holding "abc" is flagged.
	await expect(
		cell(page, alan, "points").getByTestId("invalid-mark"),
	).toBeVisible();
	await expect(
		cell(page, ada, "points").getByTestId("invalid-mark"),
	).toHaveCount(0);
	await expect(
		cell(page, alan, "points").locator("[data-invalid]"),
	).toHaveAttribute("title", "Not a number");

	// Double-click edits in place; Enter commits.
	await cell(page, ada, "display_name").dblclick();
	const input = page.getByRole("textbox", { name: "Edit Display name" });
	await expect(input).toBeFocused();
	await input.fill("Ada King");
	await page.keyboard.press("Enter");
	await expect(input).toBeHidden();
	expect((await records(page))[0]?.values.display_name).toBe("Ada King");
	await expect(cell(page, ada, "display_name")).toBeFocused();

	// Typing a wrong value into the integer column flags it too.
	await cell(page, grace, "points").dblclick();
	await cell(page, grace, "points").getByRole("textbox").fill("ninety");
	await page.keyboard.press("Enter");
	expect((await records(page))[1]?.values.points).toBe("ninety");
	await expect(
		cell(page, grace, "points").getByTestId("invalid-mark"),
	).toBeVisible();
	await expect(page.getByTestId("data-status")).toContainText("2 issues");

	// Sorting cycles ascending, descending, off.
	const header = page.getByRole("columnheader", { name: /display_name/ });
	await header.click();
	expect(await columnTexts(page, "display_name")).toEqual([
		"Ada King",
		"Alan Turing",
		"Grace Hopper",
	]);
	await header.click();
	expect(await columnTexts(page, "display_name")).toEqual([
		"Grace Hopper",
		"Alan Turing",
		"Ada King",
	]);
	await header.click();
	expect(await columnTexts(page, "display_name")).toEqual([
		"Ada King",
		"Grace Hopper",
		"Alan Turing",
	]);

	// Search filters on any cell, ignoring case.
	const search = page.getByRole("searchbox", { name: "Search records" });
	await search.fill("TURING");
	await expect
		.poll(() => columnTexts(page, "display_name"))
		.toEqual(["Alan Turing"]);
	await expect(page.getByTestId("data-status-records")).toHaveText(
		"1 of 3 records",
	);
	await search.fill("silver");
	await expect
		.poll(() => columnTexts(page, "display_name"))
		.toEqual(["Grace Hopper"]);
	await search.fill("");
	await expect.poll(() => columnTexts(page, "display_name")).toHaveLength(3);

	// Delete a selected row, then undo it.
	await page
		.locator(`[role=row][data-row="${grace}"]`)
		.getByRole("checkbox")
		.check({ force: true });
	await expect(page.getByTestId("data-status")).toContainText("1 selected");
	await page.getByTestId("delete-rows").click();
	await expect.poll(async () => (await records(page)).length).toBe(2);
	await expect(page.locator(`[role=row][data-row="${grace}"]`)).toHaveCount(0);
	await page.keyboard.press(`${mod}+z`);
	await expect.poll(async () => (await records(page)).length).toBe(3);
	expect((await records(page))[1]?.id).toBe(grace);

	// Delete clears the focused cell, even with rows selected.
	await page
		.locator(`[role=row][data-row="${alan}"]`)
		.getByRole("checkbox")
		.check({ force: true });
	await cell(page, ada, "tier").click();
	await page.keyboard.press("Delete");
	await expect
		.poll(async () => (await records(page))[0]?.values.tier)
		.toBeUndefined();
	expect(await records(page)).toHaveLength(3);

	// Mod+Backspace deletes the selected rows.
	await page.keyboard.press(`${mod}+Backspace`);
	await expect.poll(async () => (await records(page)).length).toBe(2);
	await expect(page.locator(`[role=row][data-row="${alan}"]`)).toHaveCount(0);
	await page.keyboard.press(`${mod}+z`);
	await expect.poll(async () => (await records(page)).length).toBe(3);
	await page.getByTestId("data-status").click();

	// A status badge's menu changes that record's status.
	await page
		.locator(`[role=row][data-row="${alan}"]`)
		.getByTestId("status-badge")
		.click();
	await page.getByRole("menuitemradio", { name: "Exported" }).click();
	await expect
		.poll(async () => (await records(page))[2]?.status)
		.toBe("exported");
});

test("records export to CSV and XLSX, and the schema round-trips through JSON Schema", async ({
	page,
}) => {
	await openDataFromTemplate(page);
	await importCsv(page);

	const csv = await download(page, "download-menu", "CSV");
	expect(csv.name).toBe("membership-card.csv");
	const text = csv.bytes.toString("utf8").replace(/^﻿/, "");
	const lines = text.trim().split(/\r?\n/);
	expect(lines[0]).toBe(
		"display_name,tier,profile_url,member_since,member_id,verified,points",
	);
	expect(lines).toHaveLength(4);
	expect(lines[1]).toContain("Ada Lovelace,Gold");

	const xlsx = await download(page, "download-menu", /Excel/);
	expect(xlsx.name).toBe("membership-card.xlsx");
	const wb = XLSX.read(xlsx.bytes, { type: "buffer" });
	const sheet = wb.Sheets[wb.SheetNames[0] as string];
	const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
	expect(rows).toHaveLength(3);
	expect(rows[0]).toMatchObject({
		display_name: "Ada Lovelace",
		tier: "Gold",
		points: 120,
		verified: true,
	});

	const schemaFile = await download(
		page,
		"schema-menu",
		"Download JSON schema",
	);
	expect(schemaFile.name).toBe("membership-card.schema.json");
	const schema = JSON.parse(schemaFile.bytes.toString("utf8"));
	expect(schema.title).toBe("membership-card");
	expect(schema.properties.points).toMatchObject({
		type: "integer",
		title: "Points",
	});
	expect(schema.required).toEqual(["display_name"]);

	// Re-import it with one more property, merged into the columns.
	schema.properties.notes = {
		type: "string",
		"x-freshcoat-type": "longText",
		title: "Notes",
	};
	await page.getByTestId("schema-menu").click();
	await chooseFile(
		page,
		() => page.getByRole("menuitem", { name: "Import JSON schema…" }).click(),
		{
			name: "membership-card.schema.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(schema)),
		},
	);
	const dialog = page.getByRole("alertdialog", { name: "Import JSON schema" });
	await expect(dialog).toContainText("New: notes");
	await dialog.getByRole("button", { name: "Merge" }).click();
	await expect
		.poll(async () => (await columns(page)).map((c) => c.key))
		.toEqual([
			"display_name",
			"tier",
			"profile_url",
			"member_since",
			"member_id",
			"verified",
			"points",
			"notes",
		]);
	expect((await columns(page)).at(-1)?.type).toBe("longText");
	expect(await records(page)).toHaveLength(3);
});

test("a file imports as a new dataset, and photos match image cells", async ({
	page,
}) => {
	await openSample(page);
	await page.keyboard.press(`${mod}+2`);
	const json = JSON.stringify([
		{ name: "Ada", photo: "ada.png" },
		{ name: "Grace", photo: "grace.jpg" },
	]);
	await page.getByRole("button", { name: "Import file…" }).click();
	const wizard = page.getByTestId("import-wizard");
	await chooseFile(
		page,
		() => wizard.getByRole("button", { name: "Choose file…" }).click(),
		{
			name: "people.json",
			mimeType: "application/json",
			buffer: Buffer.from(json),
		},
	);
	await wizard.getByRole("button", { name: "Next" }).click();
	await wizard
		.getByRole("button", { name: /New column type for photo/ })
		.click();
	await page.getByRole("option", { name: "Image" }).click();
	await wizard.getByRole("button", { name: "Next" }).click();
	await wizard.getByRole("button", { name: "Import" }).click();
	await expect(page.getByTestId("datasets-list")).toContainText("people");
	expect(await state<string>(page, "s.workspace.datasets[0].name")).toBe(
		"people",
	);
	await expect(page.getByTestId("data-status")).toContainText("2 issues");

	// The photo column is the second, so the dataset opens as a gallery.
	await expect(page.getByTestId("records-gallery")).toBeVisible();
	await page.getByTestId("add-menu").click();
	await chooseFile(
		page,
		() => page.getByRole("menuitem", { name: "Photos…", exact: true }).click(),
		{ name: "ada.png", mimeType: "image/png", buffer: PNG },
	);
	await expect
		.poll(() =>
			state<unknown>(page, "s.workspace.datasets[0].records[0].values.photo"),
		)
		.toMatch(/^ws:[0-9a-f]{64}$/);
	await expect(page.getByTestId("data-status")).toContainText("1 issue");
	const id = await state<string>(page, "s.workspace.datasets[0].records[0].id");
	await expect(galleryCard(page, id).locator("img")).toBeVisible();
	await expect(galleryCard(page, id)).toContainText("Ada");
	await page.getByRole("radio", { name: "Table" }).click();
	await expect(cell(page, id, "photo").locator("img")).toBeVisible();
	await expect(cell(page, id, "photo")).toContainText("ada.png");
});

test("renaming a column rewrites its values and the binding that reads it", async ({
	page,
}) => {
	await openDataFromTemplate(page);
	await importCsv(page);
	await run(
		page,
		`const s = c.state.workspace; c.dispatch({ type: "setBinding", id: s.activeTemplateId, binding: { datasetId: s.datasets[0].id, fields: { display_name: { kind: "column", column: "display_name" } } } })`,
	);
	await page.getByRole("tab", { name: "Columns" }).click();
	await page
		.getByTestId("columns-list")
		.getByRole("option", { name: /display_name/ })
		.click();
	const key = page.getByTestId("column-key");
	await key.fill("full_name");
	await key.press("Enter");
	await expect
		.poll(async () => (await columns(page))[0]?.key)
		.toBe("full_name");
	expect((await records(page))[0]?.values.full_name).toBe("Ada Lovelace");
	expect(
		await state<unknown>(
			page,
			"s.workspace.templates[0].binding.fields.display_name",
		),
	).toEqual({ kind: "column", column: "full_name" });
});

test("a failed record shows its error and opens in Export", async ({
	page,
}) => {
	await openDataFromTemplate(page);
	await importCsv(page);
	const id = (await records(page))[1]?.id as string;
	await run(
		page,
		`c.dispatch({ type: "setRecordStatus", datasetId: c.state.workspace.datasets[0].id, ids: ["${id}"], status: "failed", errors: { "${id}": "Font missing" }, fromJob: true })`,
	);
	await cell(page, id, "tier").click();
	const error = page.getByTestId("record-error");
	await expect(error).toContainText("Font missing");
	await error.getByRole("button", { name: "Show in Export" }).click();
	await expect(page.getByTestId("section-export")).toBeVisible();
	expect(await state<string>(page, "s.exportRecordId")).toBe(id);
});

/** A real JPEG of this size from the page's own encoder, with an EXIF
 *  orientation and capture time spliced in after its start marker. */
async function makeJpeg(
	page: Page,
	width: number,
	height: number,
	orientation: number,
): Promise<Buffer> {
	const bytes = await page.evaluate(
		async ([w, h]) => {
			const c = new OffscreenCanvas(w as number, h as number);
			const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
			g.fillStyle = "#c33";
			g.fillRect(0, 0, w as number, h as number);
			const blob = await c.convertToBlob({ type: "image/jpeg" });
			return [...new Uint8Array(await blob.arrayBuffer())];
		},
		[width, height],
	);
	const date = [...Buffer.from("2024:05:01 13:22:10\0")];
	// Big-endian TIFF: IFD0 with Orientation and a pointer to an Exif IFD
	// holding DateTimeOriginal, then the date string.
	const tiff = [
		0x4d,
		0x4d,
		0,
		42,
		0,
		0,
		0,
		8,
		0,
		2,
		0x01,
		0x12,
		0,
		3,
		0,
		0,
		0,
		1,
		0,
		orientation,
		0,
		0,
		0x87,
		0x69,
		0,
		4,
		0,
		0,
		0,
		1,
		0,
		0,
		0,
		38,
		0,
		0,
		0,
		0,
		0,
		1,
		0x90,
		0x03,
		0,
		2,
		0,
		0,
		0,
		20,
		0,
		0,
		0,
		56,
		0,
		0,
		0,
		0,
		...date,
	];
	const body = [...Buffer.from("Exif\0\0"), ...tiff];
	const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff];
	return Buffer.from([0xff, 0xd8, ...app1, ...body, ...bytes.slice(2)]);
}

test("a new dataset from photos has their names, sizes as seen and dates", async ({
	page,
}) => {
	await openSample(page);
	await page.keyboard.press(`${mod}+2`);
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "From photos…" }).click();
	await (await chooser).setFiles([
		{
			name: "IMG_2.jpg",
			mimeType: "image/jpeg",
			buffer: await makeJpeg(page, 60, 40, 6),
		},
		{ name: "IMG_10.png", mimeType: "image/png", buffer: PNG },
		{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") },
	]);
	await expect
		.poll(() => state<number>(page, "s.workspace.datasets.length"))
		.toBe(1);
	expect(await columns(page)).toEqual([
		{ key: "photo", title: "Photo", type: "image" },
		{ key: "file_name", title: "File name", type: "text" },
		{ key: "width", title: "Width", type: "integer" },
		{ key: "height", title: "Height", type: "integer" },
		{ key: "taken_at", title: "Taken", type: "date" },
	]);
	const rows = await records(page);
	expect(rows.map((r) => r.values.file_name)).toEqual([
		"IMG_2.jpg",
		"IMG_10.png",
	]);
	expect(rows[0]?.values).toMatchObject({
		width: 40,
		height: 60,
		taken_at: "2024-05-01",
	});
	expect(rows[1]?.values).toMatchObject({ width: 1, height: 1 });
	expect(
		await state<boolean>(
			page,
			"s.workspace.datasets[0].assets.every((a) => a.blob instanceof Blob && !('bytes' in a))",
		),
	).toBe(true);
	expect(
		await state<number>(page, "s.workspace.datasets[0].assets[0].orientation"),
	).toBe(6);
	// A photo dataset opens as a gallery, which shows thumbnails, not the
	// photos themselves; so does the table.
	const thumb = galleryCard(page, rows[0]?.id as string).locator("img");
	await expect(thumb).toBeVisible();
	expect(await thumb.getAttribute("src")).toMatch(/^blob:/);
	await expect(thumb).toHaveJSProperty("naturalWidth", 40);
	await page.getByRole("radio", { name: "Table" }).click();
	const img = cell(page, rows[0]?.id as string, "photo").locator("img");
	await expect(img).toBeVisible();
	expect(await img.getAttribute("src")).toMatch(/^blob:/);
	await expect(img).toHaveJSProperty("naturalWidth", 40);

	// Saved and opened again, the photos come back as Blobs with their bytes.
	const photoBytes = () =>
		page.evaluate(async () => {
			const c = (
				window as unknown as {
					__freshcoat: {
						controller: {
							state: {
								workspace: {
									datasets: { assets: { blob: Blob; sha256: string }[] }[];
								};
							};
						};
					};
				}
			).__freshcoat.controller;
			const assets = c.state.workspace.datasets[0]?.assets ?? [];
			return Promise.all(
				assets.map(async (a) => [
					a.sha256,
					(await a.blob.arrayBuffer()).byteLength,
				]),
			);
		});
	const before = await photoBytes();
	const download = page.waitForEvent("download");
	await page.keyboard.press(`${mod}+s`);
	const file = await download;
	await run(page, "c.close()");
	await page.getByTestId("open-file-input").setInputFiles({
		name: file.suggestedFilename(),
		mimeType: "application/zip",
		buffer: await readFile((await file.path()) as string),
	});
	await expect
		.poll(() => state<number>(page, "s.workspace?.datasets.length ?? 0"))
		.toBe(1);
	expect(await photoBytes()).toEqual(before);
	expect(
		await state<number>(page, "s.workspace.datasets[0].assets[0].orientation"),
	).toBe(6);
});

test("autosave keeps photos apart from the document and restores them", async ({
	page,
}) => {
	await openSample(page);
	await page.keyboard.press(`${mod}+2`);
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "From photos…" }).click();
	await (await chooser).setFiles([
		{ name: "ada.png", mimeType: "image/png", buffer: PNG },
	]);
	await expect
		.poll(() => state<number>(page, "s.workspace.datasets.length"))
		.toBe(1);
	const sha = await state<string>(
		page,
		"s.workspace.datasets[0].assets[0].sha256",
	);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					new Promise<unknown>((resolve) => {
						const req = indexedDB.open("freshcoat");
						req.onsuccess = () => {
							const db = req.result;
							if (!db.objectStoreNames.contains("assets")) {
								db.close();
								return resolve([]);
							}
							const keys = db
								.transaction("assets")
								.objectStore("assets")
								.getAllKeys();
							keys.onsuccess = () => {
								db.close();
								resolve(keys.result);
							};
						};
					}),
			),
		)
		.toEqual([sha]);
	await page.reload();
	await page.getByRole("button", { name: "Restore" }).click();
	await page.keyboard.press(`${mod}+2`);
	const id = await state<string>(page, "s.workspace.datasets[0].records[0].id");
	await expect(galleryCard(page, id).locator("img")).toBeVisible();
	expect(
		await state<number>(page, "s.workspace.datasets[0].assets[0].blob.size"),
	).toBe(PNG.length);
});

const PEOPLE = `{
	id: "d_people",
	name: "People",
	columns: [
		{ key: "name", type: "text", required: true },
		{ key: "tier", type: "text" },
		{ key: "points", type: "integer" },
	],
	records: [
		{ id: "r1", values: { name: "Ada", tier: "Gold", points: 120 }, status: "pending" },
		{ id: "r2", values: { name: "Grace", tier: "Silver", points: 95 }, status: "pending" },
		{ id: "r3", values: { name: "Alan", tier: "Gold" }, status: "pending" },
	],
	assets: [],
}`;

async function openPeople(page: Page) {
	await openSample(page);
	await run(page, `c.dispatch({ type: "datasetEdit", datasets: [${PEOPLE}] })`);
	await page.keyboard.press(`${mod}+2`);
	await expect(cell(page, "r1", "name")).toBeVisible();
}

const values = (page: Page, key: string) =>
	state<unknown[]>(
		page,
		`s.workspace.datasets[0].records.map((r) => r.values[${JSON.stringify(key)}] ?? null)`,
	);

/** Fires a clipboard event at the focused element and returns what a copy
 *  put on the clipboard. */
function clipboard(page: Page, type: "copy" | "paste", text = "") {
	return page.evaluate(
		({ type, text }) => {
			const data = new DataTransfer();
			if (text) data.setData("text/plain", text);
			const target = document.activeElement ?? document.body;
			target.dispatchEvent(
				new ClipboardEvent(type, {
					clipboardData: data,
					bubbles: true,
					cancelable: true,
				}),
			);
			return data.getData("text/plain");
		},
		{ type, text },
	);
}

test("cells copy and paste as tab-separated blocks, in one undo step", async ({
	page,
}) => {
	await openPeople(page);

	await cell(page, "r2", "tier").click();
	expect(await clipboard(page, "copy")).toBe("Silver");

	await page
		.locator('[role=row][data-row="r1"]')
		.getByRole("checkbox")
		.check({ force: true });
	await page
		.locator('[role=row][data-row="r2"]')
		.getByRole("checkbox")
		.check({ force: true });
	await cell(page, "r1", "name").click();
	expect(await clipboard(page, "copy")).toBe(
		"Ada\tGold\t120\nGrace\tSilver\t95",
	);
	await page.keyboard.press("Escape");

	// A block from a spreadsheet goes in from the focused cell, adding a
	// record past the last one; a value that does not parse is flagged.
	await cell(page, "r2", "tier").click();
	await clipboard(page, "paste", "Bronze\t7\r\nPlatinum\tlots\r\nNew\t3\r\n");
	await expect
		.poll(() => values(page, "tier"))
		.toEqual(["Gold", "Bronze", "Platinum", "New"]);
	expect(await values(page, "points")).toEqual([120, 7, "lots", 3]);
	await expect(page.getByTestId("data-status")).toContainText("4 records");
	await page.keyboard.press(`${mod}+z`);
	await expect
		.poll(() => values(page, "tier"))
		.toEqual(["Gold", "Silver", "Gold"]);
	expect(await values(page, "points")).toEqual([120, 95, null]);
});

test("Mod+D fills down from the first selected record", async ({ page }) => {
	await openPeople(page);
	for (const id of ["r1", "r3"])
		await page
			.locator(`[role=row][data-row="${id}"]`)
			.getByRole("checkbox")
			.check({ force: true });
	await cell(page, "r3", "points").click();
	await page.keyboard.press(`${mod}+d`);
	await expect.poll(() => values(page, "points")).toEqual([120, 95, 120]);

	// With one record or none selected, the value above fills the cell.
	await page.keyboard.press("Escape");
	await cell(page, "r2", "name").click();
	await page.keyboard.press(`${mod}+d`);
	await expect.poll(() => values(page, "name")).toEqual(["Ada", "Ada", "Alan"]);
	await page.keyboard.press(`${mod}+z`);
	await expect
		.poll(() => values(page, "name"))
		.toEqual(["Ada", "Grace", "Alan"]);
	expect(await values(page, "points")).toEqual([120, 95, 120]);
});

test("with several records selected the Record tab sets a value in all of them", async ({
	page,
}) => {
	await openPeople(page);
	for (const id of ["r1", "r3"])
		await page
			.locator(`[role=row][data-row="${id}"]`)
			.getByRole("checkbox")
			.check({ force: true });
	const bulk = page.getByTestId("bulk-panel");
	await expect(bulk).toContainText("Set value for 2 selected");
	await expect(bulk.getByLabel("tier", { exact: true })).toHaveValue("Gold");
	await expect(bulk.getByLabel("points", { exact: true })).toHaveAttribute(
		"placeholder",
		"Mixed",
	);
	await bulk.getByLabel("points", { exact: true }).fill("10");
	await page.keyboard.press("Enter");
	await expect.poll(() => values(page, "points")).toEqual([10, 95, 10]);
	await bulk.getByLabel("tier", { exact: true }).fill("");
	await bulk.getByRole("button", { name: "Set tier" }).click();
	await expect.poll(() => values(page, "tier")).toEqual([null, "Silver", null]);
	await page.keyboard.press(`${mod}+z`);
	await expect
		.poll(() => values(page, "tier"))
		.toEqual(["Gold", "Silver", "Gold"]);
	expect(await values(page, "points")).toEqual([10, 95, 10]);
});

test("find and replace counts matches and replaces them in one undo step", async ({
	page,
}) => {
	await openPeople(page);
	await cell(page, "r1", "name").click();
	await page.keyboard.press(`${mod}+f`);
	const popover = page.getByTestId("find-replace-popover");
	const find = popover.getByRole("textbox", { name: "Find" });
	await expect(find).toBeFocused();
	await find.fill("gold");
	await expect(page.getByTestId("find-replace-count")).toHaveText(
		"2 matches in 2 records",
	);
	await popover.getByRole("checkbox", { name: "Match case" }).click({
		force: true,
	});
	await expect(page.getByTestId("find-replace-count")).toHaveText("No matches");
	await popover.getByRole("checkbox", { name: "Match case" }).click({
		force: true,
	});

	await page.keyboard.press(`${mod}+h`);
	const replace = popover.getByRole("textbox", { name: "Replace" });
	await expect(replace).toBeFocused();
	await replace.fill("Platinum");
	await popover.getByRole("button", { name: "Replace all" }).click();
	await expect
		.poll(() => values(page, "tier"))
		.toEqual(["Platinum", "Silver", "Platinum"]);
	await expect(page.getByTestId("find-replace-count")).toHaveText("No matches");

	// Limited to one column.
	await find.fill("a");
	await expect(page.getByTestId("find-replace-count")).toHaveText(
		"7 matches in 3 records",
	);
	await popover.getByRole("button", { name: /All columns/ }).click();
	await page.getByRole("option", { name: "name" }).click();
	await expect(page.getByTestId("find-replace-count")).toHaveText(
		"5 matches in 3 records",
	);
	await page.keyboard.press("Escape");
	await expect(popover).toBeHidden();
	await page.keyboard.press(`${mod}+z`);
	await expect
		.poll(() => values(page, "tier"))
		.toEqual(["Gold", "Silver", "Gold"]);
});

test("column filter chips narrow the records beside the status filter", async ({
	page,
}) => {
	await openPeople(page);
	await page.getByTestId("add-column-filter").click();
	const popover = page.getByTestId("column-filter-popover");
	await popover.getByRole("button", { name: /Column/ }).click();
	await page.getByRole("option", { name: "tier" }).click();
	await popover.getByRole("textbox", { name: "Value" }).fill("gold");
	await page.keyboard.press("Enter");
	await expect(popover).toBeHidden();
	await expect(page.getByTestId("column-filter")).toHaveText(
		"tier contains gold",
	);
	await expect.poll(() => columnTexts(page, "name")).toEqual(["Ada", "Alan"]);
	await expect(page.getByTestId("data-status-records")).toHaveText(
		"2 of 3 records",
	);

	await page.getByTestId("add-column-filter").click();
	await popover.getByRole("button", { name: /Column/ }).click();
	await page.getByRole("option", { name: "points" }).click();
	await popover.getByRole("button", { name: /Test/ }).click();
	await page.getByRole("option", { name: "is empty" }).click();
	await page.keyboard.press("Escape");
	await expect.poll(() => columnTexts(page, "name")).toEqual(["Alan"]);

	await page
		.getByRole("button", { name: "Remove filter tier contains gold" })
		.click();
	await page
		.getByRole("button", { name: "Remove filter points is empty" })
		.click();
	await expect.poll(() => columnTexts(page, "name")).toHaveLength(3);
});
