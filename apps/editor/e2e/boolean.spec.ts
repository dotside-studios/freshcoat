import { expect, test } from "@playwright/test";
import { mod, openSample, pixel, run, settle, state } from "./helpers";

type Layer = {
	id: string;
	type: string;
	pos: { x: number; y: number };
	size: { width: number; height: number };
	properties: {
		d?: string;
		boolean?: { op: string; operands: Layer[] };
	};
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
	expect(el.properties.boolean?.op).toBe("union");
	expect(el.properties.boolean?.operands.map((o) => o.type)).toEqual([
		"rect",
		"vector",
	]);
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

const row = (page: Parameters<typeof state>[0], key: string) =>
	page.getByTestId(`layer-row-${key}`);

async function union(page: Parameters<typeof state>[0]) {
	await twoShapes(page);
	await page.keyboard.press("Alt+Shift+U");
	await settle(page);
	return state<string>(page, "s.selection[0]");
}

test("the operands are layers, and the result follows their edits", async ({
	page,
}) => {
	await openSample(page);
	const key = await union(page);
	await run(page, `c.select(["${key}/1"]);`);
	await expect(row(page, `${key}/0`)).toBeVisible();
	await row(page, `${key}/1`).click();
	expect(await state<string[]>(page, "s.selection")).toEqual([`${key}/1`]);

	const edge = [286, 160] as const;
	const before = await pixel(page, ...edge);
	await run(page, "c.nudge(10, 0);");
	const after = await pixel(page, ...edge);
	expect(after).not.toEqual(before);

	expect(await state<string[]>(page, "s.selection")).toEqual([`${key}/1`]);
	const vector = await state<Layer>(
		page,
		`(() => { const k = "${key}".split("/").map(Number); return t.template_data[k[0]].elements[k[1]]; })()`,
	);
	expect(vector.size.width).toBeCloseTo(190, 0);
	expect(vector.properties.boolean?.operands[1]?.pos.x).toBeCloseTo(70, 0);
});

test("an operand dragged out of the tree becomes a layer", async ({ page }) => {
	await openSample(page);
	const key = await union(page);
	await run(page, `c.select(["${key}/1"]);`);
	await row(page, `${key}/1`).dragTo(row(page, "0/9"));
	await settle(page);
	expect(
		await state<string[]>(
			page,
			`t.template_data[0].elements[9].properties.children.map((e) => e.id)`,
		),
	).toContain("ellipse");
	expect(
		await state<number>(
			page,
			`t.template_data[0].elements.find((e) => e.properties.boolean).properties.boolean.operands.length`,
		),
	).toBe(1);
});

test("the inspector switches the operation and flattens", async ({ page }) => {
	await openSample(page);
	await union(page);
	const bar = page.getByRole("toolbar", { name: "Boolean" });
	await expect(
		bar.getByRole("button", { name: "Union selection" }),
	).toHaveAttribute("aria-pressed", "true");
	await bar.getByRole("button", { name: "Subtract selection" }).click();
	await expect
		.poll(async () => (await selectedLayer(page)).properties.boolean?.op)
		.toBe("subtract");
	await settle(page);
	expect((await selectedLayer(page)).size.width).toBeCloseTo(120, 0);

	await bar.getByRole("button", { name: "Flatten" }).click();
	await expect
		.poll(async () => (await selectedLayer(page)).properties.boolean)
		.toBeUndefined();
	const flat = await selectedLayer(page);
	expect(flat.type).toBe("vector");
	expect(flat.properties.d).toContain("C");
	await expect(bar.getByRole("button", { name: "Flatten" })).toHaveCount(0);

	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	expect((await selectedLayer(page)).properties.boolean?.op).toBe("subtract");
});

test("deleting the last operands removes the boolean", async ({ page }) => {
	await openSample(page);
	const key = await union(page);
	const count = await state<number>(page, "t.template_data[0].elements.length");
	await run(page, `c.select(["${key}/0", "${key}/1"]); c.deleteSelection();`);
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		count - 1,
	);
});
