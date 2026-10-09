import { expect, type Page, test } from "@playwright/test";
import { openSample, settle, state } from "./helpers";

/** The key of a top-level layer on the front, by id. */
const frontKey = (page: Page, id: string) =>
	state<string>(
		page,
		`"0/" + c.base.template_data[0].elements.findIndex((e) => e.id === "${id}")`,
	);

/** The active variant's change to a front layer. */
const delta = (page: Page, id: string) =>
	state<Record<string, unknown> | null>(
		page,
		`c.base.variants.find((v) => v.id === s.variantId)?.overrides
			.find((o) => o.name === "front")?.elements
			?.find((d) => d.id === "${id}") ?? null`,
	);

const baseLayer = (page: Page, id: string) =>
	state<{ pos: { x: number; y: number }; properties: Record<string, unknown> }>(
		page,
		`c.base.template_data[0].elements.find((e) => e.id === "${id}")`,
	);

test("author a variant: recolor, move, reset, hide, delete", async ({
	page,
}) => {
	await openSample(page, "membership-card");
	const before = {
		name: await baseLayer(page, "name"),
		since: await baseLayer(page, "since"),
	};

	// Create it: selected, and its label open for renaming.
	const panel = page.getByRole("region", { name: "Variants" });
	await panel.getByRole("button", { name: "Add variant" }).click();
	const rename = panel.getByRole("textbox", { name: "Rename Variant 2" });
	await expect(rename).toBeFocused();
	await page.keyboard.type("Gold");
	await page.keyboard.press("Enter");
	expect(await state<string>(page, "s.variantId")).toBe("variant-2");
	await expect(page.getByTestId("variant-bar")).toContainText("Editing Gold");
	await expect(page.getByTestId("status-variant")).toHaveText("Gold");

	// Recolor the name.
	const nameKey = await frontKey(page, "name");
	await page.evaluate(
		(k) =>
			(
				window as unknown as {
					__freshcoat: { controller: { select(k: string[]): void } };
				}
			).__freshcoat.controller.select([k]),
		nameKey,
	);
	await page.getByRole("tab", { name: "Design" }).click();
	const inspector = page.getByTestId("design-inspector");
	const color = inspector.getByRole("textbox", { name: "Fill 1 color" });
	await color.fill("#ff0000");
	await color.press("Enter");
	await settle(page);
	expect(await delta(page, "name")).toMatchObject({
		properties: { color: "#ff0000" },
	});

	// Move "since".
	await page
		.getByRole("treegrid", { name: "Layers" })
		.getByText("since", { exact: true })
		.click();
	expect(await state<string[]>(page, "s.selection")).toEqual([
		await frontKey(page, "since"),
	]);
	const x = inspector.getByRole("spinbutton", { name: "X", exact: true });
	await x.fill("300");
	await x.press("Enter");
	await settle(page);
	expect((await delta(page, "since"))?.pos).toMatchObject({ x: 300 });
	await expect(page.getByTestId("variant-bar")).toContainText(
		"2 layers changed",
	);

	// Default is unchanged.
	expect(await baseLayer(page, "name")).toEqual(before.name);
	expect(await baseLayer(page, "since")).toEqual(before.since);
	await page.getByRole("button", { name: "Back to Default" }).click();
	await expect(page.getByTestId("variant-bar")).toHaveCount(0);
	await expect(x).toHaveValue(String(before.since.pos.x));
	await expect(inspector.getByTestId("override-marker")).toHaveCount(0);

	// Reset the move from its marker.
	await page.getByTestId("variant-variant-2").click();
	await expect(x).toHaveValue("300");
	await inspector
		.getByRole("button", { name: "Changed in Gold" })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Reset to Default" }).click();
	await expect(x).toHaveValue(String(before.since.pos.x));
	expect(await delta(page, "since")).toBeNull();
	expect(await delta(page, "name")).not.toBeNull();

	// Hide the logo in Gold only.
	const logo = page
		.getByRole("treegrid", { name: "Layers" })
		.getByText("logo", { exact: true });
	await logo.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Hide in Gold" }).click();
	expect(await delta(page, "logo")).toMatchObject({ hidden: true });
	await expect(
		page.getByRole("img", { name: "Hidden in Gold" }).first(),
	).toBeVisible();

	// Delete the variant.
	await page.getByTestId("variant-variant-2").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Delete" }).click();
	const alert = page.getByRole("alertdialog");
	await expect(alert).toContainText("Delete Gold?");
	await expect(alert).toContainText("Its changes to 2 layers are removed.");
	await alert.getByRole("button", { name: "Delete" }).click();
	expect(
		await state<string[]>(page, "c.base.variants.map((v) => v.id)"),
	).toEqual(["midnight"]);
	expect(await state<unknown>(page, "s.variantId ?? null")).toBeNull();
	await expect(page.getByTestId("variant-bar")).toHaveCount(0);
});

