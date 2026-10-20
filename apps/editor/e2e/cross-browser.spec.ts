import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { addDataset, chooseDataset, mod, openSample } from "./helpers";

test("a zip export downloads without the file pickers", {
	tag: "@smoke",
}, async ({ page }) => {
	await openSample(page);
	await addDataset(page, "d_members", "Members", 2);
	await page.keyboard.press(`${mod}+3`);
	await page
		.getByTestId("export-presets")
		.getByRole("button", { name: "New preset" })
		.click();
	await page.getByRole("menuitem", { name: "Blank preset" }).click();
	await chooseDataset(page, "Members");

	const pending = page.waitForEvent("download", { timeout: 120_000 });
	await page.getByRole("button", { name: "Export 4 files" }).click();
	const file = await pending;
	expect(file.suggestedFilename()).toBe("new_preset.zip");
	const entries = unzipSync(new Uint8Array(await readFile(await file.path())));
	const names = Object.keys(entries);
	expect(names.filter((n) => n.endsWith(".png"))).toHaveLength(4);
	const report = strFromU8(entries["export-report.csv"] as Uint8Array)
		.trim()
		.split("\r\n");
	expect(report.slice(1).every((line) => line.includes(",ok,"))).toBe(true);
});
