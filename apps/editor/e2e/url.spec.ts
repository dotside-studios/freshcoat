import { expect, type Page, test } from "@playwright/test";
import { openSample, probePath, run, settle, state } from "./helpers";

async function bindRecords(page: Page, names: string[]) {
	await page.evaluate(
		async ({ path, names }) => {
			const { bindSampleRecords } = await import(/* @vite-ignore */ path);
			bindSampleRecords(names);
		},
		{ path: probePath("record-probe"), names },
	);
	await settle(page);
}

/** Waits until autosave holds a workspace with `templates` templates. */
async function autosaved(page: Page, templates: number) {
	await expect
		.poll(
			() =>
				page.evaluate(async (path) => {
					const { readAutosave } = await import(/* @vite-ignore */ path);
					const saved = await readAutosave();
					return saved?.workspace.templates.length ?? 0;
				}, probePath("app-probe")),
			{ timeout: 10_000 },
		)
		.toBe(templates);
}

async function reloadAndRestore(page: Page) {
	await page.reload();
	await page
		.getByTestId("restore-banner")
		.getByRole("button", { name: "Restore" })
		.click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
}

const entries = (page: Page) => page.evaluate(() => history.length);

const url = (page: Page) =>
	page.evaluate(() => `${location.pathname}${location.search}${location.hash}`);

test("a reload restores the template, side and record from the URL", async ({
	page,
}) => {
	await openSample(page, "minimal");
	await run(page, `return c.openSample("membership-card")`);
	await bindRecords(page, ["Ana", "Ben", "Cy"]);
	const second = await state<string>(page, "s.workspace.activeTemplateId");
	expect(second).not.toBe(
		await state<string>(page, "s.workspace.templates[0].id"),
	);
	await run(
		page,
		`c.previewRecord("r_1"); c.dispatch({ type: "setSide", side: 1 })`,
	);
	await expect
		.poll(() => url(page))
		.toBe(`/edit?template=${second}&side=back&record=r_1`);
	await autosaved(page, 2);

	await reloadAndRestore(page);
	expect(await state<string>(page, "s.workspace.activeTemplateId")).toBe(
		second,
	);
	expect(await state<number>(page, "s.side")).toBe(1);
	expect(await state<string>(page, "s.previewRecordId")).toBe("r_1");
	expect(await state<string>(page, "s.values.display_name")).toBe("Ben");
	expect(await url(page)).toBe(`/edit?template=${second}&side=back&record=r_1`);
});

test("a reload restores the section from the path", async ({ page }) => {
	await openSample(page);
	await bindRecords(page, ["Ana"]);
	await page.getByTestId("section-switcher").getByText("Data").click();
	await expect(page.getByTestId("section-data")).toBeVisible();
	await expect.poll(() => url(page)).toBe("/data");
	await autosaved(page, 1);

	await page.reload();
	await page
		.getByTestId("restore-banner")
		.getByRole("button", { name: "Restore" })
		.click();
	await expect(page.getByTestId("section-data")).toBeVisible();
	expect(await state<string>(page, "s.section")).toBe("data");
});

test("unknown ids in the URL are ignored and rewritten", async ({ page }) => {
	await page.goto("/export?template=t_gone&side=middle&record=r_x&zoom=2");
	await page.getByTestId("sample-membership-card").click();
	await expect(page.getByTestId("section-export")).toBeVisible();
	expect(await state<number>(page, "s.side")).toBe(0);
	await expect.poll(() => url(page)).toBe("/export");
});

test("a phase 3 hash link redirects, then applies", async ({ page }) => {
	await page.goto("/edit");
	const before = await entries(page);
	await page.goto("/#section=export&template=t_gone&side=middle&record=r_x");
	await expect
		.poll(() => url(page))
		.toBe("/export?template=t_gone&side=middle&record=r_x");
	await page.getByTestId("sample-membership-card").click();
	await expect(page.getByTestId("section-export")).toBeVisible();
	await expect.poll(() => url(page)).toBe("/export");
	// The redirect and the rewrite replace the entry the link made.
	expect(await entries(page)).toBe(before + 1);
});

test("a hash typed over an open workspace is applied", async ({ page }) => {
	await openSample(page);
	await page.evaluate(() => {
		location.hash = "#section=data";
	});
	await expect(page.getByTestId("section-data")).toBeVisible();
	await expect.poll(() => url(page)).toBe("/data");
});

test("?kit and ?bench links reach their routes", async ({ page }) => {
	await page.goto("/edit");
	const before = await entries(page);
	await page.goto("/?kit&theme=dark");
	await expect.poll(() => url(page)).toBe("/kit?theme=dark");
	await expect(page.getByRole("heading").first()).toBeVisible();
	await expect(page.getByTestId("sample-membership-card")).toHaveCount(0);
	expect(await entries(page)).toBe(before + 1);

	await page.goto("/?bench&sample=minimal&frames=5");
	await expect.poll(() => url(page)).toBe("/bench?sample=minimal&frames=5");
	await expect(page.getByTestId("bench-panel")).toBeVisible();
	await page.waitForFunction(
		() =>
			(window as unknown as { __freshcoatBench?: unknown }).__freshcoatBench,
		undefined,
		{ timeout: 120_000 },
	);
	// The bench opens its own sample and leaves its URL alone.
	expect(await url(page)).toBe("/bench?sample=minimal&frames=5");
	expect(await state<string>(page, "t.name")).toBe("Minimal");
});

