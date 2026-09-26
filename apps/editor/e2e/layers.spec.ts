import { expect, type Page, test } from "@playwright/test";
import { mod, openSample, pixel, settle, state } from "./helpers";

// membership-card front, paint order: 0 ring-outer · 1 ring-inner · 2 logo ·
// 3 wordmark · 4 tier-chip · 5 verified-badge · 6 name · 7 since ·
// 8 member-id · 9 qr-panel [qr]

const row = (page: Page, key: string) => page.getByTestId(`layer-row-${key}`);

/** Top-level rows as the tree shows them, by name. */
async function topLevel(page: Page): Promise<string[]> {
	return page
		.getByTestId("layers-tree")
		.locator('[role="row"][data-level="1"]')
		.evaluateAll((rows) =>
			rows.map((r) => r.querySelector("[data-layer-name]")?.textContent ?? ""),
		);
}

async function ids(page: Page): Promise<string[]> {
	return state<string[]>(page, "t.template_data[0].elements.map((e) => e.id)");
}

test("clicking a row selects the layer", async ({ page }) => {
	await openSample(page);
	await row(page, "0/3").click();
	expect(await state<string[]>(page, "s.selection")).toEqual(["0/3"]);
	await row(page, "0/9").click({ modifiers: [mod] });
	expect(await state<string[]>(page, "s.selection")).toEqual(["0/3", "0/9"]);
	await expect(row(page, "0/9")).toHaveAttribute("aria-selected", "true");

	// A selection made through the controller reveals and selects the row.
	await page.evaluate(() =>
		(
			window as unknown as {
				__freshcoat: { controller: { select(k: string[]): void } };
			}
		).__freshcoat.controller.select(["0/5/0/1"]),
	);
	await expect(row(page, "0/5/0/1")).toHaveAttribute("aria-selected", "true");
	await expect(row(page, "0/5/0/1")).toBeInViewport();
});

test("rename by double-clicking the name", async ({ page }) => {
	await openSample(page);
	await row(page, "0/3").getByText("wordmark").dblclick();
	const input = page.getByRole("textbox", { name: "Rename wordmark" });
	await expect(input).toBeFocused();
	await input.fill("brand");
	await input.press("Enter");
	await expect(input).toHaveCount(0);
	expect(await state<string>(page, "t.template_data[0].elements[3].id")).toBe(
		"brand",
	);
	await expect(row(page, "0/3")).toContainText("brand");

	// A name already used on the side is refused and the field stays open.
	await row(page, "0/3").getByText("brand").dblclick();
	await page.getByRole("textbox", { name: "Rename brand" }).fill("logo");
	await page.getByRole("textbox", { name: "Rename brand" }).press("Enter");
	await expect(
		page.getByText('"logo" is already used on this side'),
	).toBeVisible();
	await page.getByRole("textbox", { name: "Rename brand" }).press("Escape");
	expect(await state<string>(page, "t.template_data[0].elements[3].id")).toBe(
		"brand",
	);
});

test("the eye hides a layer on the canvas without touching the file", async ({
	page,
}) => {
	await openSample(page);
	const logo = await state<{
		x: number;
		y: number;
		width: number;
		height: number;
	}>(page, 's.geometry.get("0/2").rect');
	const cx = logo.x + logo.width / 2;
	const cy = logo.y + logo.height / 2;
	const before = await pixel(page, cx, cy);

	await row(page, "0/2").hover();
	await row(page, "0/2").getByRole("button", { name: "Hide" }).click();
	await settle(page);
	expect(await state<boolean>(page, 's.hidden.has("0/2")')).toBe(true);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(0);
	expect(await state<boolean>(page, "c.dirty")).toBe(false);
	await expect.poll(() => pixel(page, cx, cy)).not.toEqual(before);
	// Set toggles stay visible without hover.
	await page.mouse.move(700, 700);
	await expect(
		row(page, "0/2").getByRole("button", { name: "Show" }),
	).toBeVisible();

	await row(page, "0/2").getByRole("button", { name: "Show" }).click();
	await settle(page);
	expect(await state<boolean>(page, 's.hidden.has("0/2")')).toBe(false);
	await expect.poll(() => pixel(page, cx, cy)).toEqual(before);
});

