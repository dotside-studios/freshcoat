import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PRINT_TARGETS } from "@freshcoat-js/for-print";
import {
	DEFAULT_FILE_NAME_PATTERN,
	DEFAULT_SHEET_LAYOUT,
	type ExportPreset,
	newPreset,
	type Workspace,
} from "@freshcoat-js/workspace";
import { assetsByRef, itemRequest, presetReadiness } from "@freshcoat-js/workspace/export";
import { type BatchOptions, batchPreset } from "../src/commands/batch";
import { createLog } from "../src/io";
import { card, type Sandbox, sandbox, solidPng } from "./helpers";

let box: Sandbox;

beforeAll(async () => {
	box = await sandbox();
	const photo = card({ fonts: undefined });
	photo.fields.properties.photo = { type: "string", format: "image" } as never;
	for (const frame of photo.template_data)
		for (const element of frame.elements)
			if (element.type === "image") element.properties.src = "{{photo}}";
	await box.write("photo.json", JSON.stringify(photo));
	await box.write("wide.png", await solidPng(300, 200, [200, 20, 20]));
	await box.write("tall.png", await solidPng(120, 240, [20, 200, 20]));
	await box.write("people.csv", "name,photo\nAna,wide.png\nBen,tall.png\n");
});

afterAll(() => box.cleanup());

async function fromCli(options: Omit<BatchOptions, "quiet">) {
	const io = { stdout: () => {}, stderr: () => {}, cwd: box.dir };
	return batchPreset("photo.json", { ...options, quiet: true }, io, createLog(io, true));
}

/** What the export renders for each item of a preset: the plan, each item's
 *  render request and size, and how the items land on sheets. */
function rendered(workspace: Workspace, preset: ExportPreset) {
	const { entry, plan, sheets } = presetReadiness(workspace, preset);
	if (!entry) throw new Error("no template");
	const assets = assetsByRef(workspace.datasets[0]?.assets);
	return {
		plan,
		requests: plan.map((item) => itemRequest(entry.template, preset, item, assets)),
		sheets,
	};
}

describe("a preset built from flags", () => {
	test("renders as Studio's preset with the same settings: photo size, print target, analysis", async () => {
		const target = PRINT_TARGETS.at(-1);
		if (!target) throw new Error("no print target");
		const { workspace, preset } = await fromCli({
			data: "people.csv",
			out: "cards.zip",
			sizeFrom: "photo",
			maxEdge: 200,
			printTarget: target.id,
			analyze: false,
		});
		const templateId = workspace.templates[0]?.id as string;
		const studio: ExportPreset = {
			...newPreset(templateId, []),
			markExported: false,
			size: { kind: "image", field: "photo", maxEdge: 200 },
			print: {
				enabled: true,
				...(target.id === PRINT_TARGETS[0]?.id ? {} : { target: target.id }),
				analyze: false,
			},
		};
		expect(studio.fileName).toBe(DEFAULT_FILE_NAME_PATTERN);
		const cli = rendered(workspace, preset);
		expect(cli).toEqual(rendered(workspace, studio));
		expect(cli.requests.map((r) => ("size" in r ? [r.size.width, r.size.height] : r))).toEqual([
			[200, 133],
			[200, 133],
			[100, 200],
			[100, 200],
		]);
		expect(cli.requests.every((r) => "request" in r && r.request.print?.analyze === false)).toBe(true);
	});

	test("lays out sheets as Studio's preset with the same orientation", async () => {
		const { workspace, preset } = await fromCli({
			data: "people.csv",
			out: "sheets.pdf",
			sheets: "a5",
			orientation: "landscape",
			marks: ["crop"],
		});
		const studio: ExportPreset = {
			...newPreset(workspace.templates[0]?.id as string, []),
			format: "pdf",
			markExported: false,
			layout: { ...DEFAULT_SHEET_LAYOUT, paper: "a5", orientation: "landscape" },
		};
		const cli = rendered(workspace, preset);
		expect(cli).toEqual(rendered(workspace, studio));
		expect(cli.sheets?.imposition?.paper.orientation).toBe("landscape");
		const auto = await fromCli({ data: "people.csv", out: "sheets.pdf", sheets: "a5" });
		expect(rendered(auto.workspace, auto.preset).sheets?.layout.orientation).toBe("auto");
	});

	test("refuses a photo size from a field that holds no image", async () => {
		await expect(fromCli({ data: "people.csv", out: "cards.zip", sizeFrom: "name" })).rejects.toThrow(
			"--size-from needs an image field; the template's are photo",
		);
	});
});
