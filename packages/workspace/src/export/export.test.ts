import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { unzipSync } from "fflate";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDocument,
	type PDFPage,
	PDFRawStream,
} from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { SheetLayoutError } from "../impose";
import { planExport } from "../plan";
import {
	makePng,
	photoSha,
	posterPreset,
	posterWorkspace,
	preset,
	sha256,
	workspace,
} from "../test-fixtures";
import type { ExportPreset, PdfPage, SheetLayout, Workspace } from "../types";
import {
	createItemRenderer,
	IMAGE_CACHE_PIXELS,
	type ItemRenderer,
	inlinePool,
	PIECES_NEED_RASTER_PAGES,
	REPORT_FILE_NAME,
	type RenderRequest,
	runExportJob,
} from "./index";

let ck: Awaited<ReturnType<typeof loadCanvasKit>>;
let items: ItemRenderer;

beforeAll(async () => {
	ck = await loadCanvasKit();
	items = createItemRenderer({
		renderer: await createRenderer({
			ck,
			cache: { maxImagePixels: IMAGE_CACHE_PIXELS },
		}),
		fonts: new Map([["Inter", [testFontBytes("Geist-Regular.ttf")]]]),
	});
});

const template = workspace.templates[0]?.template as RenderRequest["template"];

describe("createItemRenderer", () => {
	it("renders one side at the requested scale", async () => {
		const out = await items.render({
			template,
			values: { name: "Ana" },
			side: "front",
			scale: 0.5,
			images: [],
			format: "png",
		});
		expect([out.width, out.height]).toEqual([506, 319]);
		expect(out.format).toBe("png");
		expect(out.crc).toBeTypeOf("number");
		expect(decodePixels(ck, out.bytes)?.width).toBe(506);
	});

	it("reads the request's photos by their references", async () => {
		const photo = workspace.datasets[0]?.assets[0];
		if (!photo) throw new Error("fixture has no photo");
		const ref = `ws:${photoSha}`;
		const out = await items.render({
			template,
			values: { name: "Ana", photo: ref },
			side: "front",
			scale: 0.25,
			images: [[ref, photo.blob]],
			format: "png",
		});
		const pixels = decodePixels(ck, out.bytes);
		if (!pixels) throw new Error("no pixels");
		const at = (Math.round(100 * 0.25) * pixels.width + 200) * 4;
		expect([...pixels.data.slice(at, at + 3)]).toEqual([200, 40, 40]);
	});

	it("reports a photo it could not load and still renders", async () => {
		const ref = "ws:missing";
		const out = await items.render({
			template,
			values: { name: "Ana", photo: ref },
			side: "front",
			scale: 0.25,
			images: [],
			format: "png",
		});
		expect(out.warnings).toEqual([`Couldn't load image: ${ref}`]);
	});

	it("leaves warnings unset on a clean render", async () => {
		const out = await items.render({
			template,
			values: { name: "Ana" },
			side: "front",
			scale: 0.25,
			images: [],
			format: "png",
		});
		expect(out.warnings).toBeUndefined();
	});

	it("refuses a side the template does not have", async () => {
		await expect(
			items.render({
				template,
				values: {},
				side: "inside",
				scale: 1,
				images: [],
				format: "png",
			}),
		).rejects.toThrow(/no side named "inside"/);
	});
});

