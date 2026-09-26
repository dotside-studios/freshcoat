// @vitest-environment node
import type {
	ExportPreset,
	SheetLayout,
	Workspace,
} from "@freshcoat/workspace";
import {
	imposeSheets,
	planExport,
	SheetLayoutError,
} from "@freshcoat/workspace";
import { assemblePdf } from "@freshcoat/workspace/pdf";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDocument,
	type PDFPage,
	PDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type JobPool, runExportJob } from "~/export/job";
import type { RenderOutput, RenderRequest } from "~/export/protocol";
import { planSheets, withSideIndex } from "~/export/sheets";
import { membershipCard } from "~/samples/membership-card";

const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);

/** A pool that answers every render with a tiny PNG, or fails the ones
 *  `fail` names. */
function pngPool(fail?: (req: RenderRequest) => boolean) {
	const requests: RenderRequest[] = [];
	const pool: JobPool & { requests: RenderRequest[] } = {
		size: 2,
		requests,
		render(req) {
			requests.push(req);
			if (fail?.(req)) return Promise.reject(new Error("no"));
			return Promise.resolve<RenderOutput>({
				bytes: PNG,
				format: "png",
				width: 1,
				height: 1,
				ms: 1,
			});
		},
		cancel() {},
	};
	return pool;
}

function workspace(count: number): Workspace {
	return {
		formatVersion: "1.0",
		name: "Club",
		templates: [
			{
				id: "t_1",
				fileName: "Membership card.coat",
				template: membershipCard(),
				binding: {
					datasetId: "d_1",
					fields: { display_name: { kind: "column", column: "name" } },
				},
			},
		],
		datasets: [
			{
				id: "d_1",
				name: "Members",
				columns: [{ key: "name", type: "text" }],
				records: Array.from({ length: count }, (_, i) => ({
					id: `r_${i + 1}`,
					values: { name: `Member ${i + 1}` },
					status: "pending" as const,
				})),
				assets: [],
			},
		],
		presets: [],
	};
}

function sheetPreset(layout: Partial<SheetLayout> = {}): ExportPreset {
	return {
		id: "p_1",
		name: "Cards on A4",
		templateId: "t_1",
		records: "all",
		sides: "all",
		format: "pdf",
		scale: 1,
		dpi: 300,
		fileName: "{{index}}-{{side}}",
		markExported: true,
		layout: {
			kind: "sheet",
			paper: "a4",
			orientation: "portrait",
			marginMm: 10,
			gapMm: 0,
			cropMarks: true,
			duplex: "long-edge",
			...layout,
		},
	};
}

/** The x, y, width and height each image is drawn at, in points. */
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

const PT = 72 / 25.4;

