import { join } from "node:path";
import { expect, type FrameLocator, test } from "@playwright/test";
import { openState, status, type Theme } from "./harness";

// A picture of every state, in both themes, for review by eye. They are
// compared with nothing. Set HARNESS_SHOTS to the directory to write them to;
// without it the suite is skipped.
//
// 320 by 480 is the window the plugin opens at and is designed for, so every
// state is taken there; 400 by 600 checks that a larger window lets the same
// layout breathe, and the widest size a few states at a size people drag to.
// Taken at 2x, so 11 px text can be read in the picture.
const dir = process.env.HARNESS_SHOTS;

type Shot = {
	name: string;
	state: string;
	/** Also taken at the widest size. */
	wide?: boolean;
	prepare?: (ui: FrameLocator) => Promise<void>;
};

const SHOTS: Shot[] = [
	{ name: "layer-empty", state: "layer-empty" },
	{ name: "layer-unbound", state: "layer-unbound" },
	{
		name: "layer-show-when",
		state: "layer-unbound",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: /Show when/ }).click();
		},
	},
	{ name: "layer-bound", wide: true, state: "layer-bound" },
	{ name: "layer-barcode", state: "layer-barcode" },
	{
		name: "layer-applied",
		state: "layer-bound-single",
		prepare: async (ui) => {
			await ui.getByLabel("Label").fill("Member number");
			await ui.getByRole("button", { name: "Apply" }).click();
			await expect(
				ui.getByRole("tabpanel").getByText("Applied", { exact: true }),
			).toBeVisible();
		},
	},
	{
		name: "layer-confirm",
		state: "layer-bound-single",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Unbind" }).click();
		},
	},
	{ name: "fields-empty", state: "fields-empty" },
	{ name: "fields", wide: true, state: "fields" },
	{ name: "export-start", state: "export-start" },
	{
		name: "export-canvas",
		state: "export",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Canvas, done" }).click();
		},
	},
	{
		name: "export-frames",
		state: "export-davi",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Frames, done" }).click();
		},
	},
	{
		name: "export-details",
		state: "export",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Details, done" }).click();
		},
	},
	{ name: "export-ready", wide: true, state: "export" },
	{
		name: "export-progress",
		state: "export-hang",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Export .coat" }).click();
			await expect(ui.getByRole("progressbar")).toHaveAttribute(
				"aria-valuenow",
				/\d+/,
			);
		},
	},
	{
		name: "export-result",
		state: "export",
		wide: true,
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Export .coat" }).click();
			await expect(ui.getByText("Download again")).toBeVisible();
		},
	},
	{
		name: "export-result-scrolled",
		state: "export",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Export .coat" }).click();
			await ui.getByRole("button", { name: "Show codes" }).click();
			await ui
				.getByRole("button", { name: "Hide codes" })
				.scrollIntoViewIfNeeded();
		},
	},
	{
		name: "export-error",
		state: "export-fail",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Export .coat" }).click();
			await expect(status(ui)).toHaveText("Couldn't read the frames");
		},
	},
	{
		name: "export-blocked",
		state: "export-blocked",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Export .coat" }).click();
			await expect(
				ui.getByRole("button", { name: "Export anyway" }),
			).toBeVisible();
		},
	},
	{
		name: "export-wrong-size",
		state: "export-davi",
		prepare: async (ui) => {
			await ui.getByRole("button", { name: "Export .coat" }).click();
			await expect(
				ui.getByRole("button", { name: "Resize" }).first(),
			).toBeVisible();
		},
	},
	{ name: "settings", state: "settings" },
	{
		name: "settings-invalid",
		state: "settings-empty",
		prepare: async (ui) => {
			await ui.getByLabel("Address").fill("http://freshcoat.example");
		},
	},
];

const COMPACT = { width: 320, height: 480 };
const MEDIUM = { width: 400, height: 600 };
const WIDE = { width: 480, height: 720 };
const THEMES: Theme[] = ["light", "dark"];

test.describe("screenshots", () => {
	test.skip(!dir, "set HARNESS_SHOTS to take them");
	test.use({ deviceScaleFactor: 2 });
	for (const shot of SHOTS) {
		const sizes = shot.wide ? [COMPACT, MEDIUM, WIDE] : [COMPACT, MEDIUM];
		for (const theme of THEMES) {
			for (const size of sizes) {
				const file = `${shot.name}-${theme}-${size.width}x${size.height}.png`;
				test(file, async ({ page }) => {
					const ui = await openState(page, shot.state, { theme, ...size });
					await shot.prepare?.(ui);
					// Thumbnails arrive a message later; let the last one paint.
					await page.waitForTimeout(150);
					await page.locator("iframe").screenshot({
						path: join(dir ?? "", file),
						animations: "disabled",
					});
				});
			}
		}
	}
});
