import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openSample, probePath, run, settle, state } from "./helpers";

// Written by the Figma plugin's encoder; see src/app/handoff.ts.
const coat = readFileSync(
	join(import.meta.dirname, "../src/tests/fixtures/handoff-fflate.txt"),
	"utf8",
).trim();

const url = (page: Page) =>
	page.evaluate(() => `${location.pathname}${location.search}${location.hash}`);

test("#coat= opens the template from Figma and leaves the URL", async ({
	page,
}) => {
	await page.goto(`/edit#coat=${coat}`);
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	expect(await state<string>(page, "t.name")).toBe("Café card from Figma");
	expect(await state<number>(page, "s.workspace.templates.length")).toBe(1);
	await expect.poll(() => url(page)).toBe("/edit");
	await page.reload();
	await expect(page.getByTestId("sample-certificate")).toBeVisible();
});

test("#coat= adds to the unsaved workspace rather than setting it aside", async ({
	page,
}) => {
	await openSample(page, "certificate");
	await run(page, "c.selectAll(); c.nudge(1, 0)");
	await expect
		.poll(() =>
			page.evaluate(async (path) => {
				const { readAutosave } = await import(/* @vite-ignore */ path);
				return (await readAutosave())?.workspace.templates.length ?? 0;
			}, probePath("app-probe")),
		)
		.toBe(1);

	// Figma opens the link in a new tab, so this is a fresh load rather than
	// a change of fragment on the open page.
	await page.goto("about:blank");
	await page.goto(`/edit#coat=${coat}`);
	await expect(
		page.getByText("Added Café card from Figma to your unsaved workspace"),
	).toBeVisible();
	await settle(page);
	expect(await state<number>(page, "s.workspace.templates.length")).toBe(2);
	expect(await state<string>(page, "t.name")).toBe("Café card from Figma");
	const active = await state<string>(page, "s.workspace.activeTemplateId");
	await expect.poll(() => url(page)).toBe(`/edit?template=${active}`);
});

test("an invalid #coat= says why and opens nothing", async ({ page }) => {
	await page.goto("/edit#coat=AAAAAAAA");
	await expect(
		page.getByText(
			"Couldn't open the template from Figma: the link is incomplete or damaged",
		),
	).toBeVisible();
	await expect(page.getByTestId("sample-certificate")).toBeVisible();
	expect(await url(page)).toBe("/edit");
});

for (const hash of ["#open=1", "#drop=1"]) {
	test(`${hash} points at Open file… and leaves the URL`, async ({ page }) => {
		await page.goto(`/edit${hash}`);
		const open = page.getByTestId("welcome-open-file");
		await expect(open).toHaveAttribute("data-hinted", "true");
		await expect(page.getByTestId("open-hint")).toHaveText(
			"Open the .coat file you downloaded from Figma",
		);
		await expect.poll(() => url(page)).toBe("/edit");

		const chooser = page.waitForEvent("filechooser");
		await open.click();
		await (await chooser).setFiles(
			join(import.meta.dirname, "../src/tests/fixtures/handoff-template.json"),
		);
		await expect(page.getByTestId("artboard-canvas")).toBeAttached();
		await settle(page);
		expect(await state<string>(page, "t.name")).toBe("Café card from Figma");

		await page.goto("about:blank");
		await page.goto("/edit");
		await expect(page.getByTestId("sample-certificate")).toBeVisible();
		await expect(page.getByTestId("open-hint")).toHaveCount(0);
		await expect(page.getByTestId("welcome-open-file")).not.toHaveAttribute(
			"data-hinted",
		);
	});
}

test("#open=1 over an opened sample says so in a toast", async ({ page }) => {
	await page.goto("/edit?sample=certificate#open=1");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	const hint = page.getByText("Open the .coat file you downloaded from Figma");
	await expect(hint).toBeVisible();
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Open file…" }).click();
	await chooser;
});

test("a file dropped on the welcome screen is not opened", async ({ page }) => {
	await page.goto("/edit");
	await expect(page.getByTestId("sample-certificate")).toBeVisible();
	const prevented = await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.items.add(
			new File(["{}"], "card.coat.json", { type: "application/json" }),
		);
		const main = document.querySelector("main") as HTMLElement;
		main.dispatchEvent(
			new DragEvent("dragover", {
				bubbles: true,
				cancelable: true,
				dataTransfer: dt,
			}),
		);
		const drop = new DragEvent("drop", {
			bubbles: true,
			cancelable: true,
			dataTransfer: dt,
		});
		main.dispatchEvent(drop);
		return drop.defaultPrevented;
	});
	// Refused rather than left to the browser, which would navigate to it.
	expect(prevented).toBe(true);
	// Long enough for a file this small to have opened, had it been taken.
	await page.waitForTimeout(500);
	await expect(page.getByTestId("sample-certificate")).toBeVisible();
	expect(await url(page)).toBe("/edit");
});
