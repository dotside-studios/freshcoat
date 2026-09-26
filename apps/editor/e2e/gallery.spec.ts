import { expect, type Page, test } from "@playwright/test";
import { mod, openSample, state } from "./helpers";

type Rec = { id: string; values: Record<string, unknown> };

/** JPEGs of four sizes from the page's own encoder, each a different hue. */
async function makeJpegs(page: Page, count: number) {
	const files = await page.evaluate(async (n) => {
		const sizes = [
			[320, 240],
			[240, 320],
			[300, 300],
			[400, 200],
		] as const;
		const out: { name: string; bytes: number[] }[] = [];
		for (let i = 0; i < n; i++) {
			const [w, h] = sizes[i % sizes.length] as readonly [number, number];
			const c = new OffscreenCanvas(w, h);
			const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
			g.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`;
			g.fillRect(0, 0, w, h);
			g.fillStyle = "#fff";
			g.fillRect(w / 4, h / 4, w / 2, h / 2);
			const blob = await c.convertToBlob({ type: "image/jpeg" });
			out.push({
				name: `IMG_${String(i + 1).padStart(3, "0")}.jpg`,
				bytes: [...new Uint8Array(await blob.arrayBuffer())],
			});
		}
		return out;
	}, count);
	return files.map((f) => ({
		name: f.name,
		mimeType: "image/jpeg",
		buffer: Buffer.from(f.bytes),
	}));
}

async function photoDataset(page: Page, count: number) {
	await openSample(page);
	await page.keyboard.press(`${mod}+2`);
	const files = await makeJpegs(page, count);
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "From photos…" }).click();
	await (await chooser).setFiles(files);
	await expect
		.poll(() => state<number>(page, "s.workspace?.datasets[0]?.records.length"))
		.toBe(count);
	return state<Rec[]>(page, "s.workspace.datasets[0].records");
}

const card = (page: Page, id: string) =>
	page.locator(`[data-testid=records-gallery] [role=row][data-row="${id}"]`);

const selectedCount = (page: Page, view: "gallery" | "grid") =>
	page
		.locator(
			`[data-testid=records-${view}] [role=row][data-row][aria-selected=true]`,
		)
		.count();

test("a photo dataset opens as a gallery; ranges select, a record opens and its fields edit", async ({
	page,
}) => {
	const recs = await photoDataset(page, 24);
	const ids = recs.map((r) => r.id);
	const gallery = page.getByTestId("records-gallery");
	await expect(gallery).toBeVisible();
	await expect(page.getByRole("radio", { name: "Gallery" })).toBeChecked();
	const firstThumb = card(page, ids[0] as string).locator("img");
	await expect(firstThumb).toBeVisible();
	expect(await firstThumb.getAttribute("src")).toMatch(/^blob:/);
	await expect(card(page, ids[0] as string)).toContainText("IMG_001.jpg");
	await expect(card(page, ids[0] as string)).toContainText("320 × 240");
	await expect(page.getByTestId("data-status-photos")).toContainText(
		"24 photos",
	);

	// Click, Shift-click a range, Mod-click one more.
	await card(page, ids[1] as string).click();
	await card(page, ids[5] as string).click({ modifiers: ["Shift"] });
	await expect(page.getByTestId("data-status-selected")).toHaveText(
		"5 selected",
	);
	await card(page, ids[8] as string).click({ modifiers: [mod] });
	await expect(page.getByTestId("data-status-selected")).toHaveText(
		"6 selected",
	);
	expect(await selectedCount(page, "gallery")).toBe(6);

	// The table shares the selection.
	await page.getByRole("radio", { name: "Table" }).click();
	await expect(page.getByTestId("records-grid")).toBeVisible();
	await expect.poll(() => selectedCount(page, "grid")).toBe(6);
	await page.getByRole("radio", { name: "Gallery" }).click();
	await expect.poll(() => selectedCount(page, "gallery")).toBe(6);

	await card(page, ids[0] as string).click();
	await page.keyboard.press(`${mod}+a`);
	await expect(page.getByTestId("data-status-selected")).toHaveText(
		"24 selected",
	);

	// A double-click opens the record in the Record tab.
	await card(page, ids[3] as string).dblclick();
	await expect(page.getByRole("tab", { name: "Record" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const panel = page.getByTestId("record-panel");
	await expect(panel).toHaveAttribute("data-record", ids[3] as string);
	await expect(panel.getByTestId("record-photo").locator("img")).toBeVisible();
	await expect(panel.getByTestId("record-photo-info")).toContainText(
		"400 × 200",
	);
	await expect(panel.getByTestId("record-photo-info")).toContainText("JPEG");

	// Editing a field there edits the record, and the card follows.
	const name = panel.getByLabel(/^file_name/);
	await expect(name).toHaveValue("IMG_004.jpg");
	await name.fill("cover.jpg");
	await name.press("Enter");
	await expect
		.poll(() =>
			state<unknown>(
				page,
				"s.workspace.datasets[0].records[3].values.file_name",
			),
		)
		.toBe("cover.jpg");
	await expect(card(page, ids[3] as string)).toContainText("cover.jpg");

	// Enter on a focused card opens it too.
	await card(page, ids[6] as string).click();
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Enter");
	await expect(panel).toHaveAttribute("data-record", ids[7] as string);

	// The view chosen is kept for the dataset while the session lasts.
	await page.getByRole("radio", { name: "Table" }).click();
	await page.keyboard.press(`${mod}+1`);
	await page.keyboard.press(`${mod}+2`);
	await expect(page.getByTestId("records-grid")).toBeVisible();
});

test("the Columns tab stays put while records take the focus", async ({
	page,
}) => {
	const recs = await photoDataset(page, 6);
	await page.getByRole("tab", { name: "Columns" }).click();
	await card(page, recs[2]?.id as string).click();
	await expect(page.getByTestId("columns-panel")).toBeVisible();
	await card(page, recs[2]?.id as string).dblclick();
	await expect(page.getByTestId("record-panel")).toHaveAttribute(
		"data-record",
		recs[2]?.id as string,
	);
});

test("an empty dataset takes a dropped spreadsheet, and no dataset takes dropped photos", async ({
	page,
}) => {
	await openSample(page);
	await page.keyboard.press(`${mod}+2`);
	const drop = (
		testId: string,
		files: { name: string; type: string; text?: string; image?: boolean }[],
	) =>
		page.evaluate(
			async ({ testId, files }) => {
				const dt = new DataTransfer();
				for (const f of files) {
					let blob: Blob;
					if (f.image) {
						const c = new OffscreenCanvas(30, 20);
						const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
						g.fillStyle = f.name.startsWith("a") ? "#39c" : "#c93";
						g.fillRect(0, 0, 30, 20);
						blob = await c.convertToBlob({ type: "image/jpeg" });
					} else blob = new Blob([f.text ?? ""], { type: f.type });
					dt.items.add(new File([blob], f.name, { type: f.type }));
				}
				const el = document.querySelector(
					`[data-testid=${testId}]`,
				) as HTMLElement;
				for (const type of ["dragenter", "dragover", "drop"])
					el.dispatchEvent(
						new DragEvent(type, {
							dataTransfer: dt,
							bubbles: true,
							cancelable: true,
						}),
					);
			},
			{ testId, files },
		);

	await expect(page.getByTestId("data-drop-zone")).toBeVisible();
	await drop("data-drop-zone", [
		{ name: "a.jpg", type: "image/jpeg", image: true },
		{ name: "b.jpg", type: "image/jpeg", image: true },
	]);
	await expect
		.poll(() => state<number>(page, "s.workspace?.datasets[0]?.records.length"))
		.toBe(2);
	await expect(page.getByTestId("records-gallery")).toBeVisible();

	// A dataset with no records offers the same drop.
	await page.evaluate(() => {
		const c = (
			window as unknown as {
				__freshcoat: {
					controller: {
						state: { workspace: { datasets: unknown[] } };
						dispatch(a: unknown): void;
					};
				};
			}
		).__freshcoat.controller;
		const all = c.state.workspace.datasets;
		c.dispatch({
			type: "datasetEdit",
			datasets: [
				...all,
				{
					id: "d_people",
					name: "People",
					columns: [{ key: "name", type: "text" }],
					records: [],
					assets: [],
				},
			],
			activeId: "d_people",
		});
	});
	await expect(page.getByTestId("dataset-drop-zone")).toBeVisible();
	await drop("dataset-drop-zone", [
		{ name: "people.csv", type: "text/csv", text: "name\nAda\nGrace\n" },
	]);
	const wizard = page.getByTestId("import-wizard");
	await expect(wizard).toContainText("people.csv · 2 records");
});

test("on a tablet the data group folds into More and the inspector is a sheet", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1024, height: 768 });
	const recs = await photoDataset(page, 8);
	await expect(page.getByTestId("data-more")).toBeVisible();
	await expect(page.getByTestId("import-records")).toHaveCount(0);
	await expect(page.getByTestId("data-panel-right")).toHaveCount(0);
	await page.getByTestId("data-more").click();
	await expect(page.getByRole("menuitem", { name: "Import…" })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Download" })).toBeVisible();
	await page.keyboard.press("Escape");

	await card(page, recs[1]?.id as string).dblclick();
	const sheet = page.getByTestId("data-panel-right");
	await expect(sheet).toBeVisible();
	await expect(sheet.getByTestId("record-panel")).toHaveAttribute(
		"data-record",
		recs[1]?.id as string,
	);
	await sheet.getByRole("button", { name: "Next record" }).focus();
	await page.keyboard.press("Escape");
	await expect(sheet).toHaveCount(0);
});

test("at 820 px the gallery has two columns", async ({ page }) => {
	await page.setViewportSize({ width: 820, height: 1180 });
	const recs = await photoDataset(page, 6);
	const xs = new Set<number>();
	for (const r of recs.slice(0, 4)) {
		const box = await card(page, r.id).boundingBox();
		if (box) xs.add(Math.round(box.x));
	}
	expect(xs.size).toBe(2);
});
