import { readFile } from "node:fs/promises";
import {
	cardSizeMm,
	DEFAULT_SHEET_LAYOUT,
	imposeSheets,
	type SheetLayout,
} from "@freshcoat-js/workspace";
import { expect, type Page, test } from "@playwright/test";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDocument,
	type PDFPage,
	PDFRawStream,
} from "pdf-lib";
import { mod, openSample } from "./helpers";

const RECORDS = 21;
const PT = 72 / 25.4;
// The membership card: 1012 × 638 at 300 dpi.
const CARD = cardSizeMm(1012, 638, 300);

/** Adds a bound dataset of `count` members. */
async function seed(page: Page, count: number) {
	await page.evaluate((count) => {
		const c = (
			window as unknown as {
				__freshcoat: {
					controller: {
						template: { fields: { properties: Record<string, unknown> } };
						state: { workspace: { activeTemplateId: string } };
						dispatch(action: unknown): void;
					};
				};
			}
		).__freshcoat.controller;
		const keys = Object.keys(c.template.fields.properties);
		const tiers = ["Gold", "Silver", "Bronze"];
		const values = (i: number): Record<string, string> => ({
			display_name: `Member ${i + 1}`,
			tier: tiers[i % 3] as string,
			profile_url: `https://example.com/u/${i + 1}`,
			member_since: String(2000 + i),
			member_id: `LC ${String(i + 1).padStart(4, "0")} 0000`,
			verified: i % 2 === 0 ? "true" : "false",
		});
		c.dispatch({
			type: "datasetEdit",
			datasets: [
				{
					id: "d_members",
					name: "Members",
					columns: keys.map((key) => ({ key, type: "text" })),
					records: Array.from({ length: count }, (_, i) => ({
						id: `r${i + 1}`,
						status: "pending",
						values: Object.fromEntries(
							keys.map((k) => [k, values(i)[k] ?? `${k} ${i + 1}`]),
						),
					})),
					assets: [],
				},
			],
		});
		c.dispatch({
			type: "setBinding",
			id: c.state.workspace.activeTemplateId,
			binding: {
				datasetId: "d_members",
				fields: Object.fromEntries(
					keys.map((k) => [k, { kind: "column", column: k }]),
				),
			},
		});
	}, count);
}

async function download(page: Page, start: () => Promise<void>) {
	const pending = page.waitForEvent("download", { timeout: 180_000 });
	await start();
	const file = await pending;
	return new Uint8Array(await readFile(await file.path()));
}

/** Each image a page draws: x, y, width and height in points. */
function images(page: PDFPage): number[][] {
	const contents = page.node.Contents();
	const streams =
		contents instanceof PDFArray
			? contents.asArray().map((ref) => page.doc.context.lookup(ref))
			: [contents];
	const text = streams
		.map((s) =>
			s instanceof PDFRawStream
				? new TextDecoder("latin1").decode(decodePDFRawStream(s).decode())
				: "",
		)
		.join("\n");
	const tokens = text.split(/\s+/).filter(Boolean);
	type M = [number, number, number, number, number, number];
	const identity: M = [1, 0, 0, 1, 0, 0];
	let ctm: M = identity;
	const stack: M[] = [];
	const out: number[][] = [];
	tokens.forEach((token, i) => {
		if (token === "q") stack.push(ctm);
		else if (token === "Q") ctm = stack.pop() ?? identity;
		else if (token === "cm") {
			const [a, b, c, d, e, f] = tokens.slice(i - 6, i).map(Number) as M;
			const [A, B, C, D, E, F] = ctm;
			ctm = [
				a * A + b * C,
				a * B + b * D,
				c * A + d * C,
				c * B + d * D,
				e * A + f * C + E,
				e * B + f * D + F,
			];
		} else if (token === "Do") out.push([ctm[4], ctm[5], ctm[0], ctm[3]]);
	});
	return out;
}

/** Where `imposeSheets` puts every slot, in PDF points from the bottom left. */
function expected(layout: SheetLayout) {
	const items = Array.from({ length: RECORDS }, (_, i) =>
		["front", "back"].map((side, s) => ({
			recordId: `r${i + 1}`,
			sideIndex: s,
			side,
		})),
	).flat();
	const imposition = imposeSheets(items, CARD, layout);
	return {
		imposition,
		pages: imposition.pages.map((p) =>
			p.slots.map((slot) => ({
				item: slot.item,
				x: slot.xMm * PT,
				y: (imposition.paper.heightMm - slot.yMm - CARD.heightMm) * PT,
			})),
		),
	};
}

