import { expect, test } from "@playwright/test";
import {
	mod,
	openSample,
	run,
	settle,
	state,
	stubGoogleFonts,
} from "./helpers";

const NAME = "0/6";

test("pick Playfair Display for a layer, and see it in Template setup > Fonts", async ({
	page,
}) => {
	const css = await stubGoogleFonts(page);
	const catalogueLoads: string[] = [];
	page.on("request", (r) => {
		if (r.url().includes("google-fonts")) catalogueLoads.push(r.url());
	});
	await openSample(page);
	await run(page, `c.select(["${NAME}"])`);
	const before = await state<number>(page, "s.doc.history.past.length");
	expect(catalogueLoads).toEqual([]);

	await page
		.getByTestId("design-inspector")
		.getByRole("button", { name: /^Font family/ })
		.click();
	const picker = page.getByTestId("font-picker");
	const search = picker.getByRole("combobox", { name: "Search fonts" });
	await expect(search).toBeFocused();
	expect(catalogueLoads.length).toBeGreaterThan(0);

	// Rows in view preview in their own face, from a subset of their name.
	await expect(picker.locator("[data-preview=loaded]").first()).toBeVisible();
	expect(css.some((u) => u.includes("&text="))).toBe(true);

	await search.fill("Playfair Display");
	const option = picker.getByRole("option", {
		name: "Playfair Display",
		exact: true,
	});
	await expect(option).toHaveAttribute("data-active", "true");
	const preview = option.locator("[data-preview=loaded]");
	await expect(preview).toBeVisible();
	// The row really draws in the preview face (Vend Sans here), not the UI's.
	const [inFace, inUi] = await preview.evaluate((node) => {
		const ctx = document.createElement("canvas").getContext("2d");
		const text = node.textContent ?? "";
		if (!ctx) return [0, 0];
		ctx.font = `14px ${getComputedStyle(node).fontFamily}`;
		const a = ctx.measureText(text).width;
		ctx.font = `14px ${getComputedStyle(document.body).fontFamily}`;
		return [a, ctx.measureText(text).width];
	});
	expect(Math.abs(inFace - inUi)).toBeGreaterThan(1);
	await search.press("Enter");
	await expect(picker).toHaveCount(0);
	await settle(page);

	expect(
		await state<string>(
			page,
			`c.template.template_data[0].elements[6].properties.font.family`,
		),
	).toBe("Playfair Display");
	const descriptor = await state<{ url: string }>(
		page,
		`t.fonts.find((f) => f.family === "Playfair Display")`,
	);
	expect(descriptor.url).toMatch(
		/^https:\/\/fonts\.googleapis\.com\/css2\?family=Playfair\+Display:wght@\d+(;\d+)*&display=swap$/,
	);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(
		before + 1,
	);

	await page.keyboard.press(`${mod}+Alt+Comma`);
	await expect(page.getByTestId("template-setup")).toBeVisible();
	const row = page.getByTestId("font-Playfair Display");
	await expect(row).toBeVisible();
	await expect(row.getByText("loaded")).toBeVisible();

	// One undo takes back both the family and the font.
	await page.keyboard.press(`${mod}+z`);
	await expect(row).toHaveCount(0);
});

test("offline, the list still opens and a family can still be added", async ({
	page,
}) => {
	await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
		route.abort(),
	);
	await openSample(page);
	await page.keyboard.press(`${mod}+Alt+Comma`);
	await expect(page.getByTestId("template-setup")).toBeVisible();
	await page.getByRole("button", { name: "Add font…" }).click();
	const picker = page.getByTestId("font-picker");
	await expect(picker.getByRole("option").first()).toBeVisible();
	// Arrow keys walk the list; the active row is the one named to assistive tech.
	const search = picker.getByRole("combobox", { name: "Search fonts" });
	await search.fill("lobster");
	await search.press("ArrowDown");
	const activeId = await search.getAttribute("aria-activedescendant");
	await expect(page.locator(`[id="${activeId}"]`)).toHaveAccessibleName(
		"Lobster Two",
	);
	await search.press("ArrowUp");
	await expect(picker.locator("[data-preview=loaded]")).toHaveCount(0);
	await search.press("Enter");
	await expect(page.getByTestId("font-Lobster")).toBeVisible();

	// Esc closes without an edit.
	await page.getByRole("button", { name: "Add font…" }).click();
	await expect(picker).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(picker).toHaveCount(0);
});