test("the variants list is a listbox with a keyboard menu", async ({
	page,
}) => {
	await openSample(page, "membership-card");
	const list = page.getByRole("listbox", { name: "Variants" });
	await page.getByTestId("variant-__default").click();
	await page.keyboard.press("ArrowDown");
	expect(await state<string>(page, "s.variantId")).toBe("midnight");
	await page.keyboard.press("Shift+F10");
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(menu).toHaveCount(0);
	await expect(list.getByRole("option", { selected: true })).toHaveText(
		/Midnight/,
	);
});

test("a template with no variants offers one; a section's toggle is remembered", async ({
	page,
}) => {
	await openSample(page, "membership-card");
	await page
		.getByRole("region", { name: "Templates" })
		.getByRole("button", { name: "Add template" })
		.click();
	await page.getByRole("menuitem").first().click();
	await settle(page);

	const variants = page.getByRole("region", { name: "Variants" });
	const variantsToggle = variants
		.getByRole("heading")
		.getByRole("button", { name: "Variants" });
	await expect(variantsToggle).toHaveAttribute("aria-expanded", "false");
	await variantsToggle.click();
	await expect(variants.getByRole("option")).toHaveText(["Default"]);
	await variants
		.getByRole("button", {
			name: "Add a variant, such as a colorway or a staff version",
		})
		.click();
	await expect(
		variants.getByRole("textbox", { name: "Rename Variant 1" }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	expect(await state<string>(page, "s.variantId")).toBe("variant-1");
	await expect(variants.getByRole("option")).toHaveCount(2);

	const sides = page
		.getByRole("region", { name: "Sides" })
		.getByRole("heading")
		.getByRole("button", { name: "Sides" });
	await sides.click();
	await expect(sides).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByRole("listbox", { name: "Sides" })).toBeHidden();

	await openSample(page, "membership-card");
	await expect(sides).toHaveAttribute("aria-expanded", "false");
	await sides.click();
	await expect(page.getByRole("listbox", { name: "Sides" })).toBeVisible();
});

test("sides and variants switch with the panels closed", async ({ page }) => {
	await openSample(page, "membership-card");
	await page.keyboard.press("ControlOrMeta+Backslash");
	await expect(page.getByTestId("panel-left")).toHaveCount(0);
	const sides = await state<string[]>(
		page,
		"c.base.template_data.map((f) => f.name)",
	);

	await page.locator("[data-canvas-control]").getByTestId("side-menu").click();
	await page.getByRole("menuitem", { name: sides[1] }).click();
	expect(await state<number>(page, "s.side")).toBe(1);
	await page.keyboard.press("Alt+Period");
	expect(await state<number>(page, "s.side")).toBe(sides.length > 2 ? 2 : 0);

	await page.locator("footer").getByTestId("variant-menu").click();
	const variant = await state<string>(page, "c.base.variants[0].label");
	await page.getByRole("menuitem", { name: variant }).click();
	await expect(page.getByTestId("variant-bar")).toContainText(variant);
	await page.keyboard.press("Alt+Shift+Comma");
	await expect(page.getByTestId("variant-bar")).toHaveCount(0);
	await settle(page);
});
