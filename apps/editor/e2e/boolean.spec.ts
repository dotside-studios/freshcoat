import { expect, test } from "@playwright/test";
import { mod, openSample, run, settle, state } from "./helpers";

type Layer = {
	id: string;
	type: string;
	pos: { x: number; y: number };
	size: { width: number; height: number };
	properties: { d?: string };
};

async function twoShapes(page: Parameters<typeof state>[0]) {
	await run(
		page,
		`const a = c.create("rect", { x: 100, y: 100, width: 120, height: 120 }, { x: 0, y: 0 });
		const b = c.create("ellipse", { x: 160, y: 100, width: 120, height: 120 }, { x: 0, y: 0 });
		c.select([a, b]);`,
	);
	return state<number>(page, "t.template_data[0].elements.length");
}

const selectedLayer = (page: Parameters<typeof state>[0]) =>
	state<Layer>(
		page,
		`(() => { const k = s.selection[0].split("/").map(Number); return t.template_data[k[0]].elements[k[1]]; })()`,
	);

test("union from the keyboard is one layer and one undo step", async ({
	page,
}) => {
	await openSample(page);
	const count = await twoShapes(page);
	const past = await state<number>(page, "s.doc.history.past.length");
	await page.keyboard.press("Alt+Shift+U");
	await expect
		.poll(() => state<number>(page, "t.template_data[0].elements.length"))
		.toBe(count - 1);
	await settle(page);
	const el = await selectedLayer(page);
	expect(el.type).toBe("vector");
	expect(el.pos).toEqual({ x: 100, y: 100 });
	expect(el.size.width).toBeCloseTo(180, 0);
	expect(el.properties.d).toMatch(/^M/);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(past + 1);
	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		count,
	);
});

test("the inspector and the Object menu run the others", async ({ page }) => {
	await openSample(page);
	await twoShapes(page);
	const bar = page.getByRole("toolbar", { name: "Boolean" });
	await expect(bar).toBeVisible();
	await bar.getByRole("button", { name: "Intersect selection" }).click();
	await expect
		.poll(async () => (await selectedLayer(page)).size.width)
		.toBeCloseTo(60, 0);
	await page.keyboard.press(`${mod}+z`);
	await settle(page);

	await run(
		page,
		`const n = c.template.template_data[0].elements.length; c.select(["0/" + (n - 2), "0/" + (n - 1)]);`,
	);
	await page.getByRole("button", { name: "Object", exact: true }).click();
	await page.getByRole("menuitem", { name: "Boolean" }).click();
	await page.getByRole("menuitem", { name: "Subtract selection" }).click();
	await expect
		.poll(async () => (await selectedLayer(page)).type)
		.toBe("vector");
	const cut = await selectedLayer(page);
	expect(cut.pos.x).toBe(100);
	expect(cut.size.width).toBeCloseTo(120, 0);
	expect(cut.properties.d).toContain("C");
});
