import { expect, test } from "@playwright/test";
import { artboardPoint, mod, openSample, settle, state } from "./helpers";

type Vector = {
	type: string;
	pos: { x: number; y: number };
	properties: { d: string; fill?: unknown; stroke?: unknown };
};

const selected = (page: Parameters<typeof state>[0]) =>
	state<Vector>(
		page,
		`(() => { const k = s.selection[0].split("/").map(Number); return t.template_data[k[0]].elements[k[1]]; })()`,
	);

test("the pen draws a closed shape from clicks", async ({ page }) => {
	await openSample(page);
	const before = await state<number>(
		page,
		"t.template_data[0].elements.length",
	);
	await page.keyboard.press("p");
	await expect(page.getByTestId("tool-pen")).toHaveAttribute(
		"data-selected",
		"true",
	);
	for (const [x, y] of [
		[100, 100],
		[300, 100],
		[200, 250],
	] as const) {
		const p = await artboardPoint(page, x, y);
		await page.mouse.click(p.x, p.y);
	}
	await expect(page.getByTestId("pen-draft")).toHaveAttribute(
		"data-points",
		"3",
	);
	const first = await artboardPoint(page, 100, 100);
	await page.mouse.click(first.x + 2, first.y + 1);
	await settle(page);
	await expect(page.getByTestId("pen-draft")).toHaveCount(0);
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		before + 1,
	);
	expect(await state<string>(page, "s.tool")).toBe("move");
	const el = await selected(page);
	expect(el.type).toBe("vector");
	expect(el.properties.d).toMatch(/^M0 0L\d+(\.\d+)? 0L.*Z$/);
	expect(el.properties.fill).toBeTruthy();
	expect(el.pos.x).toBeCloseTo(100, 0);

	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		before,
	);
});

test("dragging makes a smooth point, and Enter finishes an open path", async ({
	page,
}) => {
	await openSample(page);
	await page
		.getByRole("toolbar", { name: "Tools" })
		.getByRole("button", { name: "Pen", exact: true })
		.click();
	const a = await artboardPoint(page, 100, 300);
	await page.mouse.click(a.x, a.y);
	const b = await artboardPoint(page, 300, 300);
	const c = await artboardPoint(page, 360, 240);
	await page.mouse.move(b.x, b.y);
	await page.mouse.down();
	await page.mouse.move(c.x, c.y, { steps: 6 });
	await page.mouse.up();
	const d = await artboardPoint(page, 400, 400);
	await page.mouse.click(d.x, d.y);
	await page.keyboard.press("Backspace");
	await expect(page.getByTestId("pen-draft")).toHaveAttribute(
		"data-points",
		"2",
	);
	await page.keyboard.press("Enter");
	await settle(page);
	const el = await selected(page);
	expect(el.type).toBe("vector");
	expect(el.properties.d).toMatch(/^M\S+ \S+C/);
	expect(el.properties.d).not.toMatch(/Z$/);
	expect(el.properties.stroke).toBeTruthy();
	expect(await state<string[]>(page, "s.selection")).toHaveLength(1);
});

test("Esc finishes the path, and a lone point makes nothing", async ({
	page,
}) => {
	await openSample(page);
	const before = await state<number>(
		page,
		"t.template_data[0].elements.length",
	);
	await page.keyboard.press("p");
	const a = await artboardPoint(page, 100, 100);
	await page.mouse.click(a.x, a.y);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("pen-draft")).toHaveCount(0);
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		before,
	);
	await page.mouse.click(a.x, a.y);
	const b = await artboardPoint(page, 200, 120);
	await page.mouse.click(b.x, b.y);
	await page.keyboard.press("Escape");
	await settle(page);
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		before + 1,
	);
});
