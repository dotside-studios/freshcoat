import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, type Page, test } from "@playwright/test";
import { openSample, probePath, run, state } from "./helpers";

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

test("a kept photo stays readable after its file changes in an incognito profile", async ({
	browser,
}) => {
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-autosave-"));
	const photo = join(dir, "photo.png");
	writeFileSync(photo, Buffer.alloc(4096, 1));
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.goto("/");
		await page.evaluate(() => {
			const input = document.createElement("input");
			input.type = "file";
			input.dataset.testid = "autosave-photos";
			input.hidden = true;
			document.body.appendChild(input);
		});
		await page.setInputFiles("[data-testid=autosave-photos]", photo);
		const size = await page.evaluate(async (path) => {
			const probe = await import(/* @vite-ignore */ path);
			const picked = await probe.pickAssets("[data-testid=autosave-photos]");
			(window as unknown as { probe: unknown }).probe = picked;
			return probe.keepFirst(picked);
		}, PROBE);
		expect(size).toBe(4096);

		appendFileSync(photo, Buffer.alloc(16, 3));

		const kept = await page.evaluate(async (path) => {
			const probe = await import(/* @vite-ignore */ path);
			return probe.readKept((window as unknown as { probe: unknown }).probe);
		}, PROBE);
		expect(kept).toEqual({ bytes: 4096 });
	} finally {
		await context.close();
	}
});

test("Recent lists the autosaved workspace and the samples opened, and reopens them", async ({
	page,
}) => {
	await openSample(page, "certificate");
	await page.goto("/");
	const recent = page.getByRole("region", { name: "Recent" });
	await expect(recent.getByText("Certificate")).toBeVisible();
	await expect(recent.getByText(/^Sample · /)).toBeVisible();

	await openSample(page, "minimal");
	await run(page, `c.select(["0/0"]); c.deleteSelection();`);
	await expect
		.poll(
			() =>
				page.evaluate(async (path) => {
					const { readAutosave } = await import(/* @vite-ignore */ path);
					return (await readAutosave())?.recentId ?? null;
				}, probePath("app-probe")),
			{ timeout: 10_000 },
		)
		.not.toBeNull();
	await page.goto("/");
	await expect(page.getByTestId("restore-banner")).toBeVisible();
	const unsaved = recent.getByRole("button", { name: /Unsaved work · / });
	await expect(unsaved).toBeVisible();
	await expect(
		unsaved.getByTestId("thumbnail"),
		"draws the autosaved template",
	).toBeVisible({ timeout: 30_000 });

	await unsaved.click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	expect(await state<number>(page, "t.template_data[0].elements.length")).toBe(
		0,
	);

	await page.goto("/");
	await recent.getByRole("button", { name: /^Remove Certificate/ }).click();
	await expect(recent.getByText("Certificate")).toBeHidden();
	await expect
		.poll(() =>
			page.evaluate(async (path) => {
				const { recentStore } = await import(/* @vite-ignore */ path);
				const entries: { name: string }[] = await recentStore().list();
				return entries.map((e) => e.name);
			}, probePath("app-probe")),
		)
		.not.toContain("Certificate");
	await page.reload();
	await expect(
		recent.getByRole("button", { name: /Unsaved work · / }),
	).toBeVisible();
	await expect(recent.getByText("Certificate")).toBeHidden();

	await page.getByRole("button", { name: "Dismiss" }).click();
	await expect
		.poll(() =>
			page.evaluate(async (path) => {
				const { readAutosave } = await import(/* @vite-ignore */ path);
				return await readAutosave();
			}, probePath("app-probe")),
		)
		.toBeNull();
	await page.reload();
	await expect(page.getByTestId("starter-davi-card")).toBeVisible();
	await expect(recent.getByText("Unsaved work", { exact: false })).toBeHidden();
});

for (const hide of ["visibilitychange", "pagehide"] as const) {
	test(`autosave is written as soon as the page fires ${hide}`, async ({
		page,
	}) => {
		await openSample(page);
		const elapsed = await page.evaluate(async (event) => {
			const c = (
				window as unknown as {
					__freshcoat: {
						controller: {
							select(keys: string[]): void;
							deleteSelection(): void;
						};
					};
				}
			).__freshcoat.controller;
			const started = performance.now();
			c.select(["0/0"]);
			c.deleteSelection();
			if (event === "visibilitychange") {
				Object.defineProperty(document, "visibilityState", {
					configurable: true,
					get: () => "hidden",
				});
				document.dispatchEvent(new Event("visibilitychange"));
			} else window.dispatchEvent(new Event("pagehide"));
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("freshcoat");
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			for (;;) {
				const found = await new Promise<unknown>((resolve) => {
					const req = db
						.transaction("autosave")
						.objectStore("autosave")
						.get("current");
					req.onsuccess = () => resolve(req.result);
				});
				if (found) return performance.now() - started;
				await new Promise((r) => setTimeout(r, 20));
			}
		}, hide);
		expect(elapsed).toBeLessThan(900);
	});
}