function expectPlacements(doc: PDFDocument, layout: SheetLayout) {
	const want = expected(layout);
	expect(doc.getPageCount()).toBe(want.pages.length);
	doc.getPages().forEach((page, p) => {
		// A4, in points
		expect(page.getWidth()).toBeCloseTo(595.28, 1);
		expect(page.getHeight()).toBeCloseTo(841.89, 1);
		const drawn = images(page);
		const slots = want.pages[p] ?? [];
		expect(drawn).toHaveLength(slots.length);
		slots.forEach((slot, n) => {
			const [x, y, w, h] = drawn[n] ?? [];
			expect(x).toBeCloseTo(slot.x, 1);
			expect(y).toBeCloseTo(slot.y, 1);
			expect(w).toBeCloseTo(CARD.widthMm * PT, 1);
			expect(h).toBeCloseTo(CARD.heightMm * PT, 1);
		});
	});
	return want;
}

async function openSheetsPreset(page: Page) {
	await openSample(page, "membership-card");
	await seed(page, RECORDS);
	await page.keyboard.press(`${mod}+3`);
	await page
		.getByTestId("export-presets")
		.getByRole("button", { name: "New preset" })
		.click();
	const settings = page.getByTestId("export-settings");
	await settings
		.getByRole("radiogroup", { name: "Format" })
		.getByRole("radio", { name: "PDF" })
		.click();
	await settings
		.getByTestId("export-layout")
		.getByRole("radio", { name: "Sheets" })
		.click();
	return settings;
}

test("export cards on A4 sheets and read the PDF back", async ({ page }) => {
	test.setTimeout(300_000);
	const settings = await openSheetsPreset(page);
	await expect(settings.getByTestId("export-sheet-summary")).toHaveText(
		"10 per sheet · 5 sheets",
	);
	await expect(settings.getByTestId("export-page-size")).toHaveText(
		"Card 3.37 × 2.13 in · 85.7 × 54.0 mm",
	);

	// The sheet preview: the paper at A4's aspect, ten slots rendered, marks.
	await page.getByRole("radio", { name: "Sheet", exact: true }).click();
	await expect(page.getByTestId("export-sheet-position")).toHaveText(
		"Sheet 1 of 5",
	);
	const preview = page.getByTestId("sheet-preview");
	await expect(preview).toHaveAttribute("data-state", "ready", {
		timeout: 60_000,
	});
	await expect(preview.getByTestId("sheet-slot")).toHaveCount(10);
	await expect(
		preview.getByTestId("sheet-crop-marks").locator("line"),
	).not.toHaveCount(0);
	const paper = await preview.getByTestId("sheet-paper").boundingBox();
	expect((paper?.width ?? 0) / (paper?.height ?? 1)).toBeCloseTo(210 / 297, 2);
	// a slot holds a rendered card, not a blank
	const painted = await page.evaluate(() => {
		const c = document.querySelector(
			'[data-testid="sheet-slot"] canvas',
		) as HTMLCanvasElement;
		const data = c.getContext("2d")?.getImageData(0, 0, c.width, c.height)
			.data as Uint8ClampedArray;
		const seen = new Set<number>();
		for (let i = 0; i < data.length; i += 4 * 13)
			seen.add(
				((data[i] as number) << 16) |
					((data[i + 1] as number) << 8) |
					(data[i + 2] as number),
			);
		return seen.size;
	});
	expect(painted).toBeGreaterThan(10);
	await page.getByRole("button", { name: "Next sheet" }).click();
	await page.getByRole("button", { name: "Next sheet" }).click();
	await expect(page.getByTestId("export-sheet-position")).toHaveText(
		"Sheet 3 of 5",
	);
	await expect(preview).toHaveAttribute("data-state", "ready", {
		timeout: 60_000,
	});

	const bytes = await download(page, () =>
		page.getByRole("button", { name: "Export 42 files" }).click(),
	);
	const doc = await PDFDocument.load(bytes);
	const want = expectPlacements(doc, DEFAULT_SHEET_LAYOUT);
	expect(want.imposition.paper.orientation).toBe("portrait");
	expect([want.imposition.columns, want.imposition.rows]).toEqual([2, 5]);
});

