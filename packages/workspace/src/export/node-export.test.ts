import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Template } from "@freshcoat-js/coatfile";
import {
	createRenderer,
	decodePixels,
	type FontFetch,
} from "@freshcoat-js/engine";
import { fileLoader, loadCanvasKit } from "@freshcoat-js/engine/node";
import { testFontBytes } from "@freshcoat-js/test-utils";
import { unzipSync } from "fflate";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packWorkspace } from "../archive";
import { fileOutput, folderOutput, readWorkspaceFile } from "../node";
import { planExport } from "../plan";
import { makePng, sha256 } from "../test-fixtures";
import type { ExportPreset, Workspace } from "../types";
import {
	createItemRenderer,
	type ExportOutput,
	exportWorkspace,
	type JobPool,
	REPORT_FILE_NAME,
} from "./index";

const FONT_CSS = "https://fonts.example/css2?family=Inter";
const FONT_FILE = "https://fonts.example/inter.ttf";

const photo = makePng(4, 4, [200, 40, 40]);
const photoSha = sha256(photo);
const logo = makePng(2, 2, [20, 160, 60]);

const card = (logoSrc: string): Template =>
	({
		format_version: "1.1",
		id: "badge",
		name: "Badge",
		width: 400,
		height: 250,
		fonts: [{ kind: "google", family: "Inter", url: FONT_CSS }],
		fields: {
			type: "object",
			properties: {
				name: { type: "string" },
				code: { type: "string" },
				photo: { type: "string", format: "image" },
			},
		},
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 400, height: 250 },
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "name",
						type: "text",
						pos: { x: 20, y: 20 },
						size: { width: 240, height: 40 },
						properties: {
							value: "{{name}}",
							font: { family: "Inter", size: 24 },
							color: "#111111",
						},
					},
					{
						id: "photo",
						type: "image",
						pos: { x: 280, y: 20 },
						size: { width: 100, height: 100 },
						properties: { src: "{{photo}}", fit: "cover" },
					},
					{
						id: "logo",
						type: "image",
						pos: { x: 280, y: 140 },
						size: { width: 100, height: 100 },
						properties: { src: logoSrc, fit: "cover" },
					},
					{
						id: "code",
						type: "barcode",
						pos: { x: 20, y: 120 },
						size: { width: 240, height: 110 },
						properties: { value: "{{code}}", symbology: "code128" },
					},
				],
			},
		],
	}) as Template;

function fixture(logoSrc: string, names = ["Ana", "Ben"]): Workspace {
	return {
		formatVersion: "1.0",
		name: "Badges",
		templates: [
			{
				id: "t_badge",
				fileName: "Badge.coat",
				template: card(logoSrc),
				binding: {
					datasetId: "d_people",
					fields: {
						name: { kind: "column", column: "name" },
						code: { kind: "column", column: "code" },
						photo: { kind: "column", column: "photo" },
					},
				},
			},
		],
		datasets: [
			{
				id: "d_people",
				name: "People",
				columns: [
					{ key: "name", type: "text" },
					{ key: "code", type: "text" },
					{ key: "photo", type: "image" },
				],
				records: names.map((name, i) => ({
					id: `r_${String(i + 1).padStart(8, "0")}`,
					values: {
						name,
						code: `${name[0]}-00${i + 1}`,
						...(i === 0 ? { photo: `ws:${photoSha}` } : {}),
					},
					status: "pending" as const,
				})),
				assets: [
					{
						sha256: photoSha,
						contentType: "image/png",
						name: "ana.png",
						size: photo.length,
						width: 4,
						height: 4,
						blob: new Blob([photo], { type: "image/png" }),
					},
				],
			},
		],
		presets: [],
	};
}

const preset: ExportPreset = {
	id: "p_badges",
	name: "Badges",
	templateId: "t_badge",
	records: "all",
	sides: "all",
	format: "png-zip",
	scale: 0.5,
	dpi: 300,
	fileName: "{{index}}-{{side}}",
	markExported: false,
};

