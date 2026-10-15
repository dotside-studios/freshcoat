import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openSample, probePath, run, settle, state } from "./helpers";

const GOLDENS = join(
	import.meta.dirname,
	"../../../packages/engine/tests/fixtures/texture",
);

for (const name of [
	"grain",
	"halftone",
	"halftone-cmyk",
	"halftone-adjacent-page",
	"halftone-adjacent-element",
	"halftone-rotated-page",
	"halftone-rotated-element",
])
	for (const scale of [1, 2])
		test(`${name} at ${scale}x paints the pixels Node paints`, async ({
			page,
		}) => {
			await page.goto("/");
			await page.waitForLoadState("networkidle");
			const golden = [...readFileSync(join(GOLDENS, `${name}@${scale}x.png`))];
			const out = await page.evaluate(
				async ({ path, name, scale, golden }) => {
					const mod = await import(/* @vite-ignore */ path);
					return mod.diffGolden(name, scale, golden);
				},
				{ path: probePath("texture-probe"), name, scale, golden },
			);
			expect(out.warnings).toEqual([]);
			expect(out.total).toBe(120 * 80 * 4 * scale * scale);
			expect(out.differing).toBe(0);
		});

// Sum of RGB over a template-space box of the painted artboard.
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

test("the canvas previews grain and a halftone as they are edited", async ({
	page,
}) => {
	await openSample(page);
	await run(page, `c.select(["0/6"])`);
	const box = { x: 64, y: 396, width: 660, height: 70 };
	const inspector = page.getByTestId("design-inspector");
	const before = await regionSum(page, box);

	// The name is white, which a halftone screens to no dots until inverted.
	await inspector.getByRole("button", { name: "Add effect" }).click();
	await page.getByRole("menuitem", { name: "Halftone" }).click();
	await inspector.getByRole("button", { name: "Halftone settings" }).click();
	await page.getByRole("checkbox", { name: "Invert" }).check({ force: true });
	await settle(page);
	const screened = await regionSum(page, box);
	expect(screened).not.toBe(before);
	expect(
		await state(page, "c.template.template_data[0].elements[6].effects"),
	).toEqual([{ type: "halftone", cellSize: 6, invert: true }]);

	const cell = page.getByRole("spinbutton", {
		name: "Halftone cell size",
	});
	await cell.fill("12");
	await cell.press("Enter");
	await settle(page);
	expect(await regionSum(page, box)).not.toBe(screened);

	await page.getByRole("button", { name: "Close" }).click();
	await inspector.getByRole("button", { name: "Halftone visible" }).click();
	await settle(page);
	expect(await regionSum(page, box)).toBe(before);

	// Overlay leaves white as it is, so the white name takes multiply.
	await inspector.getByRole("button", { name: "Add effect" }).click();
	await page.getByRole("menuitem", { name: "Grain" }).click();
	await inspector.getByRole("button", { name: "Grain settings" }).click();
	await page.getByRole("button", { name: /Grain blend mode/ }).click();
	await page.getByRole("option", { name: "Multiply" }).click();
	await settle(page);
	expect(await regionSum(page, box)).not.toBe(before);
	expect(
		await state(page, "c.template.template_data[0].elements[6].effects"),
	).toEqual([
		{ type: "halftone", cellSize: 12, invert: true, hidden: true },
		{ type: "grain", amount: 0.25, blendMode: "multiply" },
	]);
});