test("a /data link opens in Data once a workspace opens", async ({ page }) => {
	await page.goto("/data?theme=dark");
	await page.getByTestId("sample-membership-card").click();
	await expect(page.getByTestId("section-data")).toBeVisible();
	expect(await state<string>(page, "s.section")).toBe("data");
	await expect.poll(() => url(page)).toBe("/data?theme=dark");
});

test("Back after switching sections returns to the previous one", async ({
	page,
}) => {
	await openSample(page);
	const switcher = page.getByTestId("section-switcher");
	await switcher.getByText("Data").click();
	await expect.poll(() => url(page)).toBe("/data");
	await switcher.getByText("Export").click();
	await expect.poll(() => url(page)).toBe("/export");

	await page.goBack();
	await expect(page.getByTestId("section-data")).toBeVisible();
	expect(await state<string>(page, "s.section")).toBe("data");
	await page.goBack();
	await expect(page.getByTestId("section-edit")).toBeVisible();
	expect(await url(page)).toBe("/edit");
	await page.goForward();
	await expect(page.getByTestId("section-data")).toBeVisible();
});

test("?sample= opens the sample and leaves the URL", async ({ page }) => {
	await page.goto("/?sample=certificate");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	expect(await state<string>(page, "t.name")).toBe("Certificate");
	await expect.poll(() => url(page)).toBe("/edit");
	await page.reload();
	await expect(page.getByTestId("sample-certificate")).toBeVisible();
});

test("?new= starts a document from a preset and keeps the theme", async ({
	page,
}) => {
	await page.goto("/?new=square&theme=dark");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	expect(await state<number>(page, "t.width")).toBe(1080);
	await expect.poll(() => url(page)).toBe("/edit?theme=dark");
});

test("stepping records adds no history entries", async ({ page }) => {
	await openSample(page);
	await bindRecords(
		page,
		Array.from({ length: 25 }, (_, i) => `Member ${i + 1}`),
	);
	const before = await page.evaluate(() => history.length);
	const next = page.getByRole("button", { name: "Next record" });
	for (let i = 0; i < 20; i++) await next.click();
	await settle(page);
	expect(await state<string>(page, "s.previewRecordId")).toBe("r_19");
	await expect.poll(() => url(page)).toBe("/edit?record=r_19");
	expect(await page.evaluate(() => history.length)).toBe(before);
});

test("an open intent wins over the restore offer, which stays available", async ({
	page,
}) => {
	await openSample(page);
	await bindRecords(page, ["Ana"]);
	await autosaved(page, 1);

	await page.goto("/?sample=certificate");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	expect(await state<string>(page, "t.name")).toBe("Certificate");
	const offer = page.getByText(/Unsaved work from /);
	await expect(offer).toBeVisible();
	await page.getByRole("button", { name: "Restore" }).click();
	await settle(page);
	expect(await state<string>(page, "t.name")).toBe("Membership card");
	expect(await state<number>(page, "s.workspace.datasets.length")).toBe(1);
});

test("switching sections keeps the canvas mounted", async ({ page }) => {
	await openSample(page);
	await page
		.getByTestId("artboard-canvas")
		.evaluate((el) => el.setAttribute("data-marked", "1"));
	const switcher = page.getByTestId("section-switcher");
	await switcher.getByText("Data").click();
	await expect.poll(() => url(page)).toBe("/data");
	await switcher.getByText("Export").click();
	await expect.poll(() => url(page)).toBe("/export");
	await page.goBack();
	await page.goBack();
	await expect(page.getByTestId("section-edit")).toBeVisible();
	await expect(page.getByTestId("artboard-canvas")).toHaveAttribute(
		"data-marked",
		"1",
	);
});

test("a phase 3 hash left in a tab still restores its view", async ({
	page,
}) => {
	await openSample(page);
	await bindRecords(page, ["Ana", "Ben"]);
	await run(page, `c.dispatch({ type: "setSide", side: 1 })`);
	await expect.poll(() => url(page)).toBe("/edit?side=back");
	await autosaved(page, 1);

	await page.goto("/#section=export&record=r_1");
	await expect.poll(() => url(page)).toBe("/export?record=r_1");
	await page
		.getByTestId("restore-banner")
		.getByRole("button", { name: "Restore" })
		.click();
	await expect(page.getByTestId("section-export")).toBeVisible();
	expect(await state<string>(page, "s.recordId")).toBe("r_1");
	await expect.poll(() => url(page)).toBe("/export?record=r_1");
});