const fontFetch: FontFetch = async (url) => {
	const body =
		url === FONT_CSS
			? `@font-face { font-family: 'Inter'; src: url(${FONT_FILE}) format('truetype'); }`
			: url === FONT_FILE
				? testFontBytes("Geist-Regular.ttf")
				: undefined;
	return {
		ok: body !== undefined,
		status: body === undefined ? 404 : 200,
		text: async () => String(body),
		arrayBuffer: async () => (body as Uint8Array).slice().buffer as ArrayBuffer,
	};
};

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "freshcoat-export-"));
	await writeFile(join(dir, "logo.png"), logo);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function exportFrom(
	file: string,
	job: ExportPreset,
	output: ExportOutput,
) {
	const { workspace } = await readWorkspaceFile(file);
	const renderer = await createRenderer({
		ck: await loadCanvasKit("full"),
		load: fileLoader({ root: dir }),
	});
	try {
		const result = await exportWorkspace(workspace, job, {
			renderer,
			fontOptions: { fetch: fontFetch },
			output,
		});
		expect(result.fonts?.missing).toEqual([]);
		return { workspace, result };
	} finally {
		renderer.dispose();
	}
}

async function packTo(logoSrc: string): Promise<string> {
	const file = join(dir, "badges.coatworkspace");
	await writeFile(file, await (await packWorkspace(fixture(logoSrc))).bytes());
	return file;
}

