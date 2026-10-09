import { type Template, validate } from "@freshcoat-js/coatfile";
import type {
	DataRecord,
	Dataset,
	ExportItem,
	ExportPreset,
} from "@freshcoat-js/workspace";
import {
	DEFAULT_SHEET_LAYOUT,
	newPreset,
	planExport,
} from "@freshcoat-js/workspace";
import {
	assetsByRef,
	itemTemplate,
	type JobResult,
} from "@freshcoat-js/workspace/export";
import { describe, expect, test } from "vitest";
import {
	bulkStatusAction,
	fileNameExample,
	filterRecords,
	formatDuration,
	formatEta,
	formatPageSize,
	imageFieldKeys,
	labelColumn,
	recordLabel,
	selectedIds,
	settingsSummary,
	statusActions,
} from "~/export/export-ui";
import { photoWatermark } from "~/samples/photo-watermark";
import { doc } from "./doc-fixture";

const records: DataRecord[] = [
	{ id: "r1", status: "pending", values: { name: "Ada" } },
	{ id: "r2", status: "exported", values: { name: "Bo" } },
	{ id: "r3", status: "failed", values: { name: "" }, error: "boom" },
	{ id: "r4", status: "skipped", values: { name: "Di" } },
];

function preset(patch: Partial<ExportPreset> = {}): ExportPreset {
	return { ...newPreset("t_doc", [], "p_1"), ...patch };
}

function result(items: JobResult["items"], cancelled = false): JobResult {
	return { items, cancelled, ms: 10 };
}

const item = (recordId: string, side: string, ok: boolean, error?: string) => ({
	key: `${recordId}:${side}`,
	recordId,
	side,
	fileName: `${recordId}-${side}.png`,
	ok,
	...(error ? { error } : {}),
});

describe("file name example", () => {
	test("is the first planned file", () => {
		const plan = [{ fileName: "doc-1-front.png" }] as ExportItem[];
		expect(fileNameExample(plan, preset(), doc())).toBe("doc-1-front.png");
	});

	test("with nothing planned, it is the pattern on the first side", () => {
		expect(fileNameExample([], preset(), doc())).toBe("doc-1-front.png");
		expect(
			fileNameExample([], preset({ scale: 2, fileName: "{{side}} x" }), doc()),
		).toBe("front-x@2x.png");
	});

	test("follows the plan's names and scale suffix", () => {
		const template = doc();
		const ws = {
			formatVersion: "1.0" as const,
			name: "W",
			templates: [{ id: "t_doc", fileName: "doc.coat", template }],
			datasets: [],
			presets: [],
		};
		const p = preset({ scale: 3 });
		expect(fileNameExample(planExport(ws, p), p, template)).toBe(
			"doc-1-front@3x.png",
		);
	});
});

describe("readouts", () => {
	test("page size is the design size at the DPI", () => {
		expect(formatPageSize({ width: 1012, height: 638 }, 300)).toBe(
			"3.37 × 2.13 in · 85.7 × 54.0 mm",
		);
		expect(formatPageSize({ width: 1012, height: 638 }, 0)).toBe("");
	});

	test("the settings summary names each tab's choices", () => {
		const preset = newPreset("t_doc", [], "p_1");
		expect(settingsSummary(preset)).toBe("PNG · 1× · Download");
		expect(
			settingsSummary({
				...preset,
				format: "jpeg-zip",
				size: { kind: "image", field: "photo" },
				destination: "folder",
				print: { enabled: true },
			}),
		).toBe("JPEG · Match image · Card printer · Folder");
		expect(
			settingsSummary({
				...preset,
				format: "pdf",
				scale: 2,
				destination: "folder",
				layout: DEFAULT_SHEET_LAYOUT,
			}),
		).toBe("PDF · 2× · 300 DPI · Sheets · Download");
	});

	test("durations and ETAs", () => {
		expect(formatDuration(420)).toBe("420 ms");
		expect(formatDuration(3200)).toBe("3.2 s");
		expect(formatDuration(18_400)).toBe("18 s");
		expect(formatDuration(125_000)).toBe("2 min 5 s");
		expect(formatDuration(120_000)).toBe("2 min");
		expect(formatEta(0)).toBe("");
		expect(formatEta(300)).toBe("~1.0 s left");
		expect(formatEta(18_000)).toBe("~18 s left");
	});

	test("records are known by their first text column", () => {
		const ds = {
			id: "d",
			name: "D",
			columns: [
				{ key: "n", type: "integer" as const },
				{ key: "name", type: "text" as const },
			],
			records,
			assets: [],
		};
		expect(labelColumn(ds)).toBe("name");
		expect(recordLabel(records[0] as DataRecord, "name")).toBe("Ada");
		expect(recordLabel(records[2] as DataRecord, "name")).toBe("r3");
	});
});

