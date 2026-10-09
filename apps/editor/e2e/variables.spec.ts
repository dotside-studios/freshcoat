import { expect, type Page, test } from "@playwright/test";
import { artboardPoint, mod, openSample, run, settle, state } from "./helpers";

/** A checksum of the painted artboard, or of one template-space box on it. */
async function paint(
	page: Page,
	box?: { x: number; y: number; width: number; height: number },
) {
	await settle(page);
	return page.evaluate(async (b) => {
		const f = (
			window as unknown as {
				__freshcoat: {
					snapshot(): Promise<HTMLCanvasElement>;
					controller: { template: { width: number; height: number } };
				};
			}
		).__freshcoat;
		const c = await f.snapshot();
		const t = f.controller.template;
		const s = c.width / t.width;
		const r = b ?? { x: 0, y: 0, width: t.width, height: t.height };
		const ctx = c.getContext("2d") as CanvasRenderingContext2D;
		const data = ctx.getImageData(
			Math.round(r.x * s),
			Math.round(r.y * s),
			Math.max(1, Math.round(r.width * s)),
			Math.max(1, Math.round(r.height * s)),
		).data;
		let h = 0;
		for (let i = 0; i < data.length; i++) h = (h * 31 + data[i]) | 0;
		return h;
	}, box);
}

const nameBox = (page: Page) =>
	state<{ x: number; y: number; width: number; height: number }>(
		page,
		`s.geometry.get("0/" + t.template_data[0].elements.findIndex((e) => e.id === "name")).rect`,
	);

test("preview values, a new field bound into a text, and variants repaint", async ({
	page,
}) => {
	await openSample(page, "membership-card");
	await page.getByRole("tab", { name: "Content" }).click();
	const panel = page.getByTestId("content-panel");
	const box = await nameBox(page);

	const before = await paint(page, box);
	expect(await paint(page, box)).toBe(before);
	await panel.getByRole("textbox", { name: "Display name" }).fill("Zed Q");
	expect(await state<string>(page, "s.values.display_name")).toBe("Zed Q");
	expect(await paint(page, box)).not.toBe(before);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(0);

	await panel.getByRole("button", { name: "Add field" }).click();
	await panel.getByRole("textbox", { name: "New field key" }).fill("nickname");
	await panel.getByRole("textbox", { name: "New field key" }).press("Enter");
	expect(
		await state<object>(page, "t.fields.properties.nickname"),
	).toMatchObject({ type: "string", title: "Nickname" });
	await expect(panel.getByTestId("field-nickname")).toContainText("unused");

	await run(
		page,
		`c.edit((t) => {
			const side = t.template_data[0];
			const elements = side.elements.map((e) =>
				e.id === "name" ? { ...e, properties: { ...e.properties, value: "{{nickname}}" } } : e,
			);
			return { ...t, template_data: [{ ...side, elements }, ...t.template_data.slice(1)] };
		});`,
	);
	await expect(panel.getByTestId("field-nickname")).not.toContainText("unused");
	expect(await state<number>(page, "s.doc.issues.length")).toBe(0);

	const bound = await paint(page, box);
	await panel.getByRole("textbox", { name: "Nickname" }).fill("Ziggy");
	expect(await paint(page, box)).not.toBe(bound);

	const whole = await paint(page);
	await page.getByTestId("variant-midnight").click();
	expect(await state<string>(page, "s.variantId")).toBe("midnight");
	expect(await paint(page)).not.toBe(whole);
	await page.getByTestId("variant-__default").click();
	expect(await state<unknown>(page, "s.variantId ?? null")).toBeNull();
});

test("{{ suggests field keys in the on-canvas text editor", async ({
	page,
}) => {
	await openSample(page, "membership-card");
	const box = await nameBox(page);
	const p = await artboardPoint(page, box.x + 4, box.y + box.height / 2);
	await page.mouse.click(p.x, p.y);
	await page.mouse.dblclick(p.x, p.y);
	const editor = page.getByLabel("Edit text on canvas");
	await expect(editor).toBeFocused();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type("Hi {{disp");
	const list = page.getByTestId("field-completion");
	await expect(list.getByRole("option").first()).toContainText("display_name");
	await page.keyboard.press("Enter");
	await expect(list).toBeHidden();
	await expect(editor).toHaveValue("Hi {{display_name}}");
	await expect(editor).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(editor).toBeHidden();
	expect(
		await state<string>(
			page,
			`t.template_data[0].elements.find((e) => e.id === "name").properties.value`,
		),
	).toBe("Hi {{display_name}}");
});

test("Template setup renames and resizes", async ({ page }) => {
	await openSample(page, "membership-card");
	await page.getByRole("button", { name: "File", exact: true }).click();
	await page.getByRole("menuitem", { name: "Template setup…" }).click();
	const panel = page.getByTestId("template-setup");

	await panel.getByRole("textbox", { name: "Name" }).fill("Club card");
	expect(await state<string>(page, "t.name")).toBe("Club card");

	const width = panel.getByRole("spinbutton", { name: "Template width" });
	await width.fill("900");
	await width.press("Enter");
	expect(await state<number[]>(page, "[t.width, t.height]")).toEqual([
		900, 638,
	]);
	await expect(page.locator("footer")).toContainText("900 × 638");

	await panel.getByRole("button", { name: "Lock aspect ratio" }).click();
	const height = panel.getByRole("spinbutton", { name: "Template height" });
	await height.fill("319");
	await height.press("Enter");
	expect(await state<number[]>(page, "[t.width, t.height]")).toEqual([
		450, 319,
	]);
	await expect(page.locator("footer")).toContainText("450 × 319");
	await panel.getByRole("button", { name: "Done" }).click();
	await expect(panel).toHaveCount(0);
	await expect(page.getByTestId("issues-badge")).toHaveAccessibleName(
		"No issues",
	);
});

test("the template context menu opens Template setup", async ({ page }) => {
	await openSample(page, "membership-card");
	const templates = page.getByRole("region", { name: "Templates" });
	await templates.getByRole("heading").getByRole("button").click();
	await page
		.getByTestId("templates-list")
		.getByRole("option")
		.first()
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: /Template setup…/ }).click();
	await expect(page.getByTestId("template-setup")).toBeVisible();
});

test("an issue path selects the layer it points into", async ({ page }) => {
	await openSample(page, "membership-card");
	await run(
		page,
		`c.edit((t) => {
			const side = t.template_data[0];
			const elements = side.elements.map((e) =>
				e.id === "since" ? { ...e, properties: { ...e.properties, value: "{{missing_field}}" } } : e,
			);
			return { ...t, template_data: [{ ...side, elements }, ...t.template_data.slice(1)] };
		});`,
	);
	const badge = page.getByTestId("issues-badge");
	await expect(badge).toHaveAccessibleName("1 issue");
	await badge.click();
	const popover = page.getByTestId("issues-popover");
	const path = popover.getByTestId("issue-path");
	await expect(path).toHaveCount(1);
	await path.click();
	await expect(popover).toHaveCount(0);
	const since = await state<string>(
		page,
		`"0/" + t.template_data[0].elements.findIndex((e) => e.id === "since")`,
	);
	expect(await state<string[]>(page, "s.selection")).toEqual([since]);
});