describe("export from a workspace file in Node", () => {
	it("streams a zip to disk with a relative image source", async () => {
		const out = join(dir, "badges.zip");
		const { workspace, result } = await exportFrom(
			await packTo("logo.png"),
			preset,
			fileOutput(out),
		);
		expect(result.cancelled).toBe(false);
		expect(result.items.filter((i) => !i.ok)).toEqual([]);
		expect(result.sink).toMatchObject({ kind: "zip-file", files: 3 });

		const zip = unzipSync(new Uint8Array(await readFile(out)));
		const plan = planExport(workspace, preset);
		expect(Object.keys(zip).sort()).toEqual(
			[...plan.map((i) => i.fileName), REPORT_FILE_NAME].sort(),
		);
		expect(
			new TextDecoder().decode(zip[REPORT_FILE_NAME]).trim().split("\r\n"),
		).toEqual([
			"file,record,side,status,error,print,gamut,unfilled,warnings",
			...plan.map((i) => `${i.fileName},${i.recordId},${i.side},ok,,off,,,`),
		]);

		const ck = await loadCanvasKit("full");
		for (const item of plan) {
			const pixels = decodePixels(ck, zip[item.fileName] ?? new Uint8Array());
			expect([pixels?.width, pixels?.height]).toEqual([200, 125]);
		}
		const first = decodePixels(
			ck,
			zip[plan[0]?.fileName ?? ""] ?? new Uint8Array(),
		);
		if (!first) throw new Error("no pixels");
		const at = (x: number, y: number) => {
			const i = (y * first.width + x) * 4;
			return [...first.data.slice(i, i + 3)];
		};
		expect(at(165, 35)).toEqual([200, 40, 40]);
		expect(at(165, 95)).toEqual([20, 160, 60]);
	});

	it("reads a file: image source", async () => {
		const out = join(dir, "file-url.zip");
		const { result } = await exportFrom(
			await packTo(pathToFileURL(join(dir, "logo.png")).href),
			preset,
			fileOutput(out),
		);
		expect(result.items.filter((i) => !i.ok)).toEqual([]);
		const zip = unzipSync(new Uint8Array(await readFile(out)));
		const first = decodePixels(
			await loadCanvasKit("full"),
			zip[result.items[0]?.fileName ?? ""] ?? new Uint8Array(),
		);
		if (!first) throw new Error("no pixels");
		const i = (95 * first.width + 165) * 4;
		expect([...first.data.slice(i, i + 3)]).toEqual([20, 160, 60]);
	});

	it("assembles a PDF from the same file", async () => {
		const out = join(dir, "badges.pdf");
		const { result } = await exportFrom(
			await packTo("logo.png"),
			{ ...preset, format: "pdf" },
			fileOutput(out),
		);
		expect(result.items.map((i) => i.ok)).toEqual([true, true]);
		const pdf = await PDFDocument.load(await readFile(out));
		expect(pdf.getPageCount()).toBe(2);
	});

	it("draws vector PDF pages with one copy of each font", async () => {
		const out = join(dir, "badges-vector.pdf");
		const vector: ExportPreset = {
			...preset,
			format: "pdf",
			pdfPageImage: "vector",
		};
		const shadowed = fixture("logo.png");
		const logoElement = shadowed.templates[0]?.template.template_data[0]
			?.elements[2] as { shadow?: unknown };
		logoElement.shadow = { color: "#0008", dx: 0, dy: 2, blur: 4 };
		const file = join(dir, "shadowed.coatworkspace");
		await writeFile(file, await (await packWorkspace(shadowed)).bytes());
		const { result } = await exportFrom(file, vector, fileOutput(out));
		expect(result.items.map((i) => [i.ok, i.warnings])).toEqual([
			[true, undefined],
			[true, undefined],
		]);
		const pdf = await PDFDocument.load(await readFile(out));
		expect(pdf.getPageCount()).toBe(2);
		const page = pdf.getPage(0);
		expect(page.getWidth()).toBeCloseTo((400 / 300) * 72, 3);
		expect(page.getHeight()).toBeCloseTo((250 / 300) * 72, 3);
		const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"));
		const [form] =
			xobjects instanceof PDFDict
				? xobjects.values().map((ref) => pdf.context.lookup(ref))
				: [];
		expect(
			form instanceof PDFRawStream &&
				form.dict.get(PDFName.of("Subtype"))?.toString(),
		).toBe("/Form");
		const descriptors = pdf.context
			.enumerateIndirectObjects()
			.map(([, obj]) => obj)
			.filter(
				(obj): obj is PDFDict =>
					obj instanceof PDFDict &&
					obj.get(PDFName.of("Type")) === PDFName.of("FontDescriptor"),
			);
		const fontFiles = descriptors.map((d) =>
			d.get(PDFName.of("FontFile2"))?.toString(),
		);
		expect(fontFiles).toHaveLength(2);
		expect(new Set(fontFiles).size).toBe(1);
		expect(
			new Set(descriptors.map((d) => d.get(PDFName.of("FontName"))?.toString()))
				.size,
		).toBe(1);
		expect(descriptors[0]?.get(PDFName.of("FontName"))?.toString()).toMatch(
			/^\/[A-Z]{6}\+/,
		);
	});

	it("merges the glyphs each vector page uses into one font file", async () => {
		const names = ["Quentin Zhou", "Lucy Vance", "Mara Okafor", "Jo Brandt"];
		const vector: ExportPreset = {
			...preset,
			format: "pdf",
			pdfPageImage: "vector",
		};
		const fonts = (pdf: PDFDocument) => {
			const objects = pdf.context.enumerateIndirectObjects();
			const descriptors = objects
				.map(([, obj]) => obj)
				.filter(
					(obj): obj is PDFDict =>
						obj instanceof PDFDict &&
						obj.get(PDFName.of("Type")) === PDFName.of("FontDescriptor"),
				);
			const files = descriptors.map((d) => d.get(PDFName.of("FontFile2")));
			const sizes = [...new Set(files)].map((ref) => {
				const file = ref && pdf.context.lookup(ref);
				return file instanceof PDFRawStream ? file.getContents().length : 0;
			});
			const baseFonts = objects
				.map(([, obj]) => obj)
				.filter((obj): obj is PDFDict => obj instanceof PDFDict)
				.map((d) => d.get(PDFName.of("BaseFont"))?.toString())
				.filter((n) => n !== undefined);
			return { descriptors, files, sizes, baseFonts };
		};
		const exportNames = async (file: string, selected?: string[]) => {
			const out = join(dir, `deck-${selected?.join("-") ?? "all"}.pdf`);
			await exportFrom(
				file,
				selected ? { ...vector, records: "selected", selected } : vector,
				fileOutput(out),
			);
			return out;
		};
		const file = join(dir, "deck.coatworkspace");
		await writeFile(
			file,
			await (await packWorkspace(fixture("logo.png", names))).bytes(),
		);
		const out = await exportNames(file);
		const pdf = await PDFDocument.load(await readFile(out));
		expect(pdf.getPageCount()).toBe(names.length);
		const merged = fonts(pdf);
		expect(merged.descriptors).toHaveLength(names.length);
		expect(new Set(merged.files.map(String)).size).toBe(1);
		expect(new Set(merged.baseFonts).size).toBe(1);
		let alone = 0;
		for (let i = 1; i <= names.length; i++) {
			const one = await exportNames(file, [`r_${String(i).padStart(8, "0")}`]);
			const sizes = fonts(await PDFDocument.load(await readFile(one))).sizes;
			alone += sizes[0] ?? 0;
		}
		expect(merged.sizes).toHaveLength(1);
		expect(merged.sizes[0]).toBeLessThan(alone);
		if (spawnSync("pdftotext", ["-v"]).status !== 0) return;
		const text = spawnSync("pdftotext", [out, "-"]).stdout.toString("utf8");
		for (const name of names) expect(text).toContain(name);
	});

	it("lists the characters the fonts can't draw when asked", async () => {
		const workspace = fixture("logo.png");
		const ben = workspace.datasets[0]?.records[1];
		if (ben) ben.values.name = "김민준";
		const renderer = await createRenderer({
			ck: await loadCanvasKit("full"),
			load: fileLoader({ root: dir }),
		});
		try {
			const result = await exportWorkspace(workspace, preset, {
				renderer,
				fontOptions: { fetch: fontFetch },
				checkGlyphs: true,
			});
			expect(result.glyphs).toEqual([
				{
					recordId: "r_00000002",
					side: "front",
					elementId: "name",
					text: "김민준",
					codepoints: [0xae40, 0xbbfc, 0xc900],
				},
			]);
		} finally {
			renderer.dispose();
		}
	});

	it("writes one file per item into a folder", async () => {
		const out = join(dir, "badges");
		const { workspace, result } = await exportFrom(
			await packTo("logo.png"),
			preset,
			folderOutput(out),
		);
		expect(result.items.filter((i) => !i.ok)).toEqual([]);
		expect(result.sink).toMatchObject({ kind: "folder", files: 3 });
		const plan = planExport(workspace, preset);
		expect((await readdir(out)).sort()).toEqual(
			[...plan.map((i) => i.fileName), REPORT_FILE_NAME].sort(),
		);
		const ck = await loadCanvasKit("full");
		for (const item of plan) {
			const pixels = decodePixels(ck, await readFile(join(out, item.fileName)));
			expect([pixels?.width, pixels?.height]).toEqual([200, 125]);
		}
	});

	it("puts a PDF into the folder", async () => {
		const out = join(dir, "badges-pdf");
		const { result } = await exportFrom(
			await packTo("logo.png"),
			{ ...preset, format: "pdf" },
			folderOutput(out),
		);
		const name = result.file?.name ?? "";
		expect(await readdir(out)).toEqual([name]);
		const pdf = await PDFDocument.load(await readFile(join(out, name)));
		expect(pdf.getPageCount()).toBe(2);
	});

	it("renders through a pool it is given", async () => {
		const { workspace } = await readWorkspaceFile(await packTo("logo.png"));
		const renderer = await createRenderer({
			ck: await loadCanvasKit("full"),
			load: fileLoader({ root: dir }),
		});
		const items = createItemRenderer({ renderer });
		const sides: string[] = [];
		let running = 0;
		let most = 0;
		const pool: JobPool = {
			size: 2,
			async render(request) {
				sides.push(request.side);
				most = Math.max(most, ++running);
				try {
					return await items.render(request);
				} finally {
					running--;
				}
			},
			cancel() {},
		};
		try {
			const result = await exportWorkspace(workspace, preset, {
				renderer,
				fontOptions: { fetch: fontFetch },
				pool,
			});
			expect(result.items.map((i) => i.ok)).toEqual([true, true]);
			expect(sides).toHaveLength(2);
			expect(most).toBeLessThanOrEqual(2);
		} finally {
			items.dispose();
			renderer.dispose();
		}
	});
});
