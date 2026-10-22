import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	card,
	type Sandbox,
	sandbox,
	workspaceBytes,
	workspaceOf,
} from "./helpers";

let box: Sandbox;
let small: Sandbox;

async function fill(target: Sandbox) {
	await target.write("badge.json", JSON.stringify(card()));
	const rows = Array.from({ length: 6 }, (_, i) => `Person ${i}`);
	await target.write("people.csv", `name\n${rows.join("\n")}\n`);
	await target.write("three.csv", `name\n${rows.slice(0, 3).join("\n")}\n`);
	const workspace = workspaceOf(card());
	const [dataset] = workspace.datasets;
	if (dataset)
		dataset.records = rows.map((name, i) => ({
			id: `r_${String(i + 1).padStart(8, "0")}`,
			values: { name },
			status: "pending" as const,
		}));
	await target.write("crew.coatworkspace", await workspaceBytes(workspace));
}

beforeAll(async () => {
	box = await sandbox();
	small = await sandbox({ largeBytes: { pdf: 1, data: 10 } });
	await fill(box);
	await fill(small);
});

afterAll(async () => {
	await box.cleanup();
	await small.cleanup();
});

const PDF_WARNING =
	/warning: this PDF is estimated at .+, and it is held in memory until it is built; if the export runs out of memory, split it with --where/;
const DATA_WARNING =
	/warning: people\.csv is 0\.0 MB, and reading it takes many times that in memory, a workbook more than a CSV; if it runs out of memory, split the file/;

describe("large PDF warning", () => {
	test("a workspace PDF over the size warns and is still written", async () => {
		const run = await small.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"crew.pdf",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toMatch(PDF_WARNING);
		expect(existsSync(small.path("crew.pdf"))).toBe(true);
	});

	test("a template PDF on sheets warns too", async () => {
		const run = await small.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--frame",
			"front",
			"--sheets",
			"a4",
			"--out",
			"sheets.pdf",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toMatch(PDF_WARNING);
		expect(existsSync(small.path("sheets.pdf"))).toBe(true);
	});

	test("a dry run warns and writes nothing", async () => {
		const workspace = await small.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"dry.pdf",
			"--dry-run",
		);
		expect(workspace.code).toBe(0);
		expect(workspace.stdout).toContain("6 items would be exported to dry.pdf");
		expect(workspace.stderr).toMatch(PDF_WARNING);
		const batch = await small.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--frame",
			"front",
			"--out",
			"dry.pdf",
			"--dry-run",
		);
		expect(batch.code).toBe(0);
		expect(batch.stderr).toMatch(PDF_WARNING);
		expect(existsSync(small.path("dry.pdf"))).toBe(false);
	});

	test("a PDF of no more pages than the sample does not warn", async () => {
		const run = await small.run(
			"render",
			"badge.json",
			"--data",
			"three.csv",
			"--frame",
			"front",
			"--out",
			"three.pdf",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).not.toContain("warning: this PDF");
	});

	test("a PDF under the default size does not warn", async () => {
		const run = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"default.pdf",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).not.toContain("warning: this PDF");
		const dry = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"default.pdf",
			"--dry-run",
		);
		expect(dry.stderr).not.toContain("warning: this PDF");
	});

	test("an image export does not warn", async () => {
		const run = await small.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_png",
			"--out",
			"crew.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).not.toContain("warning: this PDF");
	});
});

describe("large data file warning", () => {
	test("a data file over the size warns and is read", async () => {
		const run = await small.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--frame",
			"front",
			"--out",
			"people.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toMatch(DATA_WARNING);
		expect(existsSync(small.path("people.zip"))).toBe(true);
	});

	test("a dry run warns too", async () => {
		const run = await small.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--out",
			"people-dry.zip",
			"--dry-run",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toMatch(DATA_WARNING);
	});

	test("a data file under the default size does not warn", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--out",
			"quiet.zip",
			"--dry-run",
		);
		expect(run.stderr).not.toContain("reading it takes");
	});

	test("reads more records than the import limit of an upload", async () => {
		await box.write("many.csv", `name\n${"Ana\n".repeat(500_001)}`);
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"many.csv",
			"--frame",
			"front",
			"--out",
			"many.zip",
			"--dry-run",
			"--quiet",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toContain("500001 items would be exported");
	});
});
