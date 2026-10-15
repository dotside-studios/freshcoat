import type { ExportItem } from "@freshcoat-js/workspace";
import { DEFAULT_SHEET_LAYOUT, newPreset } from "@freshcoat-js/workspace";
import { describe, expect, test } from "vitest";
import {
	exportEstimate,
	filesSummary,
	formatSummary,
	presetLine,
	presetRecordCount,
	printSummary,
	sizeSummary,
} from "~/export/export-ui";
import { PRESET_STARTERS, presetFromStarter } from "~/export/starters";

const base = () => newPreset("t_1", [], "p_1");
const items = (ids: string[]) =>
	ids.map((recordId) => ({ recordId }) as ExportItem);

describe("section summaries", () => {
	test("read the value of each section", () => {
		expect(formatSummary({ ...base(), format: "pdf" })).toBe("PDF · 300 dpi");
		expect(formatSummary({ ...base(), format: "jpeg-zip" })).toBe("JPEG · 90%");
		expect(sizeSummary({ ...base(), scale: 2 })).toBe("2×");
		expect(sizeSummary(base(), { width: 1050, height: 600 })).toBe(
			"1050 × 600 px",
		);
		expect(printSummary(base())).toBe("Off");
		expect(
			printSummary({
				...base(),
				format: "pdf",
				layout: { ...DEFAULT_SHEET_LAYOUT, cropMarks: true },
			}),
		).toBe("Sheets · A4 · crop marks");
		expect(filesSummary({ ...base(), fileName: "{{record}}" })).toBe(
			"Download · {{record}}",
		);
	});
});

describe("export estimate", () => {
	test("counts files for images and records for a PDF", () => {
		const png = base();
		expect(exportEstimate(png, items(["a", "a", "b", "b"]))).toBe(
			"4 files · PNG zip",
		);
		const pdf = { ...base(), format: "pdf" as const };
		expect(exportEstimate(pdf, items(["a", "a", "b"]))).toBe(
			"2 records · PDF · 1 file",
		);
		expect(exportEstimate(pdf, items(["a"]), 3)).toBe(
			"1 record · PDF · 3 sheets",
		);
	});
});

describe("preset rows", () => {
	test("count the records a preset exports", () => {
		const templates = [{ id: "t_1", binding: { datasetId: "d" } }];
		const dataset = {
			id: "d",
			name: "D",
			columns: [],
			records: [
				{ id: "r1", status: "pending", values: {} },
				{ id: "r2", status: "skipped", values: {} },
			],
		};
		// biome-ignore lint/suspicious/noExplicitAny: a minimal dataset
		const datasets = [dataset] as any;
		expect(presetRecordCount(base(), templates, datasets)).toBe(1);
		expect(presetRecordCount(base(), [], datasets)).toBeNull();
		expect(presetLine({ ...base(), format: "pdf" }, 120)).toBe(
			"PDF · 300 dpi · 120 records",
		);
		expect(presetLine({ ...base(), scale: 2 }, null)).toBe(
			"PNG · 2× · not bound",
		);
	});
});

describe("starter presets", () => {
	test("shape a preset from existing fields", () => {
		const press = PRESET_STARTERS.find((s) => s.id === "press-pdf");
		const made = presetFromStarter(press, "t_1", [base()]);
		expect(made).toMatchObject({
			name: "Press PDF",
			templateId: "t_1",
			format: "pdf",
			pdfPageImage: "vector",
			bleed: true,
			layout: { kind: "sheet", cropMarks: true },
		});
		const web = presetFromStarter(
			PRESET_STARTERS.find((s) => s.id === "png-web"),
			"t_1",
			[],
		);
		expect(web).toMatchObject({ format: "png-zip", scale: 2 });
	});

	test("a blank preset is the default, and names stay unique", () => {
		expect(presetFromStarter(undefined, "t_1", [])).toMatchObject({
			name: "New preset",
			format: "png-zip",
		});
		const press = PRESET_STARTERS[0];
		const first = presetFromStarter(press, "t_1", []);
		expect(presetFromStarter(press, "t_1", [first]).name).toBe("Press PDF 2");
	});

	test("are grouped Print and Digital", () => {
		expect(new Set(PRESET_STARTERS.map((s) => s.group))).toEqual(
			new Set(["print", "digital"]),
		);
	});
});
