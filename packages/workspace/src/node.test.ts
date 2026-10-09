import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Renderer } from "@freshcoat-js/coatfile";
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packWorkspace, WorkspaceReadError } from "./archive";
import { exportWorkspace, findPreset, REPORT_FILE_NAME } from "./export";
import { fileOutput, readWorkspaceFile } from "./node";
import { planExport } from "./plan";
import { preset, workspace } from "./test-fixtures";
import type { ExportPreset, Workspace } from "./types";

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

	it("reports records rendered without a required field", async () => {
		const [entry] = workspace.templates;
		if (!entry?.binding) throw new Error("fixture has no binding");
		const { name: _, ...fields } = entry.binding.fields;
		const unbound: Workspace = {
			...workspace,
			templates: [{ ...entry, binding: { ...entry.binding, fields } }],
		};
		const one: ExportPreset = {
			...small,
			records: "selected",
			selected: ["r_00000001"],
		};
		const result = await exportWorkspace(unbound, one, { renderer, fonts });
		expect(result.items.map((i) => [i.ok, i.unfilled])).toEqual([
			[true, ["name"]],
			[true, ["name"]],
		]);
		const blob = result.file?.blob;
		if (!blob) throw new Error("no zip");
		const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		const report = new TextDecoder()
			.decode(zip[REPORT_FILE_NAME])
			.trim()
			.split("\r\n");
		expect(report[0]?.endsWith(",unfilled")).toBe(true);
		expect(report.slice(1).every((row) => row.endsWith(",name"))).toBe(true);
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

	it("writes record statuses back when the preset marks exports", async () => {
		const now = new Date("2026-10-01T09:00:00Z");
		const selected: ExportPreset = {
			...small,
			records: "selected",
			selected: ["r_00000001", "r_00000005"],
		};
		const result = await exportWorkspace(workspace, selected, {
			renderer,
			fonts,
			output: fileOutput(join(dir, "marked.zip")),
			now,
		});
		const records = result.workspace.datasets[0]?.records ?? [];
		expect(
			records
				.filter((r) => selected.selected?.includes(r.id))
				.map((r) => [r.status, r.exportedAt]),
		).toEqual([
			["exported", now.toISOString()],
			["exported", now.toISOString()],
		]);
		expect(workspace.datasets[0]?.records[0]?.status).toBe("pending");

		const unmarked = await exportWorkspace(
			workspace,
			{ ...selected, markExported: false },
			{ renderer, fonts, output: fileOutput(join(dir, "unmarked.zip")) },
		);
		expect(unmarked.workspace).toBe(workspace);
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

	it("finds a preset by a name no other preset has", async () => {
		const named: Workspace = {
			...workspace,
			presets: [
				{ ...small, id: "p_a", name: "Cards" },
				{ ...small, id: "p_b", name: "Twice" },
				{ ...small, id: "p_c", name: "Twice" },
			],
		};
		expect(findPreset(named, "Cards")?.id).toBe("p_a");
		expect(findPreset(named, "p_b")?.id).toBe("p_b");
		expect(findPreset(named, "Twice")).toBeUndefined();
	});
});

describe("readWorkspaceFile", () => {
	it("reads a workspace from a path", async () => {
		const file = join(dir, "club.coatworkspace");
		await writeFile(file, await (await packWorkspace(workspace)).bytes());
		const read = await readWorkspaceFile(file);
		expect(read.workspace.name).toBe(workspace.name);
		expect(read.workspace.datasets[0]?.assets).toHaveLength(1);
	});

	it("throws the unpack code for a file it cannot read", async () => {
		const file = join(dir, "not.coatworkspace");
		await writeFile(file, "not a zip");
		const err = await readWorkspaceFile(file).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(WorkspaceReadError);
		expect((err as WorkspaceReadError).code).toBe("not_a_zip");
	});
});