describe("record statuses", () => {
	test("the list filters by status", () => {
		expect(filterRecords(records, "all")).toHaveLength(4);
		expect(filterRecords(records, "failed").map((r) => r.id)).toEqual(["r3"]);
	});

	test("a selection resolves to ids in dataset order", () => {
		const visible = filterRecords(records, "pending");
		expect(selectedIds("all", visible, records)).toEqual(["r1"]);
		expect(
			selectedIds(new Set(["r3", "r1", "nope"]), visible, records),
		).toEqual(["r1", "r3"]);
	});

	test("a bulk change is one setRecordStatus", () => {
		expect(bulkStatusAction("d", ["r1", "r2"], "skipped")).toEqual({
			type: "setRecordStatus",
			datasetId: "d",
			ids: ["r1", "r2"],
			status: "skipped",
		});
		expect(bulkStatusAction("d", [], "pending")).toBeNull();
	});

	test("a finished job marks records exported or failed", () => {
		const now = new Date("2026-09-25T10:00:00Z");
		const r = result([
			item("r1", "front", true),
			item("r1", "back", true),
			item("r2", "front", true),
			item("r2", "back", false, "font"),
			item("r3", "front", false),
		]);
		expect(statusActions(r, "d", now)).toEqual([
			{
				type: "setRecordStatus",
				datasetId: "d",
				ids: ["r1"],
				status: "exported",
				exportedAt: "2026-09-25T10:00:00.000Z",
				fromJob: true,
			},
			{
				type: "setRecordStatus",
				datasetId: "d",
				ids: ["r2", "r3"],
				status: "failed",
				errors: { r2: "font", r3: "Failed" },
				fromJob: true,
			},
		]);
	});

	test("nothing is marked for an unbound template or a cancelled job", () => {
		const r = result([item("r1", "front", true)]);
		expect(statusActions(r, undefined)).toEqual([]);
		expect(statusActions({ ...r, cancelled: true }, "d")).toEqual([]);
		expect(statusActions(result([item("", "front", true)]), "d")).toEqual([]);
	});
});

describe("photo export helpers", () => {
	const photo = {
		sha256: "p",
		contentType: "image/jpeg",
		name: "p.jpg",
		size: 1,
		width: 4000,
		height: 3000,
		orientation: 6,
		blob: new Blob([]),
	};
	const dataset = {
		id: "d",
		name: "Photos",
		columns: [],
		records: [],
		assets: [photo],
	};
	const photoSizedTemplate = (
		template: Template,
		p: ExportPreset,
		it: { values: Record<string, string>; variantId?: string },
		d: Dataset,
	) => itemTemplate(template, p, it, assetsByRef(d.assets));

	test("the example file name follows the format and the size", () => {
		expect(
			fileNameExample([], preset({ format: "jpeg-zip", scale: 2 }), doc()),
		).toBe("doc-1-front@2x.jpg");
		expect(
			fileNameExample(
				[],
				preset({
					format: "webp-zip",
					scale: 2,
					size: { kind: "image", field: "photo" },
				}),
				doc(),
			),
		).toBe("doc-1-front.webp");
	});

	test("a photo-sized preview takes the photo's aspect, as seen", () => {
		const watermark = photoWatermark();
		const sized = photoSizedTemplate(
			watermark,
			preset({ size: { kind: "image", field: "photo" } }),
			{ values: { photo: "ws:p" } },
			dataset,
		);
		// 3000 x 4000 as seen, laid out with the short side at 1200
		expect([sized.width, sized.height]).toEqual([1200, 1600]);
		expect(
			photoSizedTemplate(
				watermark,
				preset(),
				{ values: { photo: "ws:p" } },
				dataset,
			),
		).toBe(watermark);
		expect(
			photoSizedTemplate(
				watermark,
				preset({ size: { kind: "image", field: "photo" } }),
				{ values: { photo: "ws:gone" } },
				dataset,
			),
		).toBe(watermark);
	});

	test("a photo-sized preview lays out the item's sized variant", () => {
		const sized = photoSizedTemplate(
			photoWatermark(),
			preset({ size: { kind: "image", field: "photo" } }),
			{ values: { photo: "ws:p" }, variantId: "portrait" },
			dataset,
		);
		expect([sized.width, sized.height]).toEqual([1200, 1600]);
		expect(sized.variants).toBeUndefined();
		const mark = sized.template_data[0]?.elements.find(
			(e) => e.id === "watermark",
		);
		expect(mark?.type === "text" && mark.properties.align).toBe("center");
	});

	test("a photo whose aspect gives a fractional design size still previews", () => {
		const odd = {
			...photo,
			sha256: "q",
			width: 1600,
			height: 1066,
			orientation: 1,
		};
		const sized = photoSizedTemplate(
			photoWatermark(),
			preset({ size: { kind: "image", field: "photo" } }),
			{ values: { photo: "ws:q" } },
			{ ...dataset, assets: [odd] },
		);
		expect(Number.isInteger(sized.width)).toBe(true);
		expect(Number.isInteger(sized.height)).toBe(true);
		expect(validate(sized).ok).toBe(true);
	});

	test("image fields", () => {
		expect(imageFieldKeys(photoWatermark())).toEqual(["photo", "logo"]);
		expect(imageFieldKeys(undefined)).toEqual([]);
	});
});