describe("runExportJob on this thread", () => {
	it("writes every planned file and the report to one zip", async () => {
		const small: ExportPreset = { ...preset, scale: 0.25 };
		const plan = planExport(workspace, small);
		const result = await runExportJob(workspace, small, {
			pool: inlinePool(items),
		});
		expect(result.cancelled).toBe(false);
		expect(result.items.filter((i) => !i.ok)).toEqual([]);
		const blob = result.file?.blob;
		if (!blob) throw new Error("no zip");
		const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		expect(Object.keys(files).sort()).toEqual(
			[...plan.map((i) => i.fileName), REPORT_FILE_NAME].sort(),
		);
		const first = files[plan[0]?.fileName ?? ""];
		if (!first) throw new Error("no first file");
		expect(decodePixels(ck, first)?.width).toBe(253);
		items.endJob();
	});

	it("puts each item's warnings in the result and the report", async () => {
		const small: ExportPreset = {
			...preset,
			scale: 0.25,
			records: "selected",
			selected: ["r_00000004"],
		};
		const missing = `ws:${"0".repeat(64)}`;
		const broken = {
			...workspace,
			datasets: workspace.datasets.map((d) => ({
				...d,
				records: d.records.map((r) => ({
					...r,
					values: { ...r.values, photo: missing },
				})),
			})),
		};
		const result = await runExportJob(broken, small, {
			pool: inlinePool(items),
		});
		const front = result.items.find((i) => i.side === "front");
		expect(front?.ok).toBe(true);
		expect(front?.warnings).toEqual([`Couldn't load image: ${missing}`]);
		const blob = result.file?.blob;
		if (!blob) throw new Error("no zip");
		const report = new TextDecoder().decode(
			unzipSync(new Uint8Array(await blob.arrayBuffer()))[REPORT_FILE_NAME],
		);
		expect(report.split("\r\n")[0]).toBe(
			"file,record,side,status,error,print,gamut,unfilled,warnings",
		);
		expect(report).toContain(`,ok,,off,,,Couldn't load image: ${missing}\r\n`);
		items.endJob();
	});

	it("assembles a PDF without a worker", async () => {
		const pdf: ExportPreset = {
			...preset,
			format: "pdf",
			scale: 0.25,
			records: "selected",
			selected: ["r_00000004"],
		};
		const result = await runExportJob(workspace, pdf, {
			pool: inlinePool(items),
		});
		expect(result.items.map((i) => i.ok)).toEqual([true, true]);
		const blob = result.file?.blob;
		if (!blob) throw new Error("no pdf");
		const head = new TextDecoder().decode(
			new Uint8Array(await blob.arrayBuffer()).slice(0, 5),
		);
		expect(head).toBe("%PDF-");
		expect(result.file?.name).toBe("all.pdf");
	});
});

describe("runExportJob with split: pieces", () => {
	const zipOf = async (ws: Workspace, p: ExportPreset) => {
		const result = await runExportJob(ws, p, { pool: inlinePool(items) });
		items.endJob();
		expect(result.items.filter((i) => !i.ok)).toEqual([]);
		const blob = result.file?.blob;
		if (!blob) throw new Error("no zip");
		return unzipSync(new Uint8Array(await blob.arrayBuffer()));
	};
	const sizeOf = (bytes: Uint8Array | undefined) => {
		const d = bytes && decodePixels(ck, bytes);
		if (!d) throw new Error("no image");
		return [d.width, d.height];
	};
	const colourAt = (bytes: Uint8Array | undefined, x: number, y: number) => {
		const d = bytes && decodePixels(ck, bytes);
		if (!d) throw new Error("no image");
		const at = (y * d.width + x) * 4;
		return [...d.data.slice(at, at + 3)];
	};

	it("writes one file per piece and the other sides whole", async () => {
		const files = await zipOf(posterWorkspace, posterPreset);
		expect(Object.keys(files).sort()).toEqual([
			REPORT_FILE_NAME,
			"poster-1-back.png",
			"poster-1-front-left.png",
			"poster-1-front-right.png",
			"poster-2-back.png",
			"poster-2-front-left.png",
		]);
		expect(sizeOf(files["poster-1-front-left.png"])).toEqual([200, 200]);
		expect(sizeOf(files["poster-1-back.png"])).toEqual([400, 200]);
		expect(colourAt(files["poster-1-front-left.png"], 100, 100)).toEqual([
			255, 0, 0,
		]);
		expect(colourAt(files["poster-1-front-right.png"], 100, 100)).toEqual([
			0, 0, 255,
		]);
	});

	it("scales a piece with the preset", async () => {
		const files = await zipOf(posterWorkspace, { ...posterPreset, scale: 2 });
		expect(sizeOf(files["poster-1-front-left@2x.png"])).toEqual([400, 400]);
	});

	it("reports each piece by its file name", async () => {
		const result = await runExportJob(posterWorkspace, posterPreset, {
			pool: inlinePool(items),
		});
		items.endJob();
		expect(result.items.map((i) => i.fileName)).toEqual([
			"poster-1-front-left.png",
			"poster-1-front-right.png",
			"poster-1-back.png",
			"poster-2-front-left.png",
			"poster-2-back.png",
		]);
	});

	it("replaces the preset's bleed with the piece's own", async () => {
		const bled = {
			...posterWorkspace,
			templates: posterWorkspace.templates.map((t) => ({
				...t,
				template: {
					...t.template,
					bleed: 10,
					template_data: t.template.template_data.map((f) =>
						f.name === "front"
							? {
									...f,
									elements: f.elements.map((el) =>
										el.id === "left"
											? {
													...el,
													properties: {
														...el.properties,
														slice: { name: "left", bleed: 5 },
													},
												}
											: el,
									),
								}
							: f,
					),
				},
			})),
		} as Workspace;
		const files = await zipOf(bled, { ...posterPreset, bleed: true });
		expect(sizeOf(files["poster-1-front-left.png"])).toEqual([210, 210]);
		expect(sizeOf(files["poster-1-front-right.png"])).toEqual([200, 200]);
		expect(sizeOf(files["poster-1-back.png"])).toEqual([420, 220]);
	});

	it("scales a piece by the factor its side gets under an image size", async () => {
		const photo = makePng(100, 50);
		const ref = `ws:${sha256(photo)}`;
		const template = posterWorkspace.templates[0];
		if (!template) throw new Error("no template");
		const withPhoto: Workspace = {
			...posterWorkspace,
			templates: [
				{
					...template,
					template: {
						...template.template,
						fields: {
							...template.template.fields,
							properties: {
								...template.template.fields.properties,
								photo: { type: "string", format: "image" },
							},
						},
					},
					binding: {
						datasetId: "d_posters",
						fields: {
							...template.binding?.fields,
							photo: { kind: "column", column: "photo" },
						},
					},
				},
			],
			datasets: posterWorkspace.datasets.map((d) => ({
				...d,
				columns: [...d.columns, { key: "photo", type: "image" as const }],
				records: d.records.map((r) => ({
					...r,
					values: { ...r.values, photo: ref },
				})),
				assets: [
					{
						sha256: sha256(photo),
						contentType: "image/png",
						name: "p.png",
						size: photo.length,
						width: 100,
						height: 50,
						blob: new Blob([photo], { type: "image/png" }),
					},
				],
			})),
		};
		const files = await zipOf(withPhoto, {
			...posterPreset,
			size: { kind: "image", field: "photo" },
		});
		expect(sizeOf(files["poster-1-back.png"])).toEqual([100, 50]);
		expect(sizeOf(files["poster-1-front-left.png"])).toEqual([50, 50]);
	});
});

