import { expect, type Page, test } from "@playwright/test";
import {
	artboardPoint,
	openSample,
	pixel,
	run,
	settle,
	state,
} from "./helpers";

type Box = { x: number; y: number; width: number; height: number };
type Stop = { offset: number; color: string };
type Fill = {
	kind: string;
	angle?: number;
	from?: [number, number];
	to?: [number, number];
	center?: [number, number];
	radius?: number;
	radiusY?: number;
	rotation?: number;
	stops: Stop[];
};

const RED_BLUE: Stop[] = [
	{ offset: 0, color: "#ff0000" },
	{ offset: 1, color: "#0000ff" },
];

/** A 500 x 300 rect at 200,150 on the membership card, selected, with `fill`. */
async function addLayer(page: Page, fill: Fill, rotation = 0) {
	await run(
		page,
		`const key = c.insert({
			id: "grad", type: "rect",
			pos: { x: 200, y: 150 }, size: { width: 500, height: 300 },
			rotation: ${rotation},
			properties: { fill: ${JSON.stringify(fill)} },
		});
		c.select([key]);`,
	);
	await settle(page);
	return state<string>(page, "s.selection[0]");
}

const fillOf = (page: Page, key: string) =>
	state<Fill>(
		page,
		`c.template.template_data[0].elements[${key.split("/")[1]}].properties.fill`,
	);

async function centre(page: Page, handle: string) {
	const box = (await page
		.locator(`[data-handle="${handle}"]`)
		.boundingBox()) as Box;
	expect(box).not.toBeNull();
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses a handle and moves in steps to a screen point, without releasing. */
async function dragTo(
	page: Page,
	handle: string,
	to: { x: number; y: number },
	steps = 10,
) {
	const from = await centre(page, handle);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++)
		await page.mouse.move(
			from.x + ((to.x - from.x) * i) / steps,
			from.y + ((to.y - from.y) * i) / steps,
		);
}

test("dragging a linear endpoint repaints, Esc restores, and it is one undo step", async ({
	page,
}) => {
	await openSample(page);
	const key = await addLayer(page, {
		kind: "linear",
		angle: 0,
		stops: RED_BLUE,
	});
	await expect(page.getByTestId("gradient-handles")).toHaveAttribute(
		"data-kind",
		"linear",
	);
	const before = await pixel(page, 450, 300);
	const past = await state<number>(page, "s.doc.history.past.length");

	// Pull the end in to x = 400: everything right of it is solid blue.
	const target = await artboardPoint(page, 400, 300);
	await dragTo(page, "grad:0:to", target);
	await settle(page);
	const during = await pixel(page, 450, 300);
	expect(during).not.toEqual(before);
	expect(during[2]).toBeGreaterThan(240);
	expect(during[0]).toBeLessThan(15);

	await page.keyboard.press("Escape");
	await page.mouse.up();
	await settle(page);
	expect(await pixel(page, 450, 300)).toEqual(before);
	expect((await fillOf(page, key)).to).toBeUndefined();
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(past);

	await dragTo(page, "grad:0:to", target);
	await page.mouse.up();
	await settle(page);
	const fill = await fillOf(page, key);
	expect(fill.from).toEqual([0, 0.5]);
	expect(fill.to?.[0]).toBeCloseTo(0.4, 1);
	expect(Math.cos(((fill.angle ?? 0) * Math.PI) / 180)).toBeGreaterThan(0.999);
	expect(await state<number>(page, "s.doc.history.past.length")).toBe(past + 1);
	expect(await pixel(page, 450, 300)).not.toEqual(before);

	await run(page, "c.undo()");
	expect((await fillOf(page, key)).to).toBeUndefined();
	expect(await pixel(page, 450, 300)).toEqual(before);
});

test("dragging the radial radius handle sets the radius", async ({ page }) => {
	await openSample(page);
	const key = await addLayer(page, {
		kind: "radial",
		center: [0.5, 0.5],
		radius: 0.5,
		stops: RED_BLUE,
	});
	// Centre 450,300; the radius is a fraction of the longest side, 500.
	const to = await artboardPoint(page, 450, 400);
	await dragTo(page, "grad:0:radius", to);
	await page.mouse.up();
	await settle(page);
	const fill = await fillOf(page, key);
	expect(fill.radius).toBeCloseTo(0.2, 2);
	expect(fill.rotation).toBeCloseTo(90, 0);
	expect(fill.radiusY).toBeUndefined();
});

test("a stop dot drags along the line, and a click on the line adds one", async ({
	page,
}) => {
	await openSample(page);
	const key = await addLayer(page, {
		kind: "linear",
		angle: 0,
		stops: [...RED_BLUE, { offset: 0.5, color: "#00ff00" }],
	});
	await dragTo(page, "grad:0:stop:2", await artboardPoint(page, 325, 330));
	await page.mouse.up();
	await settle(page);
	let fill = await fillOf(page, key);
	expect(fill.stops.map((s) => s.offset)).toEqual([0, 0.25, 1]);
	expect(fill.stops[1]?.color).toBe("#00ff00");

	const on = await artboardPoint(page, 575, 300);
	await page.mouse.click(on.x, on.y);
	await settle(page);
	fill = await fillOf(page, key);
	expect(fill.stops.map((s) => s.offset)).toEqual([0, 0.25, 0.75, 1]);
	expect(await state<string[]>(page, "s.selection")).toEqual([key]);
});

