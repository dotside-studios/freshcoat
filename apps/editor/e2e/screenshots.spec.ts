import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import {
	dragTemplate,
	mod,
	probePath,
	run,
	settingsTab,
	settle,
	state,
	stubGoogleFonts,
} from "./helpers";

// Not assertions: pictures of each state at each size and in each theme, for
// a person to review.
const SIZES = [
	{ name: "desktop", width: 1440, height: 900, touch: false },
	{ name: "tablet", width: 1024, height: 768, touch: true },
	{ name: "narrow", width: 820, height: 1180, touch: true },
];
const THEMES = ["light", "dark"] as const;

const SEED = `
	const keys = Object.keys(c.template.fields.properties);
	const tiers = ["Gold", "Silver", "Bronze"];
	const statuses = ["pending", "pending", "exported", "pending", "failed", "skipped"];
	const sample = (k, i) => ({
		display_name: "Member " + (i + 1),
		tier: tiers[i % 3],
		profile_url: "https://example.com/u/" + (i + 1),
		member_since: String(2000 + (i % 25)),
		member_id: "LC " + String(i + 1).padStart(4, "0") + " 0000",
		verified: i % 2 === 0 ? "true" : "false",
	})[k] ?? k + " " + (i + 1);
	const dataset = {
		id: "d_members",
		name: "members",
		columns: keys.map((key) => ({ key, type: "text" })),
		records: Array.from({ length: 120 }, (_, i) => ({
			id: "r" + (i + 1),
			status: statuses[i % statuses.length],
			values: Object.fromEntries(keys.map((k) => [k, sample(k, i)])),
		})),
		assets: [],
	};
	c.dispatch({ type: "datasetEdit", datasets: [dataset] });
	const tid = c.state.workspace.activeTemplateId;
	c.dispatch({
		type: "setBinding",
		id: tid,
		binding: {
			datasetId: "d_members",
			fields: Object.fromEntries(keys.map((k) => [k, { kind: "column", column: k }])),
		},
	});
	c.dispatch({
		type: "setPreset",
		preset: {
			id: "p_png", name: "Members PNG", templateId: tid, records: "all",
			sides: "all", format: "png-zip", scale: 1, dpi: 300,
			fileName: "{{index}}-{{side}}", markExported: true,
		},
	});
`;

// The browser here has no route to Google Fonts, so text in the Davi card's
// families would not paint. For pictures, those requests are answered through
// curl, which does.
async function routeGoogleFonts(page: Page) {
	await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
		const req = route.request();
		try {
			const body = execFileSync(
				"curl",
				["-sSfL", "-A", req.headers()["user-agent"] ?? "", req.url()],
				{ maxBuffer: 32 << 20 },
			);
			await route.fulfill({
				body,
				headers: { "access-control-allow-origin": "*" },
				contentType: req.url().includes("googleapis")
					? "text/css"
					: "font/woff2",
			});
		} catch {
			await route.abort();
		}
	});
}

async function openFromWelcome(page: Page, testId: string, theme: string) {
	await page.goto(`/?theme=${theme}`);
	await page.getByTestId(testId).click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
}

/**
 * The photo watermark starter bound to a dataset of generated landscapes in
 * both orientations, plus one record whose photo is missing, so a job over
 * it finishes with a failure to show.
 */
