import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
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
import type { ExportPreset, Workspace } from "../types";
import {
	createItemRenderer,
	IMAGE_CACHE_PIXELS,
	type ItemRenderer,
	inlinePool,
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
		const bled: Workspace = {
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
		};
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
