import { decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { planExport } from "../plan";
import { photoSha, preset, workspace } from "../test-fixtures";
import type { ExportPreset } from "../types";
import {
	createItemRenderer,
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
		ck,
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