async function photoWorkspace(page: Page, theme: string) {
	await page.goto(`/?starter=photo-watermark&theme=${theme}`);
	await expect
		.poll(() => state<number>(page, "s.workspace?.presets.length ?? 0"))
		.toBe(1);
	await page.evaluate(async (actionsPath) => {
		const actions = await import(/* @vite-ignore */ actionsPath);
		const c = (
			window as unknown as {
				__freshcoat: {
					controller: {
						state: {
							workspace: {
								activeTemplateId: string;
								datasets: { id: string; records: unknown[] }[];
							};
						};
						dispatch(a: unknown): void;
					};
				};
			}
		).__freshcoat.controller;
		const hues = [205, 28, 150, 330, 45, 265, 185, 12, 95, 225, 300, 60];
		const files: File[] = [];
		for (let i = 0; i < hues.length; i++) {
			const [w, h] = i % 3 === 1 ? [960, 1280] : [1600, 1066];
			const hue = hues[i] as number;
			const cv = new OffscreenCanvas(w, h);
			const g = cv.getContext("2d") as OffscreenCanvasRenderingContext2D;
			const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
			sky.addColorStop(0, `hsl(${hue} 65% 38%)`);
			sky.addColorStop(1, `hsl(${(hue + 30) % 360} 80% 78%)`);
			g.fillStyle = sky;
			g.fillRect(0, 0, w, h);
			g.fillStyle = `hsl(${(hue + 50) % 360} 90% 88%)`;
			g.beginPath();
			g.arc(w * (0.25 + (i % 4) * 0.15), h * 0.32, h * 0.09, 0, Math.PI * 2);
			g.fill();
			for (let layer = 0; layer < 3; layer++) {
				g.fillStyle = `hsl(${(hue + 180) % 360} ${30 + layer * 10}% ${34 - layer * 10}%)`;
				g.beginPath();
				g.moveTo(0, h);
				for (let x = 0; x <= w; x += w / 24)
					g.lineTo(
						x,
						h * (0.55 + layer * 0.12) +
							Math.sin(x / (w / (3 + layer)) + i + layer) * h * 0.06,
					);
				g.lineTo(w, h);
				g.fill();
			}
			const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.9 });
			files.push(
				new File([blob], `DSC_${String(4180 + i * 7).padStart(5, "0")}.jpg`, {
					type: "image/jpeg",
				}),
			);
		}
		const dataset = await actions.newDatasetFromPhotos(c, files, "Shoot");
		const ws = c.state.workspace;
		c.dispatch({
			type: "datasetEdit",
			datasets: ws.datasets.map((d) =>
				d.id === dataset.id
					? {
							...d,
							records: [
								...d.records,
								{
									id: "r_missing",
									status: "pending",
									values: { file_name: "DSC_04999.jpg" },
								},
							],
						}
					: d,
			),
		});
		c.dispatch({
			type: "setBinding",
			id: ws.activeTemplateId,
			binding: {
				datasetId: dataset.id,
				fields: { photo: { kind: "column", column: "photo" } },
			},
		});
	}, probePath("app-probe"));
	await settle(page);
}

/** Waits until at least `min` images inside `selector` are shown and every
 *  one of them has loaded. */
async function thumbnailsLoaded(page: Page, selector: string, min = 1) {
	await expect
		.poll(
			() =>
				page
					.locator(`${selector} img`)
					.evaluateAll(
						(imgs, least) =>
							imgs.length >= least &&
							imgs.every(
								(i) =>
									(i as HTMLImageElement).complete &&
									(i as HTMLImageElement).naturalWidth > 0,
							),
						min,
					),
			{ timeout: 30_000 },
		)
		.toBe(true);
}

/** Waits until every card in the gallery shows its photo, or says it has
 *  none. */
async function galleryLoaded(page: Page) {
	await expect
		.poll(
			() =>
				page
					.locator("[data-testid=records-gallery] [role=row][data-row]")
					.evaluateAll(
						(cards) =>
							cards.length > 0 &&
							cards.every((card) => {
								const img = card.querySelector("img");
								if (img) return img.complete && img.naturalWidth > 0;
								return card.textContent?.includes("No photo") ?? false;
							}),
					),
			{ timeout: 30_000 },
		)
		.toBe(true);
}

/** Shows a panel that is a sheet or an overlay at this width, by its
 *  toggle, when what is pictured inside it is not on screen yet. */
async function reveal(page: Page, inside: string, toggle: string) {
	if (await page.getByTestId(inside).isVisible()) return;
	await page.getByRole("button", { name: toggle }).first().click();
	await expect(page.getByTestId(inside)).toBeVisible();
}

/** Closes the toasts, which would otherwise sit over what is pictured. */
async function dismissToasts(page: Page) {
	for (const button of await page
		.getByRole("button", { name: "Dismiss" })
		.all())
		await button.click();
}

/** Picks a barcode type from the inspector's Type select. */
async function chooseBarcodeType(page: Page, label: string) {
	await page.getByRole("button", { name: /Barcode type/ }).click();
	await page.getByRole("listbox").getByRole("option", { name: label }).click();
	await settle(page);
}