test("a double-sided export puts each back in the mirrored slot", async ({
	page,
}) => {
	test.setTimeout(300_000);
	const settings = await openSheetsPreset(page);
	await settings
		.getByTestId("export-layout")
		.locator("label", { hasText: "Double-sided" })
		.click();
	await expect(
		settings
			.getByRole("radiogroup", { name: "Flip on" })
			.getByRole("radio", { name: "Long edge" }),
	).toHaveAttribute("aria-checked", "true");
	await expect(settings.getByTestId("export-sheet-summary")).toHaveText(
		"10 per sheet · 3 sheets",
	);

	// The preview labels the back and mirrors it: record 1 sits top right.
	await page.getByRole("radio", { name: "Sheet", exact: true }).click();
	await page
		.getByRole("radiogroup", { name: "Sheet side" })
		.getByRole("radio", { name: "Back" })
		.click();
	const preview = page.getByTestId("sheet-preview");
	await expect(preview).toHaveAttribute("data-side", "back");
	await expect(preview.getByTestId("sheet-side-label")).toHaveText("Back");
	await expect(preview.getByTestId("sheet-crop-marks")).toHaveCount(0);
	const first = await preview.locator('[data-item="r1:back"]').boundingBox();
	const second = await preview.locator('[data-item="r2:back"]').boundingBox();
	expect(first?.x ?? 0).toBeGreaterThan(second?.x ?? 0);
	expect(first?.y).toBeCloseTo(second?.y ?? 0, 0);

	const bytes = await download(page, () =>
		page.getByRole("button", { name: "Export 42 files" }).click(),
	);
	const doc = await PDFDocument.load(bytes);
	const layout: SheetLayout = { ...DEFAULT_SHEET_LAYOUT, duplex: "long-edge" };
	const want = expectPlacements(doc, layout);
	expect(doc.getPageCount()).toBe(6);
	// On a portrait sheet flipped on its long edge, a back is its front's
	// slot mirrored across the columns, at the same height.
	const [front, back] = [want.pages[0] ?? [], want.pages[1] ?? []];
	const page0 = images(doc.getPage(0));
	const page1 = images(doc.getPage(1));
	for (const [n, slot] of front.entries()) {
		const b = back.findIndex((s) => s.item.recordId === slot.item.recordId);
		const [fx, fy] = page0[n] ?? [];
		const [bx, by] = page1[b] ?? [];
		expect(by).toBeCloseTo(fy ?? 0, 1);
		expect((fx ?? 0) + (bx ?? 0) + CARD.widthMm * PT).toBeCloseTo(210 * PT, 1);
	}
});

test("the Event badge starter exports badges on A4, four to a landscape sheet", async ({
	page,
}) => {
	test.setTimeout(300_000);
	await page.goto("/?starter=event-badge");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await page.evaluate(() => {
		const c = (
			window as unknown as {
				__freshcoat: {
					controller: {
						state: { workspace: { activeTemplateId: string } };
						dispatch(action: unknown): void;
					};
				};
			}
		).__freshcoat.controller;
		const keys = ["name", "company", "role", "ticket_id"];
		c.dispatch({
			type: "datasetEdit",
			datasets: [
				{
					id: "d_attendees",
					name: "Attendees",
					columns: keys.map((key) => ({ key, type: "text" })),
					records: Array.from({ length: 9 }, (_, i) => ({
						id: `a${i + 1}`,
						status: "pending",
						values: {
							name: `Guest ${i + 1}`,
							company: "Northwind Labs",
							role: i % 3 === 0 ? "Speaker" : "Attendee",
							ticket_id: `TKT-2026-${String(i + 1).padStart(4, "0")}`,
						},
					})),
					assets: [],
				},
			],
		});
		c.dispatch({
			type: "setBinding",
			id: c.state.workspace.activeTemplateId,
			binding: {
				datasetId: "d_attendees",
				fields: Object.fromEntries(
					keys.map((k) => [k, { kind: "column", column: k }]),
				),
			},
		});
	});
	await page.keyboard.press(`${mod}+3`);
	await expect(page.getByTestId("export-sheet-summary")).toHaveText(
		"4 per sheet · 3 sheets",
	);
	const bytes = await download(page, () =>
		page.getByRole("button", { name: "Export 9 files" }).click(),
	);
	const doc = await PDFDocument.load(bytes);
	expect(doc.getTitle()).toBe("Badges on A4");
	expect(doc.getPageCount()).toBe(3);
	const badge = cardSizeMm(1200, 900, 300);
	const layout = imposeSheets(
		Array.from({ length: 9 }, (_, i) => ({ recordId: `a${i + 1}` })),
		badge,
		DEFAULT_SHEET_LAYOUT,
	);
	doc.getPages().forEach((p, n) => {
		expect(p.getWidth()).toBeCloseTo(841.89, 1);
		expect(p.getHeight()).toBeCloseTo(595.28, 1);
		const drawn = images(p);
		const slots = layout.pages[n]?.slots ?? [];
		expect(drawn).toHaveLength(slots.length);
		slots.forEach((slot, i) => {
			const [x, y, w] = drawn[i] ?? [];
			expect(x).toBeCloseTo(slot.xMm * PT, 1);
			expect(y).toBeCloseTo((210 - slot.yMm - badge.heightMm) * PT, 1);
			expect(w).toBeCloseTo(4 * 72, 1);
		});
	});
});
