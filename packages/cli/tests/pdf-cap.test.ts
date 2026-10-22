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

beforeAll(async () => {
	box = await sandbox();
	await box.write("badge.json", JSON.stringify(card()));
	const rows = Array.from({ length: 6 }, (_, i) => `Person ${i}`);
	await box.write("people.csv", `name\n${rows.join("\n")}\n`);
	const workspace = workspaceOf(card());
	const [dataset] = workspace.datasets;
	if (dataset)
		dataset.records = rows.map((name, i) => ({
			id: `r_${String(i + 1).padStart(8, "0")}`,
			values: { name },
			status: "pending" as const,
		}));
	await box.write("crew.coatworkspace", await workspaceBytes(workspace));
});

afterAll(() => box.cleanup());

const REFUSAL =
	/freshcoat: this PDF renders 6 cards, over the limit of 5; every card is held in memory.*--max-pdf-cards/s;

describe("PDF card cap", () => {
	test("a workspace PDF over the cap fails and writes no file", async () => {
		const run = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"over.pdf",
			"--max-pdf-cards",
			"5",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(REFUSAL);
		expect(existsSync(box.path("over.pdf"))).toBe(false);
	});

	test("a batch PDF over the cap fails and writes no file", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--frame",
			"front",
			"--out",
			"batch-over.pdf",
			"--max-pdf-cards",
			"5",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(REFUSAL);
		expect(existsSync(box.path("batch-over.pdf"))).toBe(false);
	});

	test("a PDF on sheets is capped by cards and names its sheets", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--frame",
			"front",
			"--sheets",
			"a4",
			"--out",
			"sheets-over.pdf",
			"--max-pdf-cards",
			"5",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			"this PDF renders 6 cards (1 sheet), over the limit of 5; every card is held in memory",
		);
		expect(existsSync(box.path("sheets-over.pdf"))).toBe(false);
	});

	test("raising the cap lets the PDF through", async () => {
		const run = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"raised.pdf",
			"--max-pdf-cards",
			"6",
		);
		expect(run.code).toBe(0);
		expect(existsSync(box.path("raised.pdf"))).toBe(true);
	});

	test("0 lifts the cap", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--frame",
			"front",
			"--out",
			"unlimited.pdf",
			"--max-pdf-cards",
			"0",
		);
		expect(run.code).toBe(0);
		expect(existsSync(box.path("unlimited.pdf"))).toBe(true);
	});

	test("a PDF under the default cap succeeds", async () => {
		const run = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"default.pdf",
		);
		expect(run.code).toBe(0);
		expect(existsSync(box.path("default.pdf"))).toBe(true);
	});

	test("the cap does not apply to a zip export", async () => {
		const run = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_png",
			"--out",
			"crew.zip",
		);
		expect(run.code).toBe(0);
	});

	test("the flag is refused for an image preset and a non-PDF output", async () => {
		const preset = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_png",
			"--out",
			"x.zip",
			"--max-pdf-cards",
			"5",
		);
		expect(preset.code).toBe(1);
		expect(preset.stderr).toContain(
			"--max-pdf-cards applies only to a PDF preset",
		);
		const batch = await box.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--out",
			"x.zip",
			"--max-pdf-cards",
			"5",
		);
		expect(batch.code).toBe(2);
		expect(existsSync(box.path("x.zip"))).toBe(false);
	});

	test("a non-numeric cap is a usage error", async () => {
		const run = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"y.pdf",
			"--max-pdf-cards",
			"many",
		);
		expect(run.code).toBe(2);
	});
});
