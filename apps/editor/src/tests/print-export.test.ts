// @vitest-environment node
import type { PrintRenderOptions } from "@freshcoat-js/coatfile/render";
import type { Dataset, ExportPreset, Workspace } from "@freshcoat-js/workspace";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type JobPool, REPORT_FILE_NAME, runExportJob } from "~/export/job";
import {
	gamutNotes,
	gamutPercent,
	printerFileNote,
	printFallbacks,
	printRenderOptions,
	printRequest,
	profileLabel,
	withPrintFallback,
} from "~/export/print";
import type { RenderOutput, RenderRequest } from "~/export/protocol";
import { membershipCard } from "~/samples/membership-card";

const BALANCE = { r: 1.1, g: 1, b: 0.92 };

describe("the request mapping", () => {
	it("is nothing for a preset that does not print, phase 3 ones included", () => {
		expect(printRequest(undefined)).toBeUndefined();
		expect(printRequest({ enabled: false, analyze: true })).toBeUndefined();
	});

	it("analyzes photos unless the preset says not to", () => {
		expect(printRequest({ enabled: true })).toEqual({ analyze: true });
		expect(printRequest({ enabled: true, analyze: false })).toEqual({
			analyze: false,
		});
	});

	it("carries the profile's measured balance and nothing else of it", () => {
		expect(
			printRequest({
				enabled: true,
				profile: { version: 1, name: "Printer A", balance: BALANCE },
			}),
		).toEqual({ analyze: true, balance: BALANCE });
		expect(
			printRequest({ enabled: true, profile: { version: 1, name: "Unread" } }),
		).toEqual({ analyze: true });
	});

	it("hands renderCompiled the analysis and the balance as policy", () => {
		expect(printRenderOptions({ analyze: true, balance: BALANCE })).toEqual({
			analyze: true,
			policy: { balance: BALANCE },
		});
		// No finish given: coatfile's default is the YMCKO finish.
		expect(printRenderOptions({ analyze: false })).toEqual({
			analyze: false,
			policy: {},
		});
	});
});

describe("the print fallback", () => {
	it("renders plain once when the print path fails, and says why", async () => {
		const calls: (PrintRenderOptions | undefined)[] = [];
		const out = await withPrintFallback({ analyze: true }, async (print) => {
			calls.push(print);
			if (print) throw new Error("SkSL effect unavailable");
			return "plain";
		});
		expect(calls).toEqual([{ analyze: true, policy: {} }, undefined]);
		expect(out).toEqual({
			result: "plain",
			print: "fallback",
			error: "SkSL effect unavailable",
		});
	});

	it("renders once through the print path when it works", async () => {
		let calls = 0;
		const out = await withPrintFallback({ analyze: false }, async (print) => {
			calls++;
			return print ? "printed" : "plain";
		});
		expect(calls).toBe(1);
		expect(out).toEqual({ result: "printed", print: "on" });
	});

	it("is off, and does not retry, without print", async () => {
		let calls = 0;
		await expect(
			withPrintFallback(undefined, async () => {
				calls++;
				throw new Error("broken");
			}),
		).rejects.toThrow("broken");
		expect(calls).toBe(1);
	});

	it("fails the item when the plain render fails too", async () => {
		await expect(
			withPrintFallback({ analyze: true }, async (print) => {
				throw new Error(print ? "print" : "plain");
			}),
		).rejects.toThrow("plain");
	});
});