/** Nine attendees bound to the Event badge's fields. */
const ATTENDEES = `
	const keys = ["name", "company", "role", "ticket_id"];
	const names = ["Ada Okafor", "Bruno Lindqvist", "Chen Wei", "Dara Moreno",
		"Esme Laurent", "Farid Haddad", "Grace Kimura", "Hugo Brandt", "Ines Duarte"];
	const companies = ["Northwind Labs", "Fabrikam", "Contoso Print", "Tailspin Toys"];
	c.dispatch({
		type: "datasetEdit",
		datasets: [{
			id: "d_attendees",
			name: "Attendees",
			columns: keys.map((key) => ({ key, type: "text" })),
			records: names.map((name, i) => ({
				id: "a" + (i + 1),
				status: "pending",
				values: {
					name,
					company: companies[i % companies.length],
					role: i % 3 === 0 ? "Speaker" : "Attendee",
					ticket_id: "TKT-2026-" + String(i + 1).padStart(4, "0"),
				},
			})),
			assets: [],
		}],
	});
	c.dispatch({
		type: "setBinding",
		id: c.state.workspace.activeTemplateId,
		binding: {
			datasetId: "d_attendees",
			fields: Object.fromEntries(keys.map((k) => [k, { kind: "column", column: k }])),
		},
	});
`;

/** Waits for the sheet preview to finish drawing its slots. */
async function sheetReady(page: Page) {
	await expect(page.getByTestId("sheet-preview")).toHaveAttribute(
		"data-state",
		"ready",
		{ timeout: 60_000 },
	);
	await page.waitForTimeout(300);
}

/** Closes the export settings when they are a sheet over the preview. */
async function closeSettingsSheet(page: Page) {
	const close = page.getByRole("button", { name: "Close" });
	if (await close.isVisible()) await close.click();
}

