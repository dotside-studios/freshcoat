import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { probePath } from "./helpers";

test("a kept photo stays readable after its file changes in an in-memory profile", async ({
	browser,
}) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	const dir = await mkdtemp(join(tmpdir(), "freshcoat-autosave-"));
	const path = join(dir, "photo.jpg");
	await writeFile(path, Uint8Array.from([1, 2, 3, 4]));

	await page.goto("/");
	await page.evaluate(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.id = "autosave-probe-input";
		document.body.append(input);
	});
	await page.locator("#autosave-probe-input").setInputFiles(path);
	const size = await page.evaluate(async (probe) => {
		const { keepPicked } = await import(/* @vite-ignore */ probe);
		return keepPicked(
			document.getElementById("autosave-probe-input") as HTMLInputElement,
		);
	}, probePath("autosave-probe"));
	expect(size).toBe(4);

	await appendFile(path, Uint8Array.from([5, 6]));

	const kept = await page.evaluate(async (probe) => {
		const { readKept } = await import(/* @vite-ignore */ probe);
		return readKept();
	}, probePath("autosave-probe"));
	expect(kept).toEqual({ bytes: [1, 2, 3, 4] });
	await context.close();
});