describe("runExportJob with split: pieces into a PDF", () => {
	const pdf = (changes: Partial<ExportPreset>): ExportPreset => ({
		...posterPreset,
		format: "pdf",
		...changes,
	});
	const sheet: SheetLayout = {
		kind: "sheet",
		paper: "a4",
		orientation: "portrait",
		marginMm: 10,
		gapMm: 0,
		cropMarks: false,
		duplex: "none",
	};
	const run = async (p: ExportPreset, assemblePdf?: never) => {
		const result = await runExportJob(posterWorkspace, p, {
			pool: inlinePool(items),
			...(assemblePdf ? { assemblePdf } : {}),
		});
		items.endJob();
		return result;
	};
	const load = async (result: Awaited<ReturnType<typeof run>>) => {
		const blob = result.file?.blob;
		if (!blob) throw new Error("no pdf");
		return PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
	};

	it("makes a page for each piece, sized by its own pixels", async () => {
		const doc = await load(await run(pdf({})));
		const sizes = doc
			.getPages()
			.map((page) => page.getSize())
			.map(({ width, height }) => [Math.round(width), Math.round(height)]);
		// 200 and 400 px at 300 dpi are 48 and 96 pt
		expect(sizes).toEqual([
			[48, 48],
			[48, 48],
			[96, 48],
			[48, 48],
			[96, 48],
		]);
	});

	it("sizes pages by the preset's scale and dpi", async () => {
		const doc = await load(await run(pdf({ scale: 2, dpi: 144 })));
		const [first] = doc.getPages().map((page) => page.getSize());
		expect([first?.width, first?.height]).toEqual([200, 200]);
	});

	it("imposes pieces of one size on sheets as cards of that size", async () => {
		let options: Record<string, unknown> | undefined;
		const result = await runExportJob(
			posterWorkspace,
			pdf({ sides: ["front"], layout: sheet }),
			{
				pool: inlinePool(items),
				assemblePdf: async (pages, o) => {
					options = o;
					return (await import("../pdf")).assemblePdf(pages, o);
				},
			},
		);
		items.endJob();
		const mm = (200 / 300) * 25.4;
		expect(options?.cardMm).toEqual({ widthMm: mm, heightMm: mm });
		expect(options?.bleedMm).toBeUndefined();
		const doc = await load(result);
		expect(doc.getPageCount()).toBe(1);
		const [page] = doc.getPages();
		expect([
			Math.round(page?.getWidth() ?? 0),
			Math.round(page?.getHeight() ?? 0),
		]).toEqual([595, 842]);
	});

	it("refuses sheets when the items differ in size", async () => {
		await expect(run(pdf({ layout: sheet }))).rejects.toThrow(SheetLayoutError);
		await expect(run(pdf({ layout: sheet }))).rejects.toThrow(/one piece size/);
	});

	it("refuses vector pages", async () => {
		await expect(run(pdf({ pdfPageImage: "vector" }))).rejects.toThrow(
			PIECES_NEED_RASTER_PAGES,
		);
	});

	it("still draws a preset that does not split as vectors", async () => {
		const result = await run(
			pdf({ split: "none", pdfPageImage: "vector", sides: ["back"] }),
		);
		expect(result.items.every((i) => i.ok)).toBe(true);
	});
});

