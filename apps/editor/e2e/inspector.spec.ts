import { expect, type Page, test } from "@playwright/test";
import {
	artboardPoint,
	mod,
	openSample,
	pixel,
	run,
	settle,
	state,
} from "./helpers";

const NAME = "0/6";
const QR_PANEL = "0/9";

/** Sum of RGB over a template-space box of the painted artboard. */
async function regionSum(
	page: Page,
	box: { x: number; y: number; width: number; height: number },
) {
	return page.evaluate(async (b) => {
		const f = (
			window as unknown as {
				__freshcoat: {
					snapshot(): Promise<HTMLCanvasElement>;
					controller: { template: { width: number } };
				};
			}
		).__freshcoat;
		const c = await f.snapshot();
		const s = c.width / f.controller.template.width;
		const ctx = c.getContext("2d") as CanvasRenderingContext2D;
		const data = ctx.getImageData(
			Math.round(b.x * s),
			Math.round(b.y * s),
			Math.round(b.width * s),
			Math.round(b.height * s),
		).data;
		let sum = 0;
		for (let i = 0; i < data.length; i += 4)
			sum += data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7;
		return sum;
	}, box);
}

async function blurFocus(page: Page) {
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

function inspector(page: Page) {
	return page.getByTestId("design-inspector");
}

test("typing X moves the layer, and undo puts it back", async ({ page }) => {
	await openSample(page);
	await run(page, `c.select(["${NAME}"])`);
	const x = inspector(page).getByRole("spinbutton", { name: "X", exact: true });
	await expect(x).toHaveValue("64");
	await x.fill("200");
	await x.press("Enter");
	await settle(page);
	expect(await state<number>(page, `c.rectOf("${NAME}").x`)).toBe(200);
	expect(await state<number>(page, `s.geometry.get("${NAME}").rect.x`)).toBe(
		200,
	);
	await blurFocus(page);
	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	expect(await state<number>(page, `c.rectOf("${NAME}").x`)).toBe(64);
	await expect(x).toHaveValue("64");
});

test("a fill colour change repaints the canvas", async ({ page }) => {
	await openSample(page);
	await run(page, `c.select(["${QR_PANEL}"])`);
	// Inside the panel, left of the QR code.
	const at = { x: 772 + 8, y: 398 + 88 };
	const before = await pixel(page, at.x, at.y);
	expect(before.slice(0, 3)).toEqual([255, 255, 255]);

	const hex = inspector(page).getByRole("textbox", { name: "Fill 1 color" });
	await hex.fill("#ff0000");
	await hex.press("Enter");
	await settle(page);
	expect(
		await state<unknown>(
			page,
			`c.template.template_data[0].elements[9].properties.fill`,
		),
	).toBe("#ff0000");
	const after = await pixel(page, at.x, at.y);
	expect(after.slice(0, 3)).toEqual([255, 0, 0]);

	await blurFocus(page);
	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	expect((await pixel(page, at.x, at.y)).slice(0, 3)).toEqual([255, 255, 255]);
});

test("editing text content repaints, and undo reverts", async ({ page }) => {
	await openSample(page);
	await run(page, `c.select(["${NAME}"])`);
	const box = { x: 64, y: 396, width: 660, height: 70 };
	const before = await regionSum(page, box);

	const content = inspector(page).getByRole("textbox", {
		name: "Text content",
	});
	await expect(content).toHaveValue("{{display_name}}");
	await content.fill("WWWW MMMM");
	await settle(page);
	expect(
		await state<string>(
			page,
			`c.template.template_data[0].elements[6].properties.value`,
		),
	).toBe("WWWW MMMM");
	const changed = await regionSum(page, box);
	expect(changed).not.toBe(before);

	await blurFocus(page);
	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	await expect(content).toHaveValue("{{display_name}}");
	expect(await regionSum(page, box)).toBe(before);
});

test("double-clicking a selected mixed-style text layer shows its content in the inspector", async ({
	page,
}) => {
	await openSample(page);
	await run(
		page,
		`c.edit((t) => {
			const side = t.template_data[0];
			const elements = side.elements.map((e, i) =>
				i === 6 ? { ...e, properties: { ...e.properties, spans: [{ text: "Ada " }, { text: "Lovelace" }] } } : e,
			);
			return { ...t, template_data: [{ ...side, elements }, ...t.template_data.slice(1)] };
		});
		c.dispatch({ type: "setRightTab", tab: "content" });
		c.dispatch({ type: "setPanels", panels: { right: false } });
		c.select(["${NAME}"])`,
	);
	await settle(page);
	const p = await artboardPoint(page, 64 + 120, 396 + 40);
	await page.mouse.dblclick(p.x, p.y);
	await expect(
		inspector(page).getByText("Mixed styles (2 spans)"),
	).toBeVisible();
	await expect(
		inspector(page).getByRole("button", { name: "Flatten to plain text" }),
	).toBeVisible();
	await expect(page.getByLabel("Edit text on canvas")).toHaveCount(0);
	expect(await state<string | null>(page, "s.textEdit")).toBeNull();
});

test("the Object menu groups align and distribute, which have shortcuts", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["0/0", "0/1", "0/2"])`);
	await page
		.getByRole("toolbar", { name: "Align" })
		.getByRole("button", { name: "Align left" })
		.hover();
	await expect(page.getByRole("tooltip")).toContainText(/Align left\s+(Alt|⌥)/);

	await page.getByRole("button", { name: "Object", exact: true }).click();
	const menu = page.getByRole("menu", { name: "Object" });
	await expect(menu.getByRole("menuitem")).toHaveText([
		/Group into frame/,
		/Ungroup/,
		/Attach text to path/,
		"Boolean",
		"Arrange",
		"Align and distribute",
		/Hide \/ show/,
		/Lock \/ unlock/,
	]);
	await menu.getByRole("menuitem", { name: "Align and distribute" }).click();
	const sub = page.getByRole("menu", { name: "Align and distribute" });
	await expect(
		sub.getByRole("menuitem", { name: /Distribute horizontally/ }),
	).toContainText(/Alt|⌥/);
});
