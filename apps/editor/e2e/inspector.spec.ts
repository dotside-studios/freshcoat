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

test("double-clicking a selected text layer focuses its content", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["${NAME}"])`);
	const p = await artboardPoint(page, 64 + 120, 396 + 40);
	await page.mouse.dblclick(p.x, p.y);
	await expect(
		inspector(page).getByRole("textbox", { name: "Text content" }),
	).toBeFocused();
});