describe("an export on sheets", () => {
	it("imposes a two-sided card on A4, backs mirrored", async () => {
		const pool = pngPool();
		const preset = sheetPreset();
		const result = await runExportJob(workspace(3), preset, {
			pool,
			assemblePdf,
		});
		expect(result.items.every((i) => i.ok)).toBe(true);
		const blob = result.file?.blob;
		if (!blob) throw new Error("no PDF");
		const doc = await PDFDocument.load(
			new Uint8Array(await blob.arrayBuffer()),
		);
		expect(doc.getTitle()).toBe("Cards on A4");
		expect(doc.getPageCount()).toBe(2);
		for (const page of doc.getPages()) {
			expect(page.getWidth()).toBeCloseTo(210 * PT, 2);
			expect(page.getHeight()).toBeCloseTo(297 * PT, 2);
		}

		// 1012 × 638 at 300 dpi
		const card = { widthMm: (1012 / 300) * 25.4, heightMm: (638 / 300) * 25.4 };
		const expected = imposeSheets(
			Array.from({ length: 6 }, (_, i) => ({ recordId: `r_${i >> 1}` })),
			card,
			preset.layout as SheetLayout,
		);
		expect([expected.columns, expected.rows]).toEqual([2, 5]);
		const height = 297 * PT;
		doc.getPages().forEach((page, p) => {
			const drawn = images(page);
			const slots = expected.pages[p]?.slots ?? [];
			expect(drawn).toHaveLength(3);
			slots.forEach((slot, n) => {
				const [x, y, w, h] = drawn[n] ?? [];
				expect(x).toBeCloseTo(slot.xMm * PT, 2);
				expect(y).toBeCloseTo(height - (slot.yMm + card.heightMm) * PT, 2);
				expect(w).toBeCloseTo(card.widthMm * PT, 2);
				expect(h).toBeCloseTo(card.heightMm * PT, 2);
			});
		});
		// record 1's back sits across from its front on a long-edge flip
		const [front, back] = doc.getPages().map(images);
		expect(front?.[0]?.[0]).toBeCloseTo(back?.[1]?.[0] ?? 0, 2);
		expect(back?.[0]?.[0]).toBeGreaterThan(front?.[0]?.[0] ?? 0);
	});

	it("keeps a record's back in its slot when its front fails", async () => {
		const pages: unknown[] = [];
		const pool = pngPool(
			(r) => r.values.display_name === "Member 1" && r.side === "front",
		);
		const result = await runExportJob(workspace(2), sheetPreset(), {
			pool,
			assemblePdf: async (p, options) => {
				pages.push(...p);
				expect(options.layout?.duplex).toBe("long-edge");
				expect(options.cardMm?.widthMm).toBeCloseTo((1012 / 300) * 25.4, 9);
				return assemblePdf(p, options);
			},
		});
		expect(result.items.filter((i) => !i.ok)).toHaveLength(1);
		expect(pages).toMatchObject([
			{ recordId: "r_1", sideIndex: 1 },
			{ recordId: "r_2", sideIndex: 0 },
			{ recordId: "r_2", sideIndex: 1 },
		]);
		const blob = result.file?.blob as Blob;
		const doc = await PDFDocument.load(
			new Uint8Array(await blob.arrayBuffer()),
		);
		const [front, back] = doc.getPages().map(images);
		expect(front).toHaveLength(1);
		expect(back).toHaveLength(2);
		// record 2's front is in slot 2, record 1's back mirrors slot 1
		expect(front?.[0]?.[0]).toBeCloseTo(back?.[0]?.[0] ?? 0, 2);
	});

	it("under All variants, each record in each variant is a two-sided card", async () => {
		const ws = workspace(2);
		const entry = ws.templates[0] as Workspace["templates"][number];
		entry.binding = {
			datasetId: "d_1",
			fields: { display_name: { kind: "column", column: "name" } },
			variant: { kind: "all" },
		};
		const preset = sheetPreset();
		const plan = planExport(ws, preset);
		expect(withSideIndex(plan).map((i) => i.sideIndex)).toEqual([
			0, 1, 0, 1, 0, 1, 0, 1,
		]);
		expect(planSheets(plan, membershipCard(), preset)?.error).toBeUndefined();

		const pages: unknown[] = [];
		const result = await runExportJob(ws, preset, {
			pool: pngPool(),
			assemblePdf: async (p, options) => {
				pages.push(...p);
				return assemblePdf(p, options);
			},
		});
		expect(result.items.every((i) => i.ok)).toBe(true);
		expect(pages).toMatchObject([
			{ recordId: "r_1", sideIndex: 0 },
			{ recordId: "r_1", sideIndex: 1 },
			{ recordId: "r_1", sideIndex: 0, variantId: "midnight" },
			{ recordId: "r_1", sideIndex: 1, variantId: "midnight" },
			{ recordId: "r_2", sideIndex: 0 },
			{ recordId: "r_2", sideIndex: 1 },
			{ recordId: "r_2", sideIndex: 0, variantId: "midnight" },
			{ recordId: "r_2", sideIndex: 1, variantId: "midnight" },
		]);
		const blob = result.file?.blob as Blob;
		const doc = await PDFDocument.load(
			new Uint8Array(await blob.arrayBuffer()),
		);
		const [front, back] = doc.getPages().map(images);
		expect(front).toHaveLength(4);
		expect(back).toHaveLength(4);
	});

	it("refuses a layout the card doesn't fit before rendering anything", async () => {
		const pool = pngPool();
		await expect(
			runExportJob(workspace(2), sheetPreset({ marginMm: 70 }), {
				pool,
				assemblePdf,
			}),
		).rejects.toBeInstanceOf(SheetLayoutError);
		expect(pool.requests).toHaveLength(0);
	});
});