test("a rotated layer keeps the handle under the pointer", async ({ page }) => {
	await openSample(page);
	const key = await addLayer(
		page,
		{ kind: "linear", angle: 0, stops: RED_BLUE },
		30,
	);
	// Template point 600,380 in the layer's unrotated box: turn it back by 30°
	// about the centre (450,300).
	const p = { x: 600, y: 380 };
	const rad = (-30 * Math.PI) / 180;
	const dx = p.x - 450;
	const dy = p.y - 300;
	const local = {
		x: 450 + dx * Math.cos(rad) - dy * Math.sin(rad),
		y: 300 + dx * Math.sin(rad) + dy * Math.cos(rad),
	};
	const expected = [(local.x - 200) / 500, (local.y - 150) / 300];

	const screen = await artboardPoint(page, p.x, p.y);
	await dragTo(page, "grad:0:to", screen);
	await page.mouse.up();
	await settle(page);
	const fill = await fillOf(page, key);
	expect(fill.to?.[0]).toBeCloseTo(expected[0] as number, 2);
	expect(fill.to?.[1]).toBeCloseTo(expected[1] as number, 2);
	const at = await centre(page, "grad:0:to");
	expect(Math.abs(at.x - screen.x)).toBeLessThan(1.5);
	expect(Math.abs(at.y - screen.y)).toBeLessThan(1.5);
});

test("handles hide for a locked layer and during a move", async ({ page }) => {
	await openSample(page);
	await addLayer(page, { kind: "linear", angle: 0, stops: RED_BLUE });
	const handles = page.getByTestId("gradient-handles");
	await expect(handles).toBeVisible();
	const a = await artboardPoint(page, 260, 200);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(a.x + 20, a.y + 20);
	await page.mouse.move(a.x + 40, a.y + 30);
	await expect(handles).toHaveCount(0);
	await page.mouse.up();
	await expect(handles).toBeVisible();
	const key = await state<string>(page, "s.selection[0]");
	await run(page, `c.toggleLocked(["${key}"]); c.select(["${key}"])`);
	expect(await state<string[]>(page, "s.selection")).toEqual([key]);
	await expect(handles).toHaveCount(0);
});

// Pictures for review, not assertions: GRADIENT_SHOTS names the folder.
const SHOTS = process.env.GRADIENT_SHOTS;
test.describe("screenshots", () => {
	test.skip(!SHOTS, "set GRADIENT_SHOTS to a folder to take them");
	test.use({ deviceScaleFactor: 2 });
	const FILLS: Record<string, Fill> = {
		linear: {
			kind: "linear",
			angle: 28,
			from: [0.1, 0.3],
			to: [0.85, 0.7],
			stops: [
				{ offset: 0, color: "#fde047" },
				{ offset: 0.45, color: "#f43f5e" },
				{ offset: 1, color: "#1e1b4b" },
			],
		},
		radial: {
			kind: "radial",
			center: [0.45, 0.5],
			radius: 0.4,
			radiusY: 0.22,
			rotation: 20,
			stops: [
				{ offset: 0, color: "#ffffff" },
				{ offset: 0.5, color: "#22d3ee" },
				{ offset: 1, color: "#0f172a" },
			],
		},
		angular: {
			kind: "angular",
			center: [0.5, 0.5],
			rotation: 30,
			stops: [
				{ offset: 0, color: "#f43f5e" },
				{ offset: 0.33, color: "#fde047" },
				{ offset: 0.66, color: "#22d3ee" },
				{ offset: 1, color: "#f43f5e" },
			],
		},
	};
	for (const theme of ["light", "dark"])
		for (const [kind, fill] of Object.entries(FILLS))
			test(`${kind} on a rotated layer, ${theme}`, async ({ page }) => {
				await page.goto(`/?theme=${theme}`);
				await page.getByTestId("sample-membership-card").click();
				await expect(page.getByTestId("artboard-canvas")).toBeAttached();
				await settle(page);
				await addLayer(page, fill, -18);
				await page.screenshot({ path: `${SHOTS}/${kind}-${theme}.png` });
				const handles = (await page
					.getByTestId("gradient-handles")
					.boundingBox()) as Box;
				await page.screenshot({
					path: `${SHOTS}/${kind}-${theme}-handles.png`,
					clip: {
						x: handles.x - 40,
						y: handles.y - 40,
						width: handles.width + 80,
						height: handles.height + 80,
					},
				});
				const section = (await page
					.getByTestId("stop-bar")
					.locator("xpath=../..")
					.boundingBox()) as Box;
				await page.screenshot({
					path: `${SHOTS}/${kind}-${theme}-inspector.png`,
					clip: { ...section, y: section.y - 90, height: section.height + 100 },
				});
			});
});