/** Makes the autosave store's reads throw until the page sets
 *  `__autosaveFixed`. */
async function breakAutosaveReads(page: Page) {
	await page.addInitScript(() => {
		const get = IDBObjectStore.prototype.get;
		IDBObjectStore.prototype.get = function (
			this: IDBObjectStore,
			key: IDBValidKey | IDBKeyRange,
		) {
			if (
				this.name === "autosave" &&
				!(window as unknown as { __autosaveFixed?: boolean }).__autosaveFixed
			)
				throw new DOMException("broken", "UnknownError");
			return get.call(this, key);
		};
	});
}

function fixAutosaveReads(page: Page) {
	return page.evaluate(() => {
		(window as unknown as { __autosaveFixed: boolean }).__autosaveFixed = true;
	});
}

function storedSavedAt(page: Page): Promise<number | null> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open("freshcoat");
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		try {
			const doc = await new Promise<{ savedAt: number } | undefined>(
				(resolve, reject) => {
					const req = db
						.transaction("autosave")
						.objectStore("autosave")
						.get("current");
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				},
			);
			return doc?.savedAt ?? null;
		} finally {
			db.close();
		}
	});
}

async function seedThenFailRead(page: Page): Promise<number> {
	await openSample(page, "minimal");
	await run(page, `c.select(["0/0"]); c.deleteSelection();`);
	await expect.poll(() => storedSavedAt(page)).not.toBeNull();
	const savedAt = (await storedSavedAt(page)) as number;

	await breakAutosaveReads(page);
	await openSample(page, "certificate");
	const blocked = page
		.getByRole("alertdialog")
		.filter({ hasText: "Couldn't read autosave. New edits aren't autosaved." });
	await expect(blocked).toBeVisible();
	await blocked.getByRole("button", { name: "Dismiss" }).click();
	await expect(blocked).toBeHidden();
	await run(page, `c.select(["0/0"]); c.deleteSelection();`);
	await expect(blocked).toBeVisible();
	await fixAutosaveReads(page);
	expect(await storedSavedAt(page)).toBe(savedAt);
	return savedAt;
}

test("a failed autosave read keeps the old autosave and Retry offers it back", async ({
	page,
}) => {
	const savedAt = await seedThenFailRead(page);
	await page.getByRole("button", { name: "Retry" }).click();
	await expect(
		page.getByText("Couldn't read autosave. New edits aren't autosaved."),
	).toBeHidden();
	await expect(page.getByText(/^Unsaved work from /)).toBeVisible();
	expect(await storedSavedAt(page)).toBe(savedAt);
});

test("discarding an autosave that failed to read starts autosaving again", async ({
	page,
}) => {
	const savedAt = await seedThenFailRead(page);
	await page.getByRole("button", { name: "Discard old autosave" }).click();
	await expect(
		page.getByText("Couldn't read autosave. New edits aren't autosaved."),
	).toBeHidden();
	await expect.poll(() => storedSavedAt(page)).toBeGreaterThan(savedAt);
});

async function dismissToastsThenOpenPaused(page: Page) {
	const savedAt = await seedThenFailRead(page);
	const blocked = page
		.getByRole("alertdialog")
		.filter({ hasText: "Couldn't read autosave. New edits aren't autosaved." });
	await blocked.getByRole("button", { name: "Dismiss" }).click();
	await expect(blocked).toBeHidden();
	await run(page, `c.select(["0/0"]); c.deleteSelection();`);
	await page.waitForTimeout(1500);
	await expect(blocked).toBeHidden();
	await page.getByRole("button", { name: "Autosave paused" }).click();
	const popover = page.getByRole("dialog", { name: "Autosave paused" });
	await expect(popover).toBeVisible();
	return { savedAt, popover };
}

test("the paused indicator offers Retry after the toasts are dismissed", async ({
	page,
}) => {
	const { savedAt, popover } = await dismissToastsThenOpenPaused(page);
	await popover.getByRole("button", { name: "Retry" }).click();
	await expect(page.getByText(/^Unsaved work from /)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Autosave paused" }),
	).toBeHidden();
	expect(await storedSavedAt(page)).toBe(savedAt);
});

test("the paused indicator offers Discard after the toasts are dismissed", async ({
	page,
}) => {
	const { savedAt, popover } = await dismissToastsThenOpenPaused(page);
	await popover.getByRole("button", { name: "Discard old autosave" }).click();
	await expect(
		page.getByRole("button", { name: "Autosave paused" }),
	).toBeHidden();
	await expect.poll(() => storedSavedAt(page)).toBeGreaterThan(savedAt);
});

test("leaving warns while autosave is paused and edits are unsaved", async ({
	page,
}) => {
	await seedThenFailRead(page);
	await expect(
		page.getByRole("button", { name: "Autosave paused" }),
	).toBeVisible();
	const warns = await page.evaluate(() => {
		const event = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(warns).toBe(true);
});