describe("gamut", () => {
	it("keeps only the gamut warnings, as the largest whole percent", () => {
		const notes = gamutNotes([
			{ kind: "image_load_failed", src: "a", error: "x" },
			{ kind: "gamut_compressed", layer: "ws:a", clipped: 0.034, pullback: 1 },
			{ kind: "gamut_compressed", clipped: 0.12, pullback: 0.5 },
		]);
		expect(notes).toEqual([
			{ layer: "ws:a", clipped: 0.034, pullback: 1 },
			{ clipped: 0.12, pullback: 0.5 },
		]);
		expect(gamutPercent(notes)).toBe(12);
		expect(gamutPercent(undefined)).toBe(0);
	});

	it("adds the share to the printer file note from 2%", () => {
		expect(printerFileNote(0)).toBe(
			"Printer file, not a proof of the printed card",
		);
		expect(printerFileNote(1)).toBe(
			"Printer file, not a proof of the printed card",
		);
		expect(printerFileNote(7)).toBe(
			"Printer file, not a proof of the printed card · 7% of photo color pulled into printer range",
		);
	});

	it("labels a profile by its name and the day it was measured", () => {
		expect(
			profileLabel({
				name: "Printer A",
				measuredAt: "2026-09-01T09:00:00Z",
			}),
		).toEqual({ name: "Printer A", date: "Sep 1, 2026" });
		expect(profileLabel({ name: "Printer A", measuredAt: "soon" })).toEqual({
			name: "Printer A",
			date: null,
		});
	});
});

function workspace(): Workspace {
	const dataset: Dataset = {
		id: "d_1",
		name: "Members",
		columns: [{ key: "display_name", type: "text" }],
		records: [1, 2].map((i) => ({
			id: `r_${i}`,
			status: "pending" as const,
			values: { display_name: `Member ${i}` },
		})),
		assets: [],
	};
	return {
		formatVersion: "1.0",
		name: "Club",
		templates: [
			{
				id: "t_1",
				fileName: "Card.coat",
				template: membershipCard(),
				binding: {
					datasetId: "d_1",
					fields: {
						display_name: { kind: "column", column: "display_name" },
					},
				},
			},
		],
		datasets: [dataset],
		presets: [],
	};
}

function preset(overrides: Partial<ExportPreset> = {}): ExportPreset {
	return {
		id: "p_1",
		name: "Cards",
		templateId: "t_1",
		records: "all",
		sides: ["front"],
		format: "png-zip",
		scale: 1,
		dpi: 300,
		fileName: "{{index}}",
		markExported: true,
		...overrides,
	};
}

/** Answers every render; Member 2's print path "fails" and comes back plain. */
function printingPool(): JobPool & { requests: RenderRequest[] } {
	const requests: RenderRequest[] = [];
	return {
		size: 1,
		requests,
		async render(req): Promise<RenderOutput> {
			requests.push(req);
			const base = {
				bytes: new Uint8Array([1]),
				format: req.format,
				width: 1,
				height: 1,
				ms: 1,
			};
			if (!req.print) return base;
			return req.values.display_name === "Member 2"
				? { ...base, print: "fallback", printError: "finish failed" }
				: {
						...base,
						print: "on",
						gamut: [{ layer: "ws:a", clipped: 0.051, pullback: 1 }],
					};
		},
		cancel() {},
	};
}

describe("a printing export", () => {
	it("asks every render for print, and reports each item's outcome", async () => {
		const pool = printingPool();
		const result = await runExportJob(
			workspace(),
			preset({ print: { enabled: true, analyze: false } }),
			{ pool },
		);
		expect(pool.requests.map((r) => r.print)).toEqual([
			{ analyze: false },
			{ analyze: false },
		]);
		// A fallback is a file that exists, so it is a warning, not a failure.
		expect(result.items.every((i) => i.ok)).toBe(true);
		expect(printFallbacks(result.items)).toBe(1);
		const blob = result.file?.blob;
		if (!blob) throw new Error("no file");
		const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		expect(strFromU8(files[REPORT_FILE_NAME]).split("\r\n")).toEqual([
			"file,record,side,status,error,print,gamut",
			"1.png,r_1,front,ok,,on,5%",
			"2.png,r_2,front,ok,finish failed,fallback,",
			"",
		]);
	});

	it("sends no print for a preset without it", async () => {
		const pool = printingPool();
		const result = await runExportJob(workspace(), preset(), { pool });
		expect(pool.requests.every((r) => r.print === undefined)).toBe(true);
		expect(result.items.map((i) => i.print)).toEqual(["off", "off"]);
	});
});
