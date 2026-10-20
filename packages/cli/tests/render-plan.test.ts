import { describe, expect, test } from "bun:test";
import { planRender, type RenderInput } from "../src/commands/render-plan";
import { UsageError } from "../src/io";

const ARCHIVE_REFUSAL =
	"a templates .zip renders each template's frames into a directory; --data, a .zip or .pdf --out and the export options need one template";

const input = (options: Partial<RenderInput> = {}): RenderInput => ({
	cropMarks: true,
	quiet: false,
	...options,
});

function refusal(file: string, options: Partial<RenderInput>): string {
	try {
		planRender(file, input(options));
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as UsageError).message;
	}
	throw new Error("planned without a usage error");
}

describe("planRender", () => {
	test("renders a template into a directory", () => {
		expect(planRender("card.coat", input({ out: "out", scale: [1, 2], set: { name: "Ana" } }))).toEqual({
			kind: "template",
			options: { out: "out", scale: [1, 2], set: { name: "Ana" }, quiet: false },
		});
		expect(planRender("card.coat", input())).toEqual({ kind: "template", options: { quiet: false } });
		expect(planRender("card.coat", input({ pngAlpha: "keep", format: "png" }))).toEqual({
			kind: "template",
			options: { pngAlpha: "keep", format: "png", quiet: false },
		});
	});

	test("exports a template to a zip, a PDF or, with --data, a directory", () => {
		for (const out of ["cards.zip", "cards.PDF"])
			expect(planRender("card.coat", input({ out })).kind).toBe("batch");
		expect(planRender("card.coat", input({ data: "people.csv", out: "cards", quality: 80, format: "jpeg" }))).toEqual({
			kind: "batch",
			options: { data: "people.csv", out: "cards", quality: 80, format: "jpeg", cropMarks: true, quiet: false },
		});
	});

	test("exports a template's pieces into a directory, a zip or a PDF", () => {
		expect(planRender("card.coat", input({ pieces: true }))).toEqual({
			kind: "batch",
			options: { pieces: true, out: ".", cropMarks: true, quiet: false },
		});
		expect(planRender("card.coat", input({ pieces: true, out: "dir" })).kind).toBe("batch");
		expect(planRender("card.coat", input({ pieces: true, out: "x.pdf", pdfPages: "jpeg" })).kind).toBe("batch");
	});

	test("passes --pieces to a workspace preset", () => {
		expect(planRender("club.coatworkspace", input({ preset: "All", out: "x.zip", pieces: true }))).toEqual({
			kind: "workspace",
			options: { preset: "All", pieces: true, out: "x.zip", quiet: false },
		});
	});

	test("exports a template's cut files into a directory, a zip or a PDF", () => {
		expect(planRender("card.coat", input({ cut: "svg" }))).toEqual({
			kind: "batch",
			options: { cut: "svg", out: ".", cropMarks: true, quiet: false },
		});
		expect(planRender("card.coat", input({ cut: "dxf", out: "x.zip" })).kind).toBe("batch");
		expect(planRender("card.coat", input({ cutLines: true, out: "x.pdf" }))).toEqual({
			kind: "batch",
			options: { cutLines: true, out: "x.pdf", cropMarks: true, quiet: false },
		});
	});

	test("exports a template through a print target into a directory, a zip or a PDF", () => {
		expect(planRender("card.coat", input({ printTarget: "ymcko-dye-sub", printProfile: "printer.json" }))).toEqual({
			kind: "batch",
			options: { printTarget: "ymcko-dye-sub", printProfile: "printer.json", out: ".", cropMarks: true, quiet: false },
		});
		expect(planRender("card.coat", input({ printProfile: "printer.json" }))).toEqual({
			kind: "batch",
			options: { printProfile: "printer.json", out: ".", cropMarks: true, quiet: false },
		});
		expect(planRender("card.coat", input({ printTarget: "none", out: "x.zip" })).kind).toBe("batch");
		expect(planRender("card.coat", input({ printTarget: "ymcko-dye-sub", out: "x.pdf" })).kind).toBe("batch");
	});

	test("takes a back offset and blank backs with --sheets and --duplex", () => {
		const sheets = { out: "x.pdf", sheets: "a4" as const, duplex: "long" as const };
		expect(planRender("card.coat", input({ ...sheets, backOffset: { x: 1, y: -2 }, blankBacks: true }))).toEqual({
			kind: "batch",
			options: { ...sheets, backOffset: { x: 1, y: -2 }, blankBacks: true, cropMarks: true, quiet: false },
		});
	});

	test("passes --cut and --cut-lines to a workspace preset", () => {
		expect(planRender("club.coatworkspace", input({ preset: "All", out: "x.zip", cut: "dxf" }))).toEqual({
			kind: "workspace",
			options: { preset: "All", cut: "dxf", out: "x.zip", quiet: false },
		});
		expect(planRender("club.coatworkspace", input({ preset: "All", out: "x.pdf", cutLines: true }))).toEqual({
			kind: "workspace",
			options: { preset: "All", cutLines: true, out: "x.pdf", quiet: false },
		});
		expect(planRender("club.coatworkspace", input({ preset: "All", out: "x.pdf", cutSpot: { kiss: "K" } }))).toEqual({
			kind: "workspace",
			options: { preset: "All", cutSpot: { kiss: "K" }, out: "x.pdf", quiet: false },
		});
		expect(planRender("card.coat", input({ cutSpot: { through: "T" }, out: "x.pdf" })).kind).toBe("batch");
	});

	test("runs a workspace preset with only the workspace options", () => {
		expect(
			planRender("club.coatworkspace", input({ preset: "All", out: "x.zip", records: "failed", save: true, jobs: 2 })),
		).toEqual({
			kind: "workspace",
			options: { preset: "All", records: "failed", save: true, jobs: 2, out: "x.zip", quiet: false },
		});
		const where = [{ column: "tier", op: "equals" as const, value: "gold" }];
		expect(planRender("club.coatworkspace", input({ preset: "All", out: "x.zip", where }))).toEqual({
			kind: "workspace",
			options: { preset: "All", where, out: "x.zip", quiet: false },
		});
		expect(planRender("card.coat", input({ data: "people.csv", out: "x.zip", where })).kind).toBe("batch");
	});

	test("refuses options that do not go together", () => {
		const cases: [string, Partial<RenderInput>, string][] = [
			["club.coatworkspace", { out: "x.zip", scale: [2], format: "webp" }, "--scale, --format apply only to templates"],
			["club.coatworkspace", { preset: "All" }, "a .coatworkspace needs --out <path>"],
			["club.coatworkspace", { out: "x.zip", save: true, dryRun: true }, "--save and --dry-run do not go together"],
			["card.coat", { preset: "All", records: "all" }, "--preset, --records need a .coatworkspace file"],
			["card.coat", { name: "x", out: "dir" }, "--name needs --data or a .zip or .pdf --out"],
			["card.coat", { data: "people.csv" }, "--data needs --out <dir|file.zip|file.pdf>"],
			["card.coat", { out: "x.zip", maxEdge: 800 }, "--max-edge needs --size-from"],
			["card.coat", { out: "x.zip", sizeFrom: "photo", scale: [2] }, "--scale does not go with --size-from, which sizes each file by its photo"],
			["card.coat", { out: "x.pdf", sizeFrom: "photo", bleed: true, sheets: "a4" }, "--bleed, --sheets do not go with --size-from, which sizes each file by its photo"],
			["card.coat", { sizeFrom: "photo" }, "--size-from needs --data or a .zip or .pdf --out"],
			["card.coat", { out: "x.pdf", orientation: "landscape" }, "--orientation needs --sheets"],
			["card.coat", { out: "x.zip", orientation: "landscape" }, "--orientation applies only to a .pdf"],
			["club.coatworkspace", { out: "x.zip", sizeFrom: "photo" }, "--size-from applies only to templates"],
			["card.coat", { out: "x.zip", analyze: false }, "--no-analyze needs --print-target or --print-profile"],
			["card.coat", { out: "x.zip", analyze: false, printTarget: "none" }, "--no-analyze needs --print-target or --print-profile"],
			["club.coatworkspace", { out: "x.zip", printTarget: "ymcko-dye-sub", analyze: false }, "--print-target, --no-analyze apply only to templates"],
			["club.coatworkspace", { out: "x.zip", dpi: 600 }, "--dpi applies only to templates"],
			["templates.zip", { data: "people.csv", out: "cards" }, ARCHIVE_REFUSAL],
			["templates.zip", { out: "cards.pdf" }, ARCHIVE_REFUSAL],
			["templates.zip", { pieces: true }, ARCHIVE_REFUSAL],
			["templates.zip", { name: "x" }, "--name needs --data or a .zip or .pdf --out"],
			["card.coat", { out: "x.pdf", cropMarks: false, margin: 2 }, "--no-crop-marks, --margin need --sheets"],
			["card.coat", { out: "x.pdf", marks: ["slug"] }, "--marks needs --sheets"],
			["card.coat", { out: "x.zip", marks: ["slug"] }, "--marks applies only to a .pdf"],
			["club.coatworkspace", { out: "x.pdf", marks: ["slug"] }, "--marks applies only to templates"],
			["card.coat", { out: "x.pdf", copies: "fill" }, "--copies needs --sheets"],
			["card.coat", { out: "x.zip", copies: 2 }, "--copies applies only to a .pdf"],
			["card.coat", { out: "x.pdf", quality: 50 }, "--quality needs --pdf-pages jpeg"],
			["card.coat", { out: "x.zip", quality: 50 }, "--quality needs --format jpeg or webp"],
			["card.coat", { out: "x.pdf", format: "jpeg" }, "--format applies only to images; a PDF takes --pdf-pages"],
			["card.coat", { pngAlpha: "keep", format: "webp" }, "--png-alpha needs --format png"],
			["card.coat", { pngAlpha: "keep", format: "jpg", out: "x.zip" }, "--png-alpha needs --format png"],
			["card.coat", { pngAlpha: "keep", out: "x.pdf" }, "--png-alpha applies only to images; a PDF takes --pdf-pages"],
			["club.coatworkspace", { out: "x.zip", pngAlpha: "keep" }, "--png-alpha applies only to templates"],
			["card.coat", { out: "x.zip", scale: [1, 2] }, "an export takes one --scale"],
			["card.coat", { pieces: true, out: "x.pdf", pdfPages: "vector" }, "--pieces does not go with --pdf-pages vector"],
			["card.coat", { out: "x.pdf", pdfText: "outline" }, "--pdf-text needs --pdf-pages vector"],
			["card.coat", { out: "x.zip", pdfText: "outline" }, "--pdf-text applies only to a .pdf"],
			["club.coatworkspace", { out: "x.pdf", pdfText: "outline" }, "--pdf-text applies only to templates"],
			["card.coat", { pieces: true, out: "x.zip", scale: [1, 2] }, "an export takes one --scale"],
			["card.coat", { cut: "svg", out: "x.pdf" }, "--cut applies only to images; a PDF takes --cut-lines"],
			["card.coat", { cutLines: true, out: "x.zip" }, "--cut-lines applies only to a .pdf"],
			["card.coat", { cutLines: true, out: "cards", data: "people.csv" }, "--cut-lines applies only to a .pdf"],
			["card.coat", { cutSpot: { through: "T" }, out: "x.zip" }, "--cut-spot applies only to a .pdf"],
			["card.coat", { out: "x.zip", where: [{ column: "name", op: "empty" }] }, "--where needs --data or a .coatworkspace file"],
			["card.coat", { out: "x.zip", outputIntent: "fogra.icc" }, "--output-intent applies only to a .pdf"],
			["card.coat", { out: "x.zip", outputIntent: false }, "--no-output-intent applies only to a .pdf"],
			["card.coat", { outputIntent: false }, "--no-output-intent needs --data or a .zip or .pdf --out"],
			["card.coat", { out: "x.pdf", outputIntentId: "FOGRA39" }, "--output-intent-id needs --output-intent <file>"],
			["club.coatworkspace", { out: "x.pdf", outputIntent: "fogra.icc" }, "--output-intent applies only to templates"],
			["card.coat", { out: "x.zip", backOffset: { x: 1, y: 0 } }, "--back-offset applies only to a .pdf"],
			["card.coat", { out: "x.pdf", blankBacks: true }, "--blank-backs needs --sheets"],
			["card.coat", { out: "x.pdf", sheets: "a4", backOffset: { x: 1, y: 0 }, blankBacks: true }, "--back-offset, --blank-backs need --duplex"],
			["card.coat", { printTarget: "none", printProfile: "printer.json" }, "--print-profile does not go with --print-target none"],
			["club.coatworkspace", { out: "x.zip", printTarget: "ymcko-dye-sub" }, "--print-target applies only to templates"],
			["club.coatworkspace", { out: "x.pdf", backOffset: { x: 1, y: 0 } }, "--back-offset applies only to templates"],
		];
		for (const [file, options, message] of cases)
			expect({ file, options, message: refusal(file, options) }).toEqual({ file, options, message });
	});

	test("takes --dpi for a template, an export to images and a PDF", () => {
		expect(planRender("card.coat", input({ dpi: 600 }))).toEqual({
			kind: "template",
			options: { dpi: 600, quiet: false },
		});
		expect(planRender("card.coat", input({ dpi: 600, out: "x.zip" })).kind).toBe("batch");
		expect(planRender("card.coat", input({ dpi: 600, out: "x.pdf" })).kind).toBe("batch");
	});

	test("renders each template of a templates .zip into a directory", () => {
		expect(planRender("templates.zip", input({ out: "out", dpi: 600, scale: [2] }))).toEqual({
			kind: "template",
			options: { out: "out", dpi: 600, scale: [2], quiet: false },
		});
	});

	test("passes the photo size, orientation and analysis to the preset", () => {
		expect(
			planRender("card.coat", input({ data: "people.csv", out: "x.zip", sizeFrom: "photo", maxEdge: 800 })).kind,
		).toBe("batch");
		expect(planRender("card.coat", input({ out: "x.pdf", sheets: "a4", orientation: "landscape" })).kind).toBe(
			"batch",
		);
		expect(planRender("card.coat", input({ printTarget: "ymcko-dye-sub", analyze: false }))).toEqual({
			kind: "batch",
			options: { printTarget: "ymcko-dye-sub", analyze: false, out: ".", cropMarks: true, quiet: false },
		});
	});

	test("counts analysis as given only when it is turned off", () => {
		expect(planRender("card.coat", input({ analyze: true }))).toEqual({ kind: "template", options: { quiet: false } });
		expect(planRender("club.coatworkspace", input({ preset: "All", out: "x.zip", analyze: true })).kind).toBe(
			"workspace",
		);
	});

	test("counts crop marks as given only when they are turned off", () => {
		expect(planRender("card.coat", input({ out: "x.pdf", cropMarks: true })).kind).toBe("batch");
		expect(refusal("card.coat", { cropMarks: false })).toBe(
			"--no-crop-marks needs --data or a .zip or .pdf --out",
		);
	});
});