for (const size of SIZES) {
	for (const theme of THEMES) {
		test.describe(`${size.name} ${theme}`, () => {
			test.use({
				viewport: { width: size.width, height: size.height },
				hasTouch: size.touch,
			});

			const shot = (page: Page, name: string) =>
				page.screenshot({
					path: `e2e/screenshots/${size.name}-${theme}-${name}.png`,
				});

			test("welcome", async ({ page }) => {
				await page.goto(`/?theme=${theme}`);
				await page.getByTestId("starter-davi-card").waitFor();
				await page.getByTestId("sample-membership-card").waitFor();
				await shot(page, "welcome");
			});

			test("editing", async ({ page }) => {
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(page, `c.select(["0/6"])`);
				await reveal(page, "panel-right", "Inspector panel");
				await shot(page, "editing-text");
				await run(
					page,
					`c.select(["0/9"]); c.dispatch({ type: "setRightTab", tab: "design" })`,
				);
				await shot(page, "editing-frame");
				await run(
					page,
					`c.select([]); c.dispatch({ type: "setRightTab", tab: "content" })`,
				);
				await shot(page, "content");
				await page.getByRole("button", { name: "File", exact: true }).click();
				await page.getByRole("menuitem", { name: "Template setup…" }).click();
				await page.getByTestId("template-setup").waitFor();
				await shot(page, "template-setup");
			});

			test("gradient handles", async ({ page }) => {
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(
					page,
					`const key = c.insert({
						id: "sheen", type: "rect",
						pos: { x: 470, y: 150 }, size: { width: 420, height: 260 },
						rotation: -12,
						properties: {
							fill: {
								kind: "linear", angle: 30, from: [0.08, 0.2], to: [0.9, 0.85],
								stops: [
									{ offset: 0, color: "#ffd166" },
									{ offset: 0.45, color: "#ef476f" },
									{ offset: 1, color: "#118ab2" },
								],
							},
							cornerRadius: 24,
						},
					});
					c.select([key]);
					c.dispatch({ type: "setRightTab", tab: "design" });`,
				);
				await expect(page.getByTestId("gradient-handles")).toBeAttached();
				await shot(page, "gradient");
			});

			test("davi card with print guides", async ({ page }) => {
				await routeGoogleFonts(page);
				await openFromWelcome(page, "starter-davi-card", theme);
				await page.waitForTimeout(500);
				await settle(page);
				await shot(page, "davi-card");
				await run(
					page,
					`c.dispatch({ type: "setSide", side: 1 }); c.select([])`,
				);
				await page.waitForTimeout(300);
				await settle(page);
				await shot(page, "davi-card-back");
			});

			test("menus and dialogs", async ({ page }) => {
				await openFromWelcome(page, "sample-certificate", theme);
				await page.getByRole("button", { name: "Object" }).click();
				await shot(page, "menu");
				await page.keyboard.press("Escape");
				await page.keyboard.press("Shift+?");
				await page.getByRole("dialog").waitFor();
				await shot(page, "shortcuts");
			});

			test("edit with data", async ({ page }) => {
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(page, SEED);
				await run(
					page,
					`const tid = c.state.workspace.activeTemplateId;
					c.dispatch({ type: "duplicateTemplate", id: tid });
					c.switchTemplate(tid);
					c.select(["0/6"]);
					c.dispatch({ type: "setRightTab", tab: "content" })`,
				);
				await reveal(page, "panel-right", "Inspector panel");
				// Steps through records first so the status bar's p95 is warm.
				await page.evaluate(async () => {
					const c = (
						window as unknown as {
							__freshcoat: {
								controller: { previewRecord(id: string): void };
							};
						}
					).__freshcoat.controller;
					for (let i = 1; i <= 30; i++) {
						c.previewRecord(`r${i}`);
						await new Promise((r) => setTimeout(r, 60));
					}
					c.previewRecord("r7");
				});
				await page.waitForTimeout(800);
				await shot(page, "edit-record");
			});

			test("data table and export", async ({ page }) => {
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(page, SEED);
				await run(page, `c.dispatch({ type: "setSection", section: "data" })`);
				await page.getByTestId("section-switcher").waitFor();
				await settle(page);
				await shot(page, "data-table");
				await run(
					page,
					`c.dispatch({ type: "setSection", section: "export" })`,
				);
				await expect(page.getByTestId("export-preview")).toHaveAttribute(
					"data-state",
					"ready",
					{ timeout: 30_000 },
				);
				await page.waitForTimeout(500);
				await shot(page, "export");
			});

			test("photos: gallery, record, split and a finished job", async ({
				page,
			}) => {
				test.setTimeout(120_000);
				await photoWorkspace(page, theme);
				await page.keyboard.press(`${mod}+2`);
				const gallery = page.getByTestId("records-gallery");
				await expect(gallery).toBeVisible();
				await dismissToasts(page);
				await page.mouse.move(0, 0);
				await galleryLoaded(page);
				await shot(page, "gallery");

				await gallery.locator("[role=row][data-row]").nth(1).dblclick();
				await expect(page.getByTestId("record-panel")).toBeVisible();
				await thumbnailsLoaded(page, "[data-testid=record-panel]");
				await page.waitForTimeout(300);
				await shot(page, "record");

				await page.keyboard.press("Escape");
				await page.keyboard.press(`${mod}+3`);
				const strip = page.getByTestId("export-filmstrip");
				await strip.getByRole("option").nth(1).click();
				const preview = page.getByTestId("export-preview");
				await expect(preview).toHaveAttribute("data-state", "ready", {
					timeout: 30_000,
				});
				await page.getByRole("radio", { name: "Split" }).click();
				await expect(preview).toHaveAttribute("data-mode", "split");
				await thumbnailsLoaded(page, "[data-testid=export-filmstrip]", 4);
				await page.waitForTimeout(300);
				await shot(page, "split");

				await page.getByRole("button", { name: /^Export \d+ files?$/ }).click();
				await expect(page.getByTestId("export-job")).toHaveAttribute(
					"data-state",
					"done",
					{ timeout: 90_000 },
				);
				await page.waitForTimeout(300);
				await shot(page, "job-done");
			});

			test("font picker", async ({ page }) => {
				await stubGoogleFonts(page);
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(
					page,
					`c.select(["0/6"]); c.dispatch({ type: "setRightTab", tab: "design" })`,
				);
				await reveal(page, "design-inspector", "Inspector panel");
				await page
					.getByTestId("design-inspector")
					.getByRole("button", { name: /^Font family/ })
					.click();
				const picker = page.getByTestId("font-picker");
				await expect(
					picker.locator("[data-preview=loaded]").first(),
				).toBeVisible();
				await page.waitForTimeout(500);
				await shot(page, "font-picker");
				await picker
					.getByRole("combobox", { name: "Search fonts" })
					.fill("serif");
				await page.waitForTimeout(500);
				await shot(page, "font-picker-search");
			});

			test("export selected from Data, and its job bar", async ({ page }) => {
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(page, SEED);
				await page.keyboard.press(`${mod}+2`);
				await expect(page.getByTestId("section-data")).toBeVisible();
				for (const id of ["r2", "r3", "r5"])
					await page
						.locator(`[role=row][data-row="${id}"]`)
						.getByRole("checkbox")
						.check({ force: true });
				await expect(page.getByTestId("data-status-selected")).toHaveText(
					"3 selected",
				);
				await shot(page, "data-selected");
				await page.getByTestId("export-selected").click();
				const popover = page.getByTestId("export-selected-popover");
				await expect(popover).toBeVisible();
				await shot(page, "data-export-selected");
				const download = page.waitForEvent("download", { timeout: 120_000 });
				await popover
					.getByRole("button", { name: "Export", exact: true })
					.click();
				await download;
				await expect(page.getByTestId("export-job")).toHaveAttribute(
					"data-state",
					"done",
					{ timeout: 90_000 },
				);
				await dismissToasts(page);
				await page.mouse.move(0, 0);
				await shot(page, "data-job-bar");
			});

			test("filmstrip multi-select", async ({ page }) => {
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(page, SEED);
				await page.keyboard.press(`${mod}+3`);
				const strip = page.getByTestId("export-filmstrip");
				const cell = (id: string) => strip.locator(`[data-record="${id}"]`);
				await cell("r1").click();
				await cell("r2").click({ modifiers: [mod] });
				await cell("r4").click({ modifiers: ["Shift"] });
				await expect(
					page.getByRole("button", { name: "Export 3 selected" }),
				).toBeVisible();
				await expect(page.getByTestId("export-preview")).toHaveAttribute(
					"data-state",
					"ready",
					{ timeout: 30_000 },
				);
				await page.mouse.move(0, 0);
				await page.waitForTimeout(300);
				await shot(page, "filmstrip-selected");
			});

			test("print settings and the printer file", async ({ page }) => {
				test.setTimeout(120_000);
				await openFromWelcome(page, "sample-membership-card", theme);
				await page.keyboard.press(`${mod}+3`);
				await page.getByRole("button", { name: "New preset" }).first().click();
				await reveal(page, "export-settings", "Settings");
				await settingsTab(page, "Print");
				await page
					.getByTestId("export-print")
					.getByText("Optimize for card printer")
					.click();
				await expect(
					page.getByRole("switch", { name: "Optimize for card printer" }),
				).toBeChecked();
				// The profile row, so the whole group is in view in a sheet.
				await page
					.getByTestId("export-print-profile")
					.evaluate((el) => el.scrollIntoView({ block: "center" }));
				await shot(page, "export-print");
				if (await page.getByRole("button", { name: "Close" }).isVisible())
					await page.getByRole("button", { name: "Close" }).click();
				await page.getByRole("button", { name: "Printer file" }).click();
				await expect(page.getByTestId("export-printer-file")).toBeVisible({
					timeout: 60_000,
				});
				await page.waitForTimeout(300);
				await shot(page, "export-printer-file");
			});

			test("empty states", async ({ page }) => {
				await page.goto(`/?new=card-cr80&theme=${theme}`);
				await expect(page.getByTestId("artboard-canvas")).toBeAttached();
				await settle(page);
				await dismissToasts(page);
				await run(page, `c.dispatch({ type: "setRightTab", tab: "content" })`);
				await shot(page, "empty-edit");
				await page.keyboard.press(`${mod}+2`);
				await expect(page.getByTestId("data-empty")).toBeVisible();
				await shot(page, "empty-data");
				await page.keyboard.press(`${mod}+3`);
				await expect(page.getByTestId("section-export")).toBeVisible();
				await page.waitForTimeout(300);
				await shot(page, "empty-export");
			});

			test("barcodes: the tool, each kind, and an invalid value", async ({
				page,
			}) => {
				await page.goto(`/?new=card-cr80&theme=${theme}`);
				await expect(page.getByTestId("artboard-canvas")).toBeAttached();
				await settle(page);
				await dismissToasts(page);
				await page.getByTestId("artboard").hover();
				await page.keyboard.press("b");
				expect(await state<string>(page, "s.tool")).toBe("barcode");
				await dragTemplate(page, { x: 60, y: 200 }, { x: 420, y: 150 });
				await run(page, `c.dispatch({ type: "setRightTab", tab: "design" })`);
				await reveal(page, "design-inspector", "Inspector panel");
				const value = page.getByLabel("Barcode value");
				await expect(value).toHaveValue("FRESHCOAT");
				const type = async (label: string, text: string) => {
					await chooseBarcodeType(page, label);
					await value.fill(text);
					await value.blur();
					await settle(page);
					await page.mouse.move(0, 0);
				};
				await type("Code 128", "FC-2026-000184");
				await shot(page, "barcode-code128");

				await type("PDF417", "FRESHCOAT MEMBER 000184 GOLD 2026-09-25");
				await shot(page, "barcode-pdf417");

				// A check digit that should be 1.
				await type("EAN-13", "4006381333932");
				await expect(page.getByTestId("barcode-message")).toBeVisible();
				await shot(page, "barcode-invalid");

				await type("Data Matrix", "https://lumen.example/m/000184");
				await shot(page, "barcode-datamatrix");
			});

			test("sheets: the Layout group and the sheet preview", async ({
				page,
			}) => {
				test.setTimeout(180_000);
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(page, SEED);
				await page.keyboard.press(`${mod}+3`);
				await reveal(page, "export-presets", "Presets");
				await page
					.getByTestId("export-presets")
					.getByRole("button", { name: "New preset" })
					.first()
					.click();
				await closeSettingsSheet(page);
				await reveal(page, "export-settings", "Settings");
				const settings = page.getByTestId("export-settings");
				await settingsTab(page, "Output");
				await settings
					.getByRole("radiogroup", { name: "Format" })
					.getByRole("radio", { name: "PDF" })
					.click();
				await settingsTab(page, "Print");
				const layout = settings.getByTestId("export-layout");
				await layout.getByRole("radio", { name: "Sheets" }).click();
				await layout.locator("label", { hasText: "Double-sided" }).click();
				await layout.getByRole("button", { name: "More" }).click();
				await expect(
					settings.getByTestId("export-sheet-summary"),
				).toBeVisible();
				// The summary under the group, so the whole of it is in view.
				await settings
					.getByTestId("export-sheet-summary")
					.evaluate((el) => el.scrollIntoView({ block: "end" }));
				await page.mouse.move(0, 0);
				await shot(page, "export-layout");

				await closeSettingsSheet(page);
				await page.getByRole("radio", { name: "Sheet", exact: true }).click();
				await sheetReady(page);
				await page.mouse.move(0, 0);
				await shot(page, "sheet-front");
				await page
					.getByRole("radiogroup", { name: "Sheet side" })
					.getByRole("radio", { name: "Back" })
					.click();
				await expect(page.getByTestId("sheet-preview")).toHaveAttribute(
					"data-side",
					"back",
				);
				await sheetReady(page);
				await page.mouse.move(0, 0);
				await shot(page, "sheet-back");
			});

			test("the Event badge starter and its A4 sheet", async ({ page }) => {
				test.setTimeout(120_000);
				await page.goto(`/?starter=event-badge&theme=${theme}`);
				await expect(page.getByTestId("artboard-canvas")).toBeAttached();
				await run(page, ATTENDEES);
				await run(page, `c.previewRecord("a2")`);
				await settle(page);
				await dismissToasts(page);
				await page.mouse.move(0, 0);
				await page.waitForTimeout(300);
				await shot(page, "event-badge");

				await page.keyboard.press(`${mod}+3`);
				await reveal(page, "export-settings", "Settings");
				await settingsTab(page, "Print");
				await expect(page.getByTestId("export-sheet-summary")).toHaveText(
					"4 per sheet · 3 sheets",
				);
				await closeSettingsSheet(page);
				await page.getByRole("radio", { name: "Sheet", exact: true }).click();
				await sheetReady(page);
				await page.mouse.move(0, 0);
				await shot(page, "event-badge-sheet");
			});

			test("the membership card's back with its barcode", async ({ page }) => {
				await openFromWelcome(page, "sample-membership-card", theme);
				await run(page, SEED);
				await run(
					page,
					`c.previewRecord("r7"); c.dispatch({ type: "setSide", side: 1 }); c.select([])`,
				);
				await settle(page);
				await page.waitForTimeout(300);
				await shot(page, "membership-back");
			});

			test("View menu and render stats", async ({ page }) => {
				await openFromWelcome(page, "sample-membership-card", theme);
				await page.getByRole("button", { name: "View", exact: true }).click();
				await expect(
					page.getByRole("menuitem", { name: "Render stats" }),
				).toBeVisible();
				await shot(page, "view-menu");
				await page.getByRole("menuitem", { name: "Render stats" }).click();
				await run(page, `c.select(["0/6"]); c.nudge(1, 0)`);
				await settle(page);
				await page.waitForTimeout(300);
				await shot(page, "render-stats");
			});
		});
	}
}
