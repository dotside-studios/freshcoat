import { expect, test } from "@playwright/test";
import { openSample, pixel, probePath, run, settle, state } from "./helpers";

test("stepping records in Edit repaints the card with each record", async ({
	page,
}) => {
	await openSample(page);
	await page.evaluate(async (path) => {
		const { bindSampleRecords } = await import(/* @vite-ignore */ path);
		bindSampleRecords(["A", "WWWWWWWWWWWW", "i"]);
	}, probePath("record-probe"));
	await settle(page);
	const stepper = page.getByTestId("record-stepper");
	await expect(stepper).toBeVisible();

	// The name sits around (64..724, 396..466); sample a stripe across it.
	const stripe = async () => {
		const out: number[] = [];
		for (let x = 70; x < 720; x += 25) out.push(...(await pixel(page, x, 430)));
		return out;
	};
	const samples = await stripe();
	await page.getByRole("button", { name: "Next record" }).click();
	await settle(page);
	expect(await state<string | null>(page, "s.previewRecordId")).toBe("r_0");
	expect(await state<string>(page, "s.values.display_name")).toBe("A");
	const first = await stripe();
	expect(first).not.toEqual(samples);

	await page.getByRole("button", { name: "Next record" }).click();
	await settle(page);
	expect(await state<string>(page, "s.values.display_name")).toBe(
		"WWWWWWWWWWWW",
	);
	expect(await stripe()).not.toEqual(first);

	await page.getByRole("button", { name: "Samples", exact: true }).click();
	await settle(page);
	expect(await state<string | null>(page, "s.previewRecordId")).toBeNull();
});

test("a record's photo paints on the Edit canvas at preview resolution", async ({
	page,
}) => {
	await openSample(page);
	const ids = await page.evaluate(async (path) => {
		// Larger than the preview edge, so it is scaled in the worker first.
		const photo = async (fill: string) => {
			const c = new OffscreenCanvas(3000, 2000);
			const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
			g.fillStyle = fill;
			g.fillRect(0, 0, 3000, 2000);
			return c.convertToBlob({ type: "image/jpeg" });
		};
		const { bindPhotoRecords } = await import(/* @vite-ignore */ path);
		return bindPhotoRecords([await photo("#0000ff"), await photo("#00ff00")]);
	}, probePath("record-probe"));
	await settle(page);
	await page.evaluate((id) => {
		const c = (
			window as unknown as {
				__freshcoat: { controller: { previewRecord(id: string): void } };
			}
		).__freshcoat.controller;
		c.previewRecord(id);
	}, ids[0]);
	// Settling waits for the photo to be scaled in the worker and painted,
	// however long that takes on a loaded machine.
	await settle(page);
	const isBlue = ([r, g, b]: number[]) =>
		(r as number) < 30 && (g as number) < 30 && (b as number) > 225;
	expect(isBlue(await pixel(page, 200, 150))).toBe(true);
	expect(await state<string[]>(page, "s.render.warnings")).toEqual([]);
});

test("an unbound template picks a dataset to try in Edit", async ({ page }) => {
	await openSample(page);
	await run(
		page,
		`c.dispatch({ type: "datasetEdit", datasets: [{
			id: "d_m",
			name: "Members",
			columns: [{ key: "Display Name", type: "text" }],
			records: [{ id: "r_0", values: { "Display Name": "Grace" }, status: "pending" }],
			assets: [],
		}] });
		c.dispatch({ type: "setRightTab", tab: "content" });`,
	);
	await expect(page.getByTestId("record-stepper")).toBeHidden();
	await page.getByRole("button", { name: /Dataset to try/ }).click();
	await page.getByRole("option", { name: "Members", exact: true }).click();
	await expect(page.getByTestId("record-stepper")).toBeVisible();
	expect(
		await state<unknown>(
			page,
			"s.workspace.templates[0].binding.fields.display_name",
		),
	).toEqual({ kind: "column", column: "Display Name" });

	await expect(page.getByTestId("binding-editor")).toBeHidden();
	await page.getByRole("button", { name: "Binding", exact: true }).click();
	await expect(page.getByTestId("binding-editor")).toBeVisible();

	await page.getByRole("button", { name: "Next record" }).click();
	await settle(page);
	expect(await state<string>(page, "s.values.display_name")).toBe("Grace");
});
