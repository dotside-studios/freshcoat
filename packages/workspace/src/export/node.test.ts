import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Renderer } from "@freshcoat-js/coatfile";
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planExport } from "../plan";
import { preset, workspace } from "../test-fixtures";
import type { ExportPreset } from "../types";
import { exportWorkspace, REPORT_FILE_NAME } from "./index";
import { fileOutput } from "./node";

const fonts = new Map([["Inter", [testFontBytes("Geist-Regular.ttf")]]]);
const small: ExportPreset = { ...preset, scale: 0.25 };

let dir: string;
let renderer: Renderer;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "freshcoat-export-"));
	renderer = await createRenderer({ ck: await loadCanvasKit() });
});

afterAll(async () => {
	renderer.dispose();
	await rm(dir, { recursive: true, force: true });
});

describe("exportWorkspace with fileOutput", () => {
	it("streams a zip to disk", async () => {
		const out = join(dir, "club.zip");
		const result = await exportWorkspace(workspace, small, {
			renderer,
			fonts,
			output: fileOutput(out),
		});
		expect(result.items.filter((i) => !i.ok)).toEqual([]);
		expect(result.sink).toMatchObject({ kind: "zip-file" });
		const zip = unzipSync(new Uint8Array(await readFile(out)));
		expect(Object.keys(zip).sort()).toEqual(
			[
				...planExport(workspace, small).map((i) => i.fileName),
				REPORT_FILE_NAME,
			].sort(),
		);
	});

	it("writes a PDF to the same kind of path", async () => {
		const out = join(dir, "club.pdf");
		const pdf: ExportPreset = {
			...small,
			format: "pdf",
			records: "selected",
			selected: ["r_00000004"],
		};
		const result = await exportWorkspace(workspace, pdf, {
			renderer,
			fonts,
			output: fileOutput(out),
		});
		expect(result.items.map((i) => i.ok)).toEqual([true, true]);
		const head = new TextDecoder().decode((await readFile(out)).subarray(0, 5));
		expect(head).toBe("%PDF-");
	});

	it("removes the partial zip when cancelled", async () => {
		const out = join(dir, "cancelled.zip");
		const controller = new AbortController();
		const result = await exportWorkspace(workspace, small, {
			renderer,
			fonts,
			output: fileOutput(out),
			signal: controller.signal,
			onProgress: (p) => {
				if (p.bytes) controller.abort();
			},
		});
		expect(controller.signal.aborted).toBe(true);
		expect(result.cancelled).toBe(true);
		expect(existsSync(out)).toBe(false);
	});

	it("finds a preset by id", async () => {
		await expect(
			exportWorkspace(workspace, "p_missing", { renderer, fonts }),
		).rejects.toThrow(/no preset "p_missing"/);
	});
});