test("reorder with the keyboard shortcut", async ({ page }) => {
	await openSample(page);
	await row(page, "0/6").click();
	expect((await topLevel(page)).slice(0, 4)).toEqual([
		"qr-panel",
		"member-id",
		"since",
		"name",
	]);
	await page.keyboard.press(`${mod}+]`);
	await settle(page);
	// The tree re-renders after the edit lands, not with it.
	await expect
		.poll(async () => (await topLevel(page)).slice(0, 4))
		.toEqual(["qr-panel", "member-id", "name", "since"]);
	expect((await ids(page)).slice(6, 8)).toEqual(["since", "name"]);
	expect(await state<string[]>(page, "s.selection")).toEqual(["0/7"]);
	await expect(row(page, "0/7")).toHaveAttribute("aria-selected", "true");

	await page.keyboard.press(`${mod}+[`);
	await settle(page);
	expect((await ids(page)).slice(6, 8)).toEqual(["name", "since"]);
});

test("group and ungroup two layers", async ({ page }) => {
	await openSample(page);
	await row(page, "0/7").click();
	await row(page, "0/8").click({ modifiers: ["Shift"] });
	expect(new Set(await state<string[]>(page, "s.selection"))).toEqual(
		new Set(["0/7", "0/8"]),
	);
	await page.keyboard.press(`${mod}+g`);
	await settle(page);
	expect(await ids(page)).toEqual([
		"ring-outer",
		"ring-inner",
		"logo",
		"wordmark",
		"tier-chip",
		"verified-badge",
		"name",
		"group",
		"qr-panel",
	]);
	expect(await state<string[]>(page, "s.selection")).toEqual(["0/7"]);
	await expect(row(page, "0/7")).toContainText("group");
	await row(page, "0/7")
		.getByRole("button", { name: /expand/i })
		.click();
	await expect(row(page, "0/7/1")).toContainText("member-id");
	await expect(row(page, "0/7/0")).toContainText("since");

	await page.keyboard.press(`${mod}+Shift+g`);
	await settle(page);
	expect((await ids(page)).slice(6, 9)).toEqual(["name", "since", "member-id"]);
	expect(new Set(await state<string[]>(page, "s.selection"))).toEqual(
		new Set(["0/7", "0/8"]),
	);
});

test("the context menu acts on the row it opened on", async ({ page }) => {
	await openSample(page);
	await row(page, "0/3").click();
	await row(page, "0/2").click({ button: "right" });
	expect(await state<string[]>(page, "s.selection")).toEqual(["0/2"]);
	await page.getByRole("menuitem", { name: /Duplicate/ }).click();
	await settle(page);
	expect((await ids(page)).slice(2, 4)).toEqual(["logo", "logo-2"]);
	expect(await state<string[]>(page, "s.selection")).toEqual(["0/3"]);
});

test("dragging a row onto a frame reparents it", async ({ page }) => {
	await openSample(page);
	const before = await state<{ x: number; y: number }>(
		page,
		's.geometry.get("0/2").rect',
	);
	await row(page, "0/2").dragTo(row(page, "0/9"));
	await settle(page);
	expect(
		await state<string[]>(page, "t.template_data[0].elements.map((e) => e.id)"),
	).not.toContain("logo");
	expect(
		await state<string[]>(
			page,
			"t.template_data[0].elements.at(-1).properties.children.map((e) => e.id)",
		),
	).toEqual(["qr", "logo"]);
	const after = await state<{ x: number; y: number }>(
		page,
		's.geometry.get("0/8/1").rect',
	);
	expect(after.x).toBeCloseTo(before.x, 1);
	expect(after.y).toBeCloseTo(before.y, 1);
});

test("sides: switch, add and rename", async ({ page }) => {
	await openSample(page);
	const sides = page.getByTestId("sides-list");
	await sides.getByText("back").click();
	expect(await state<number>(page, "s.side")).toBe(1);
	await expect(row(page, "1/bg")).toContainText("back-bg");

	await page.getByRole("button", { name: "Add side" }).click();
	expect(await state<number>(page, "s.side")).toBe(2);
	await sides.getByText("side-3").dblclick();
	const input = page.getByRole("textbox", { name: "Rename side side-3" });
	await input.fill("inside");
	await input.press("Enter");
	expect(
		await state<string[]>(page, "t.template_data.map((f) => f.name)"),
	).toEqual(["front", "back", "inside"]);
});
