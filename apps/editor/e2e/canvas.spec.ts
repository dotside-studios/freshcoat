import { expect, test } from "@playwright/test";
import {
	artboardPoint,
	dragTemplate,
	mod,
	openSample,
	pixel,
	run,
	settle,
	state,
} from "./helpers";

type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
};

const NAME = "0/6";

test("a sample paints and lists its layers", async ({ page }) => {
	await openSample(page);
	const bg = await pixel(page, 20, 20);
	expect(bg[3]).toBe(255);
	expect(bg.slice(0, 3)).not.toEqual([255, 255, 255]);
	const count = await state<number>(page, "s.geometry.size");
	expect(count).toBeGreaterThan(10);
});

test("click selects, drag moves exactly, undo and redo", async ({ page }) => {
	await openSample(page);
	const before = await state<{ x: number; y: number }>(
		page,
		`s.geometry.get("${NAME}").rect`,
	);
	const p = await artboardPoint(page, before.x + 40, before.y + 30);
	await page.mouse.click(p.x, p.y);
	expect(await state<string[]>(page, "s.selection")).toEqual([NAME]);

	// Holding the modifier turns snapping off, so the move is the drag.
	await dragTemplate(
		page,
		{ x: before.x + 40, y: before.y + 30 },
		{ x: 100, y: 50 },
		{ modifiers: [mod] },
	);
	const moved = await state<{ x: number; y: number }>(
		page,
		`s.geometry.get("${NAME}").rect`,
	);
	expect(moved.x - before.x).toBeCloseTo(100, 0);
	expect(moved.y - before.y).toBeCloseTo(50, 0);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(1);

	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	const undone = await state<{ x: number }>(
		page,
		`s.geometry.get("${NAME}").rect`,
	);
	expect(undone.x).toBeCloseTo(before.x, 1);
	await page.keyboard.press(`${mod}+Shift+z`);
	await settle(page);
	const redone = await state<{ x: number }>(
		page,
		`s.geometry.get("${NAME}").rect`,
	);
	expect(redone.x).toBeCloseTo(moved.x, 1);
});

test("dragging snaps to the artboard centre", async ({ page }) => {
	await openSample(page);
	await run(page, `c.select(["${NAME}"])`);
	const r = await state<Rect>(page, `s.geometry.get("${NAME}").rect`);
	const centre = 1012 / 2 - r.width / 2;
	await dragTemplate(
		page,
		{ x: r.x + 20, y: r.y + 20 },
		{ x: centre - r.x + 2, y: 0 },
	);
	const after = await state<Rect>(page, `s.geometry.get("${NAME}").rect`);
	expect(after.x + after.width / 2).toBeCloseTo(506, 1);
});

test("the south-east handle resizes and shift-rotate snaps to 15°", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["0/9"])`);
	const r = await state<Rect>(page, `s.geometry.get("0/9").rect`);
	const handle = await page.getByTestId("handle-se").boundingBox();
	if (!handle) throw new Error("no handle");
	const a = await artboardPoint(page, 0, 0);
	await page.mouse.move(
		handle.x + handle.width / 2,
		handle.y + handle.height / 2,
	);
	await page.mouse.down();
	await page.keyboard.down(mod);
	for (let i = 1; i <= 8; i++)
		await page.mouse.move(
			handle.x + handle.width / 2 + (40 * a.scale * i) / 8,
			handle.y + handle.height / 2 + (20 * a.scale * i) / 8,
		);
	await page.mouse.up();
	await page.keyboard.up(mod);
	await settle(page);
	const resized = await state<Rect>(page, `s.geometry.get("0/9").rect`);
	expect(resized.width - r.width).toBeCloseTo(40, 0);
	expect(resized.height - r.height).toBeCloseTo(20, 0);

	// Grab just outside the north-east corner, where the rotate zone is.
	const ne = await page.getByTestId("handle-ne").boundingBox();
	if (!ne) throw new Error("no handle");
	const start = { x: ne.x + ne.width / 2 + 9, y: ne.y + ne.height / 2 - 9 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.keyboard.down("Shift");
	for (let i = 1; i <= 8; i++)
		await page.mouse.move(start.x + i * 6, start.y + i * 9);
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await settle(page);
	const rotation = await state<number>(
		page,
		`s.geometry.get("0/9").rect.rotation`,
	);
	expect(rotation).not.toBe(0);
	expect(Math.abs(rotation % 15)).toBeCloseTo(0, 5);
});

test("each creation tool adds a valid layer", async ({ page }) => {
	await openSample(page);
	const tools = ["rect", "ellipse", "text", "frame", "qr"] as const;
	let x = 60;
	for (const tool of tools) {
		const count = await state<number>(
			page,
			"t.template_data[0].elements.length",
		);
		await page.getByTestId(`tool-${tool}`).click();
		await dragTemplate(page, { x, y: 140 }, { x: 120, y: 90 }, { steps: 4 });
		expect(
			await state<number>(page, "t.template_data[0].elements.length"),
		).toBe(count + 1);
		expect(await state<string>(page, "s.tool")).toBe("move");
		x += 150;
	}
	expect(await state<number>(page, "s.doc.issues.length")).toBe(0);
	await expect(page.getByTestId("issues-badge")).toHaveAccessibleName(
		"No issues",
	);
});

test("a click with a creation tool places a default-sized layer", async ({
	page,
}) => {
	await openSample(page);
	await page.keyboard.press("r");
	const p = await artboardPoint(page, 500, 300);
	await page.mouse.click(p.x, p.y);
	await settle(page);
	const key = (await state<string[]>(page, "s.selection"))[0];
	const r = await state<Rect>(page, `s.geometry.get("${key}").rect`);
	expect(r.x + r.width / 2).toBeCloseTo(500, 0);
	expect(r.width).toBeGreaterThan(50);
});

test("arrow keys nudge and consecutive nudges are one undo step", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["${NAME}"])`);
	const r = await state<Rect>(page, `s.geometry.get("${NAME}").rect`);
	await page.getByTestId("viewport").focus();
	// Nudges merge within a second of each other by Date.now, and two key
	// presses on a loaded machine can land further apart than that.
	await page.clock.setFixedTime(Date.now());
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	await settle(page);
	const n = await state<Rect>(page, `s.geometry.get("${NAME}").rect`);
	expect(n.x - r.x).toBeCloseTo(1, 5);
	expect(n.y - r.y).toBeCloseTo(10, 5);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(1);
});

