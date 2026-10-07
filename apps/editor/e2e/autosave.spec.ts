import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { probePath } from "./helpers";

const PROBE = probePath("autosave-probe");

// Findings in Chromium 141 with a persistent profile: once a picked file
// changes on disk, reading its slice throws NotReadableError, but an
// IndexedDB put of it does not throw. The transaction aborts with DataError
// instead. In an incognito profile the put commits and keeps a reference to
// the file, so the stored copy cannot be read either. Firefox is not checked:
// only Chromium is installed for these tests.
test("autosave skips a photo whose file changed on disk and still saves", async ({
	browserName,
}, info) => {
	test.skip(
		browserName !== "chromium",
		"launches Chromium with a profile on disk",
	);
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-autosave-"));
	const changed = join(dir, "changed.png");
	const kept = join(dir, "kept.png");
	writeFileSync(changed, Buffer.alloc(4096, 1));
	writeFileSync(kept, Buffer.alloc(4096, 2));
	// IndexedDB stores blobs as it would for a user only on a profile on disk.
	const context = await chromium.launchPersistentContext(join(dir, "profile"), {
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
		baseURL: info.project.use.baseURL,
	});
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto("/");
		await page.evaluate(() => {
			const input = document.createElement("input");
			input.type = "file";
			input.multiple = true;
			input.dataset.testid = "autosave-photos";
			input.hidden = true;
			document.body.appendChild(input);
		});
		await page.setInputFiles("[data-testid=autosave-photos]", [changed, kept]);
		await page.evaluate(async (path) => {
			const probe = await import(/* @vite-ignore */ path);
			(window as unknown as { probe: unknown }).probe = await probe.pickAssets(
				"[data-testid=autosave-photos]",
			);
		}, PROBE);

		appendFileSync(changed, Buffer.alloc(16, 3));

		const raw = await page.evaluate(async (path) => {
			const probe = await import(/* @vite-ignore */ path);
			const { assets } = (
				window as unknown as { probe: { assets: { blob: Blob }[] } }
			).probe;
			return probe.rawPut(assets[0]?.blob);
		}, PROBE);
		info.annotations.push({
			type: "raw put",
			description: JSON.stringify(raw),
		});
		expect(raw.transaction).not.toBe("complete");

		const out = await page.evaluate(async (path) => {
			const probe = await import(/* @vite-ignore */ path);
			return probe.runAutosave((window as unknown as { probe: unknown }).probe);
		}, PROBE);
		expect(out).toEqual({
			saved: true,
			assets: ["kept.png"],
			missingAssets: 1,
			unreadable: ["changed.png"],
		});
	} finally {
		await context.close();
	}
});