describe("runExportJob with cut files", () => {
	const edges: Record<string, Record<string, unknown>> = {
		left: { name: "left", edge: "through" },
		right: { name: "right", edge: "kiss" },
		cut: { name: "cut", output: "none", edge: "score" },
	};
	const edged = (bleed?: number) =>
		({
			...posterWorkspace,
			templates: posterWorkspace.templates.map((t) => ({
				...t,
				template: {
					...t.template,
					...(bleed ? { bleed } : {}),
					template_data: t.template.template_data.map((f) =>
						f.name === "front"
							? {
									...f,
									elements: f.elements.map((el) =>
										el.id in edges
											? {
													...el,
													properties: { ...el.properties, slice: edges[el.id] },
												}
											: el,
									),
								}
							: f,
					),
				},
			})),
		}) as Workspace;
	const zipOf = async (ws: Workspace, p: ExportPreset) => {
		const result = await runExportJob(ws, p, { pool: inlinePool(items) });
		items.endJob();
		expect(result.items.filter((i) => !i.ok)).toEqual([]);
		const blob = result.file?.blob;
		if (!blob) throw new Error("no zip");
		return unzipSync(new Uint8Array(await blob.arrayBuffer()));
	};
	const text = (bytes: Uint8Array | undefined) =>
		new TextDecoder().decode(bytes);

	it("writes an SVG beside each piece that has lines, with its name", async () => {
		const files = await zipOf(edged(), { ...posterPreset, cutFile: "svg" });
		expect(Object.keys(files).sort()).toEqual([
			REPORT_FILE_NAME,
			"poster-1-back.png",
			"poster-1-front-left.png",
			"poster-1-front-left.svg",
			"poster-1-front-right.png",
			"poster-1-front-right.svg",
			"poster-2-back.png",
			"poster-2-front-left.png",
			"poster-2-front-left.svg",
		]);
		const left = text(files["poster-1-front-left.svg"]);
		expect(left).toContain('viewBox="0 0 200 200"');
		expect(left).toContain('<g id="through">');
		expect(left).toContain('<g id="score">');
		expect(left).not.toContain('id="kiss"');
		const right = text(files["poster-1-front-right.svg"]);
		expect(right).toContain('<g id="kiss">');
		expect(right).not.toContain('id="score"');
	});

	it("writes DXF files in place of SVG", async () => {
		const files = await zipOf(edged(), { ...posterPreset, cutFile: "dxf" });
		const names = Object.keys(files);
		expect(names).toContain("poster-1-front-left.dxf");
		expect(names.some((n) => n.endsWith(".svg"))).toBe(false);
		expect(text(files["poster-1-front-left.dxf"])).toContain("THROUGH");
	});

	it("writes nothing by default or for none", async () => {
		for (const cutFile of [undefined, "none" as const]) {
			const files = await zipOf(edged(), {
				...posterPreset,
				...(cutFile ? { cutFile } : {}),
			});
			expect(Object.keys(files).filter((n) => !n.endsWith(".png"))).toEqual([
				REPORT_FILE_NAME,
			]);
		}
	});

	it("writes no file for an item without lines", async () => {
		const files = await zipOf(posterWorkspace, {
			...posterPreset,
			cutFile: "svg",
		});
		expect(Object.keys(files).some((n) => n.endsWith(".svg"))).toBe(false);
	});

	it("names the sidecar like its image, scale suffix and all, in design units", async () => {
		const files = await zipOf(edged(), {
			...posterPreset,
			scale: 2,
			cutFile: "svg",
		});
		expect(Object.keys(files)).toContain("poster-1-front-left@2x.svg");
		expect(text(files["poster-1-front-left@2x.svg"])).toContain(
			'viewBox="0 0 200 200"',
		);
	});

	it("covers a whole side, with the preset's bleed around it", async () => {
		const files = await zipOf(edged(10), {
			...posterPreset,
			split: "none",
			bleed: true,
			cutFile: "svg",
		});
		const front = text(files["poster-1-front.svg"]);
		expect(front).toContain('viewBox="0 0 420 220"');
		expect(front).toMatch(/d="M10 10L/);
		expect(Object.keys(files)).not.toContain("poster-1-back.svg");
	});

	it("leaves the trim alone when the preset has no bleed", async () => {
		const files = await zipOf(edged(10), {
			...posterPreset,
			split: "none",
			cutFile: "svg",
		});
		expect(text(files["poster-1-front.svg"])).toContain(
			'viewBox="0 0 400 200"',
		);
	});

	it("reports the same items as without cut files", async () => {
		const run = (changes: Partial<ExportPreset>) =>
			runExportJob(
				edged(),
				{ ...posterPreset, ...changes },
				{ pool: inlinePool(items) },
			);
		const a = await run({});
		const b = await run({ cutFile: "svg" });
		items.endJob();
		expect(b.items).toEqual(a.items);
	});

	describe("into a PDF", () => {
		const pdfOf = async (ws: Workspace, p: ExportPreset) => {
			let pages: PdfPage[] = [];
			const result = await runExportJob(ws, p, {
				pool: inlinePool(items),
				assemblePdf: async (given, o) => {
					pages = given;
					return (await import("../pdf")).assemblePdf(given, o);
				},
			});
			items.endJob();
			const blob = result.file?.blob;
			if (!blob) throw new Error("no pdf");
			const doc = await PDFDocument.load(
				new Uint8Array(await blob.arrayBuffer()),
			);
			return { pages, doc };
		};
		const pdf = (changes: Partial<ExportPreset> = {}): ExportPreset => ({
			...posterPreset,
			format: "pdf",
			...changes,
		});
		const red = (page: PDFPage) => {
			const contents = page.node.Contents();
			const streams =
				contents instanceof PDFArray
					? contents.asArray().map((ref) => page.doc.context.lookup(ref))
					: [contents];
			return streams.some(
				(stream) =>
					stream instanceof PDFRawStream &&
					new TextDecoder("latin1")
						.decode(decodePDFRawStream(stream).decode())
						.includes("1 0 0 RG"),
			);
		};

		it("hands each page its piece's lines when the preset draws them", async () => {
			const { pages, doc } = await pdfOf(edged(), pdf({ cutLines: true }));
			expect(pages.map((p) => p.cut?.lines.map((l) => l.name))).toEqual([
				["left", "cut"],
				["right"],
				undefined,
				["left", "cut"],
				undefined,
			]);
			const flags = doc.getPages().map(red);
			expect(flags).toEqual([true, false, false, true, false]);
		});

		it("draws none by default", async () => {
			const { pages, doc } = await pdfOf(edged(), pdf());
			expect(pages.every((p) => p.cut === undefined)).toBe(true);
			expect(doc.getPages().some(red)).toBe(false);
		});

		it("draws the lines of vector pages", async () => {
			const { pages } = await pdfOf(
				edged(),
				pdf({
					split: "none",
					sides: ["front"],
					pdfPageImage: "vector",
					cutLines: true,
				}),
			);
			expect(pages.map((p) => p.cut?.lines.length)).toEqual([3, 2]);
		});

		it("lays the lines out on sheets", async () => {
			const { doc } = await pdfOf(
				edged(),
				pdf({
					sides: ["front"],
					cutLines: true,
					layout: {
						kind: "sheet",
						paper: "a4",
						orientation: "portrait",
						marginMm: 10,
						gapMm: 0,
						cropMarks: false,
						duplex: "none",
					},
				}),
			);
			expect(doc.getPageCount()).toBe(1);
			expect(red(doc.getPages()[0] as PDFPage)).toBe(true);
		});
	});

	it("ignores the cut file option for a PDF", async () => {
		const result = await runExportJob(
			edged(),
			{ ...posterPreset, format: "pdf", cutFile: "svg" },
			{ pool: inlinePool(items) },
		);
		items.endJob();
		expect(result.file?.mediaType).toBe("application/pdf");
	});
});
