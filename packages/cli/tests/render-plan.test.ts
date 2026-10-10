import { describe, expect, test } from "bun:test";
import { planRender, type RenderInput } from "../src/commands/render-plan";
import { UsageError } from "../src/io";

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
	});

	test("exports a template to a zip, a PDF or, with --data, a directory", () => {
		for (const out of ["cards.zip", "cards.PDF"])
			expect(planRender("card.coat", input({ out })).kind).toBe("batch");
		expect(planRender("card.coat", input({ data: "people.csv", out: "cards", quality: 80, format: "jpeg" }))).toEqual({
			kind: "batch",
			options: { data: "people.csv", out: "cards", quality: 80, format: "jpeg", cropMarks: true, quiet: false },
		});
	});

	test("runs a workspace preset with only the workspace options", () => {
		expect(
			planRender("club.coatworkspace", input({ preset: "All", out: "x.zip", records: "failed", save: true, jobs: 2 })),
		).toEqual({
			kind: "workspace",
			options: { preset: "All", records: "failed", save: true, jobs: 2, out: "x.zip", quiet: false },
		});
	});

	test("refuses options that do not go together", () => {
		const cases: [string, Partial<RenderInput>, string][] = [
			["club.coatworkspace", { out: "x.zip", scale: [2], format: "webp" }, "--scale, --format apply only to templates"],
			["club.coatworkspace", { preset: "All" }, "a .coatworkspace needs --out <path>"],
			["club.coatworkspace", { out: "x.zip", save: true, dryRun: true }, "--save and --dry-run do not go together"],
			["card.coat", { preset: "All", records: "all" }, "--preset, --records need a .coatworkspace file"],
			["card.coat", { name: "x", out: "dir" }, "--name needs --data or a .zip or .pdf --out"],
			["card.coat", { data: "people.csv" }, "--data needs --out <dir|file.zip|file.pdf>"],
			["card.coat", { out: "x.zip", dpi: 72 }, "--dpi applies only to a .pdf"],
			["card.coat", { out: "x.pdf", cropMarks: false, margin: 2 }, "--no-crop-marks, --margin need --sheets"],
			["card.coat", { out: "x.pdf", quality: 50 }, "--quality needs --pdf-pages jpeg"],
			["card.coat", { out: "x.zip", quality: 50 }, "--quality needs --format jpeg or webp"],
			["card.coat", { out: "x.pdf", format: "jpeg" }, "--format applies only to images; a PDF takes --pdf-pages"],
			["card.coat", { out: "x.zip", scale: [1, 2] }, "an export takes one --scale"],
		];
		for (const [file, options, message] of cases)
			expect({ file, options, message: refusal(file, options) }).toEqual({ file, options, message });
	});

	test("counts crop marks as given only when they are turned off", () => {
		expect(planRender("card.coat", input({ out: "x.pdf", cropMarks: true })).kind).toBe("batch");
		expect(refusal("card.coat", { cropMarks: false })).toBe(
			"--no-crop-marks needs --data or a .zip or .pdf --out",
		);
	});
});
