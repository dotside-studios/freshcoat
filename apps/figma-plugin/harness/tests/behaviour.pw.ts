import { expect, test } from "@playwright/test";
import { openState, sentOfType, status } from "./harness";

test.describe("tabs", () => {
	test("move by arrow keys, Home and End, and remember the tab", async ({
		page,
	}) => {
		const ui = await openState(page, "layer-empty");
		const layer = ui.getByRole("tab", { name: "Layer" });
		await expect(layer).toHaveAttribute("aria-selected", "true");
		await expect(ui.getByRole("tab", { name: "Fields" })).toHaveAttribute(
			"tabindex",
			"-1",
		);

		await layer.focus();
		await layer.press("ArrowRight");
		const fields = ui.getByRole("tab", { name: "Fields" });
		await expect(fields).toBeFocused();
		await expect(fields).toHaveAttribute("aria-selected", "true");
		await expect(ui.getByRole("tabpanel")).toHaveAttribute(
			"aria-labelledby",
			"tab-fields",
		);

		await fields.press("End");
		await expect(ui.getByRole("tab", { name: "Settings" })).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(layer).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(ui.getByRole("tab", { name: "Settings" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await page.keyboard.press("Home");
		await expect(layer).toHaveAttribute("aria-selected", "true");

		const tabs = async () =>
			(await sentOfType(page, "save-settings"))
				.map((s) => s.settings.tab)
				.filter((t) => t !== undefined);
		await expect
			.poll(tabs)
			.toEqual(["fields", "settings", "layer", "settings", "layer"]);
	});

	test("opens on the stored tab", async ({ page }) => {
		const ui = await openState(page, "fields");
		await expect(ui.getByRole("tab", { name: "Fields" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});
});

test.describe("layer", () => {
	test("unbind asks first, and Escape or Cancel keeps the binding", async ({
		page,
	}) => {
		const ui = await openState(page, "layer-bound-single");
		await ui.getByRole("button", { name: "Unbind" }).click();
		const confirm = ui.getByRole("alertdialog", { name: "Unbind member_id?" });
		await expect(confirm).toBeVisible();
		await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(confirm).toBeHidden();
		await ui.getByRole("button", { name: "Unbind" }).click();
		await confirm.getByRole("button", { name: "Cancel" }).click();
		await expect(confirm).toBeHidden();
		expect(await sentOfType(page, "clear-binding")).toHaveLength(0);

		await ui.getByRole("button", { name: "Unbind" }).click();
		await confirm.getByRole("button", { name: "Unbind" }).click();
		await expect(status(ui)).toHaveText("Unbound");
		const cleared = await sentOfType(page, "clear-binding");
		expect(cleared).toEqual([
			{ type: "clear-binding", nodeId: "10:4", removedIds: ["member_id"] },
		]);
		await expect(status(ui)).toHaveText("Unbound");
		await expect(ui.getByRole("group", { name: "Bind as" })).toBeVisible();
	});

	test("one of several properties unbinds on its own", async ({ page }) => {
		const ui = await openState(page, "layer-bound");
		await ui.getByRole("button", { name: "Unbind text color" }).click();
		await ui
			.getByRole("alertdialog", { name: "Unbind text color?" })
			.getByRole("button", { name: "Unbind" })
			.click();
		await expect(status(ui)).toHaveText("Unbound text color");
		const [set] = await sentOfType(page, "set-binding");
		expect(set.bind).toEqual({ text: "{{display_name}}" });
		expect(set.removedIds).toEqual(["ink"]);
		expect(set.fields.map((f) => f.id)).toEqual(["display_name"]);
		await expect(status(ui)).toHaveText("Unbound text color");
	});

	test("Apply is enabled by a change and confirms", async ({ page }) => {
		const ui = await openState(page, "layer-bound-single");
		const apply = ui.getByRole("button", { name: "Apply" });
		await expect(apply).toBeDisabled();
		await ui.getByLabel("Label").fill("Member number");
		await expect(apply).toBeEnabled();
		await apply.click();
		await expect(
			ui.getByRole("tabpanel").getByText("Applied", { exact: true }),
		).toBeVisible();
		await expect(status(ui)).toHaveText("Applied");
		const [set] = await sentOfType(page, "set-binding");
		expect(set.fields[0].title).toBe("Member number");
	});

	test("an unbound layer offers each kind as a button", async ({ page }) => {
		const ui = await openState(page, "layer-unbound");
		const choices = ui
			.getByRole("group", { name: "Bind as" })
			.getByRole("button");
		await expect(choices).toHaveText([
			/Image/,
			/QR code/,
			/Barcode/,
			/Fill color/,
			/Show when…/,
		]);
		await ui.getByRole("button", { name: /Barcode/ }).click();
		await expect(status(ui)).toHaveText("Bound as barcode");
		const [set] = await sentOfType(page, "set-binding");
		expect(set.setName).toBe("barcode:{{badge}}");
	});
});

test("a barcode's symbology is picked and written to its name", async ({
	page,
}) => {
	const ui = await openState(page, "layer-barcode");
	const apply = ui.getByRole("button", { name: "Apply" });
	await expect(apply).toBeDisabled();
	// The UI kit's dropdown is a focusable div with a menu of plain items.
	await ui
		.getByRole("group", { name: "Symbology" })
		.getByText("EAN-13")
		.click();
	await ui.getByText("Code 39", { exact: true }).click();
	await apply.click();
	await expect(status(ui)).toHaveText("Applied");
	const [set] = await sentOfType(page, "set-binding");
	expect(set.setName).toBe("barcode:code39:{{sku}}");
});

test.describe("fields", () => {
	test("Detect fields fills the list and says how many", async ({ page }) => {
		const ui = await openState(page, "fields-empty");
		await expect(ui.getByText("No fields")).toBeVisible();
		await ui.getByRole("button", { name: "Detect fields" }).click();
		await expect(status(ui)).toHaveText("Detected 5 fields");
		const [harvest] = await sentOfType(page, "harvest");
		expect(harvest.cardId).toBe("10:1");
		await ui.getByRole("button", { name: /member_id/ }).click();
		await expect
			.poll(async () => (await sentOfType(page, "focus-node")).at(-1)?.nodeId)
			.toBe("10:4");
	});
});

test.describe("export steps", () => {
	test("done steps collapse to a summary and reopen one at a time", async ({
		page,
	}) => {
		const ui = await openState(page, "export");
		const frames = ui.getByRole("button", { name: "Frames, done" });
		const details = ui.getByRole("button", { name: "Details, done" });
		await expect(frames).toHaveAttribute("aria-expanded", "false");
		await expect(frames).toHaveAccessibleDescription("Member card");
		await expect(details).toHaveAccessibleDescription("Member card · 5 fields");

		await frames.click();
		await expect(frames).toHaveAttribute("aria-expanded", "true");
		await expect(ui.getByRole("group", { name: "Frame" })).toBeVisible();

		await details.click();
		await expect(frames).toHaveAttribute("aria-expanded", "false");
		await expect(details).toHaveAttribute("aria-expanded", "true");
		await ui.getByRole("button", { name: "Continue" }).click();
		await expect(details).toHaveAttribute("aria-expanded", "false");
	});

	test("an unfinished step opens by itself", async ({ page }) => {
		const ui = await openState(page, "export-start");
		const frames = ui.getByRole("button", { name: "Frames" });
		await expect(frames).toHaveAttribute("aria-expanded", "true");
		await expect(ui.getByText("Pick a frame in step 2")).toBeVisible();
		await expect(
			ui.getByRole("button", { name: "Export .coat" }),
		).toBeDisabled();
	});

	test("an export downloads, shows the result and its warnings", async ({
		page,
	}) => {
		const ui = await openState(page, "export");
		const download = page.waitForEvent("download");
		await ui.getByRole("button", { name: "Export .coat" }).click();
		expect((await download).suggestedFilename()).toBe(
			"custom-member-card.coat",
		);
		await expect(ui.getByText("Download again")).toBeVisible();
		await expect(
			ui.getByText(/^1017×639 · 1 side · 5 fields · \d+ KB$/),
		).toBeVisible();
		await expect(status(ui)).toHaveText("Exported custom-member-card.coat");
		const warnings = ui.getByRole("region", { name: /warnings/ });
		await expect(warnings).toBeVisible();
		await expect(warnings.getByRole("button")).toHaveCount(3);
		await warnings.getByRole("button", { name: /Sparkle$/ }).click();
		await expect
			.poll(async () => (await sentOfType(page, "focus-node")).at(-1)?.nodeId)
			.toBe("10:7");
	});

	test("Open in Freshcoat without an address goes to Settings", async ({
		page,
	}) => {
		const ui = await openState(page, "export");
		await ui.getByRole("button", { name: "Open in Freshcoat" }).click();
		await expect(ui.getByRole("tab", { name: "Settings" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(ui.getByLabel("Address")).toBeFocused();
		expect(await sentOfType(page, "request-read")).toHaveLength(0);
	});

	test("Open in Freshcoat hands the template over in a link", async ({
		page,
	}) => {
		const ui = await openState(page, "export");
		await page.evaluate(() =>
			window.harness.send({
				type: "settings",
				settings: {
					...window.harness.settings,
					freshcoatUrl: "https://freshcoat.example",
				},
			}),
		);
		await ui.getByRole("button", { name: "Open in Freshcoat" }).click();
		await expect(status(ui)).toHaveText("Opened in Freshcoat");
		const [open] = await sentOfType(page, "open-external");
		expect(open.url).toMatch(/^https:\/\/freshcoat\.example\/edit#coat=/);
		await expect(ui.getByText("Download .coat")).toBeVisible();
	});

	test("wrong-size sides reopen Frames with a Resize each", async ({
		page,
	}) => {
		const ui = await openState(page, "export-davi");
		await ui.getByRole("button", { name: "Export .coat" }).click();
		await expect(status(ui)).toHaveText("2 frames are the wrong size");
		const frames = ui.getByRole("region", { name: "Frames" });
		await expect(frames.getByRole("button", { name: "Resize" })).toHaveCount(2);
		await frames.getByRole("button", { name: "Resize" }).first().click();
		await expect(status(ui)).toHaveText(/^Resized/);
		const [resize] = await sentOfType(page, "resize-node");
		expect(resize.width).toBe(1012);
	});

	test("a barcode placeholder stops the export until accepted", async ({
		page,
	}) => {
		const ui = await openState(page, "export-blocked");
		await ui.getByRole("button", { name: "Export .coat" }).click();
		const errors = ui.getByRole("region", { name: "1 error" });
		await expect(errors).toContainText("barcode:ean13:12345");
		const download = page.waitForEvent("download");
		await ui.getByRole("button", { name: "Export anyway" }).click();
		expect((await download).suggestedFilename()).toBe(
			"custom-member-card.coat",
		);
		await expect(ui.getByText("Download again")).toBeVisible();
	});

	test("a failed read says so", async ({ page }) => {
		const ui = await openState(page, "export-fail");
		await ui.getByRole("button", { name: "Export .coat" }).click();
		await expect(ui.getByText(/Couldn't export/)).toBeVisible();
		await expect(status(ui)).toHaveText("Couldn't read the frames");
	});
});

test.describe("settings", () => {
	test("checks the address and saves a good one", async ({ page }) => {
		const ui = await openState(page, "settings-empty");
		const address = ui.getByLabel("Address");
		await address.fill("http://freshcoat.example");
		await expect(ui.getByText("Use an https address")).toBeVisible();
		await address.fill("https://freshcoat.example");
		await address.press("Enter");
		await expect(status(ui)).toHaveText("Address saved");
		// Other saves (the Export tab seeding a product) land when they will,
		// so look for the address's own.
		const addresses = async () =>
			(await sentOfType(page, "save-settings"))
				.map((s) => s.settings)
				.filter((s) => "freshcoatUrl" in s);
		await expect
			.poll(addresses)
			.toEqual([{ freshcoatUrl: "https://freshcoat.example" }]);
	});

	test("stored settings that land again keep what the panel changed", async ({
		page,
	}) => {
		const ui = await openState(page, "settings-empty");
		const products = async () =>
			(await sentOfType(page, "save-settings")).filter(
				(s) => "productSku" in s.settings,
			);
		await expect.poll(async () => (await products()).length).toBe(1);
		await ui.getByLabel("Address").fill("https://freshcoat.example");
		await ui.getByLabel("Address").press("Enter");
		await expect(status(ui)).toHaveText("Address saved");
		// Main's startup copy, from before either change reached it.
		await page.evaluate(() =>
			window.harness.send({
				type: "settings",
				settings: {
					windowWidth: 320,
					windowHeight: 480,
					tab: "settings",
					daviMode: false,
					productSku: "",
					freshcoatUrl: "",
					showDiagnostics: false,
				},
			}),
		);
		await ui.getByLabel("Address").press("Enter");
		await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
		// Neither is sent again: the panel still has both.
		expect(await products()).toHaveLength(1);
		expect(
			(await sentOfType(page, "save-settings")).filter(
				(s) => "freshcoatUrl" in s.settings,
			),
		).toHaveLength(1);
	});
});
