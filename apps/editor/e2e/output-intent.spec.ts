import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { iccProfile } from "@freshcoat-js/test-utils";
import { expect, type Page, test } from "@playwright/test";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	type PDFHexString,
	PDFName,
	type PDFRawStream,
} from "pdf-lib";
import { mod, settingsTab, settle } from "./helpers";

// FRESHCOAT_SHOTS=<dir> also saves pictures of the Color group in each state
// and theme, for review.
const SHOTS = process.env.FRESHCOAT_SHOTS;

async function openPdfPreset(page: Page, theme: string) {
	await page.goto(`/?theme=${theme}`);
	await page.getByTestId("sample-membership-card").click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	await page.keyboard.press(`${mod}+3`);
	await page
		.getByTestId("export-presets")
		.getByRole("button", { name: "New preset" })
		.click();
	await page.getByRole("menuitem", { name: "Blank preset" }).click();
	const settings = page.getByTestId("export-settings");
	await settingsTab(page, "Output");
	await settings
		.getByRole("radiogroup", { name: "Format" })
		.getByRole("radio", { name: "PDF" })
		.click();
	await settingsTab(page, "Print");
	return settings;
}

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	await page
		.getByTestId("export-settings")
		.screenshot({ path: join(SHOTS, `${name}-panel.png`) });
	await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** The intents the PDF's catalog declares. */
async function intents(bytes: Uint8Array) {
	const doc = await PDFDocument.load(bytes);
	const list = doc.catalog.lookupMaybe(PDFName.of("OutputIntents"), PDFArray);
	return (list?.asArray() ?? []).map((ref) => {
		const intent = doc.context.lookup(ref, PDFDict);
		const dest = doc.context.lookup(
			intent.get(PDFName.of("DestOutputProfile")),
		) as PDFRawStream;
		return {
			id: (
				intent.lookup(PDFName.of("OutputConditionIdentifier")) as PDFHexString
			).decodeText(),
			n: dest.dict.get(PDFName.of("N"))?.toString(),
			bytes: decodePDFRawStream(dest).decode().length,
		};
	});
}

for (const theme of ["light", "dark"] as const) {
	test(`a PDF preset declares sRGB or a custom profile (${theme})`, async ({
		page,
	}) => {
		test.setTimeout(240_000);
		const settings = await openPdfPreset(page, theme);
		const group = settings.getByTestId("export-output-intent");
		const hint = settings.getByTestId("export-output-intent-hint");
		await expect(
			group.getByRole("button", { name: /Output intent/ }),
		).toContainText("sRGB");
		await expect(hint).toHaveText(
			"Declares sRGB, the space cards are drawn in",
		);
		await shot(page, `${theme}-srgb`);

		const input = group.locator("input[type=file]");
		await input.setInputFiles({
			name: "lab.icc",
			mimeType: "application/vnd.iccprofile",
			buffer: Buffer.from(iccProfile({ space: "Lab " })),
		});
		await expect(settings.getByTestId("export-output-intent-error")).toHaveText(
			'Couldn\'t use lab.icc: its colour space "Lab" is not gray, RGB or CMYK',
		);
		await shot(page, `${theme}-error`);

		const fogra = iccProfile({
			description: "Coated FOGRA39 (ISO 12647-2:2004)",
		});
		await input.setInputFiles({
			name: "CoatedFOGRA39.icc",
			mimeType: "application/vnd.iccprofile",
			buffer: Buffer.from(fogra),
		});
		await expect(
			group.getByRole("button", { name: /Output intent/ }),
		).toContainText("Coated FOGRA39 (ISO 12647-2:2004)");
		await expect(hint).toHaveText(
			"Cards stay sRGB; the printer converts them to this profile",
		);
		await shot(page, `${theme}-profile`);

		await group.getByRole("button", { name: /Output intent/ }).click();
		await shot(page, `${theme}-menu`);
		await page.keyboard.press("Escape");

		const pending = page.waitForEvent("download", { timeout: 180_000 });
		await page.getByRole("button", { name: /^Export \d+ files?$/ }).click();
		const bytes = new Uint8Array(await readFile(await (await pending).path()));
		expect(await intents(bytes)).toEqual([
			{ id: "Coated FOGRA39 (ISO 12647-2:2004)", n: "4", bytes: fogra.length },
		]);
	});
}