test("wheel pans, ctrl-wheel zooms about the pointer", async ({ page }) => {
	await openSample(page);
	const v0 = await state<{ x: number; y: number; zoom: number }>(
		page,
		"s.view",
	);
	const vp = await page.getByTestId("viewport").boundingBox();
	if (!vp) throw new Error("no viewport");
	await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
	await page.mouse.wheel(0, 100);
	const v1 = await state<{ y: number }>(page, "s.view");
	expect(v1.y).toBeCloseTo(v0.y - 100, 0);
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -100);
	await page.keyboard.up("Control");
	const v2 = await state<{ zoom: number }>(page, "s.view");
	expect(v2.zoom).toBeGreaterThan(v0.zoom);
});

test("escape cancels a drag in progress", async ({ page }) => {
	await openSample(page);
	await run(page, `c.select(["${NAME}"])`);
	const r = await state<Rect>(page, `s.geometry.get("${NAME}").rect`);
	const a = await artboardPoint(page, r.x + 20, r.y + 20);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(a.x + 40, a.y + 40, { steps: 5 });
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await settle(page);
	const after = await state<Rect>(page, `s.geometry.get("${NAME}").rect`);
	expect(after.x).toBeCloseTo(r.x, 5);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(0);
});

test("double-click edits a text layer on the canvas as one undo step", async ({
	page,
}) => {
	await openSample(page);
	const key = await state<string>(
		page,
		`"0/" + t.template_data[0].elements.findIndex((e) => e.type === "text" && !e.properties.spans)`,
	);
	const before = await state<string>(
		page,
		`t.template_data[0].elements[${key.split("/")[1]}].properties.value`,
	);
	const r = await state<Rect>(page, `s.geometry.get("${key}").rect`);
	const p = await artboardPoint(page, r.x + 4, r.y + r.height / 2);
	await page.mouse.click(p.x, p.y);
	await page.mouse.dblclick(p.x, p.y);
	const editor = page.getByLabel("Edit text on canvas");
	await expect(editor).toBeFocused();
	await expect(editor).toHaveValue(before);
	expect(await state<string>(page, "s.textEdit")).toBe(key);

	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type("Edited {{ name }}");
	await page.keyboard.press("Escape");
	await expect(editor).toBeHidden();
	await settle(page);
	expect(
		await state<string>(
			page,
			`t.template_data[0].elements[${key.split("/")[1]}].properties.value`,
		),
	).toBe("Edited {{ name }}");
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(1);

	await page.keyboard.press(`${mod}+z`);
	await settle(page);
	expect(
		await state<string>(
			page,
			`t.template_data[0].elements[${key.split("/")[1]}].properties.value`,
		),
	).toBe(before);
});

test("images dropped on the canvas land where they are dropped", async ({
	page,
}) => {
	await openSample(page);
	const p = await artboardPoint(page, 200, 150);
	await page.evaluate(async ({ x, y }) => {
		const dt = new DataTransfer();
		for (const name of ["a.png", "b.png"]) {
			const c = new OffscreenCanvas(30, 20);
			const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
			g.fillStyle = "#39c";
			g.fillRect(0, 0, 30, 20);
			const blob = await c.convertToBlob({ type: "image/png" });
			dt.items.add(new File([blob], name, { type: "image/png" }));
		}
		const el = document.querySelector('[data-testid="viewport"]') as Element;
		for (const type of ["dragenter", "dragover", "drop"])
			el.dispatchEvent(
				new DragEvent(type, {
					dataTransfer: dt,
					bubbles: true,
					cancelable: true,
					clientX: x,
					clientY: y,
				}),
			);
	}, p);
	await expect
		.poll(() => state<number>(page, "s.doc.history.past.length"))
		.toBe(2);
	const placed = await state<Rect[]>(
		page,
		"t.template_data[0].elements.slice(-2).map((e) => ({ ...e.pos, ...e.size }))",
	);
	const want = [
		{ x: 185, y: 140, width: 30, height: 20 },
		{ x: 205, y: 160, width: 30, height: 20 },
	];
	for (const [i, rect] of placed.entries())
		for (const k of ["x", "y", "width", "height"] as const)
			expect(Math.abs(rect[k] - (want[i]?.[k] ?? 0))).toBeLessThan(1);
});
