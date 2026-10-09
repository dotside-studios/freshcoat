import { describe, expect, it } from "vitest";
import { withRecordStatus } from "../status";
import { members, preset, workspace } from "../test-fixtures";
import type { Dataset, ExportPreset } from "../types";
import type { JobResult } from "./job";
import {
	applyJobResult,
	recordOutcome,
	retryPreset,
	unwrittenRecordIds,
} from "./status";

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

const now = new Date("2026-09-25T10:00:00Z");

describe("recordOutcome", () => {
	it("is exported when every side rendered, failed otherwise", () => {
		const r = result([
			item("r1", "front", true),
			item("r1", "back", true),
			item("r2", "front", true),
			item("r2", "back", false, "font"),
			item("r3", "front", false),
		]);
		expect(recordOutcome(r)).toEqual({
			ok: ["r1"],
			failed: ["r2", "r3"],
			errors: { r2: "font", r3: "Failed" },
		});
	});
});

describe("applyJobResult", () => {
	const datasets: Dataset[] = [members];

	it("marks records exported with the time or failed with the error", () => {
		const r = result([
			item("r_00000001", "front", true),
			item("r_00000003", "front", true),
			item("r_00000005", "front", false, "font"),
		]);
		const next = applyJobResult(datasets, members.id, r, now);
		const byId = new Map(next[0]?.records.map((x) => [x.id, x]));
		expect(byId.get("r_00000001")).toMatchObject({
			status: "exported",
			exportedAt: now.toISOString(),
		});
		expect(byId.get("r_00000003")).toMatchObject({ status: "exported" });
		expect(byId.get("r_00000003")?.error).toBeUndefined();
		expect(byId.get("r_00000005")).toMatchObject({
			status: "failed",
			error: "font",
		});
		expect(byId.get("r_00000004")).toBe(members.records[3]);
		expect(members.records[0]?.status).toBe("pending");
	});

	it("writes nothing for a cancelled job or items with no record", () => {
		const r = result([item("r_00000001", "front", true)], true);
		expect(applyJobResult(datasets, members.id, r, now)).toBe(datasets);
		expect(
			applyJobResult(datasets, members.id, result([item("", "f", true)]), now),
		).toBe(datasets);
		expect(
			applyJobResult(
				datasets,
				"d_other",
				result([item("r_00000001", "f", true)]),
			),
		).toBe(datasets);
	});
});

describe("withRecordStatus", () => {
	it("keeps the list when nothing changes", () => {
		const datasets: Dataset[] = [members];
		expect(
			withRecordStatus(datasets, members.id, ["r_00000001"], "pending"),
		).toBe(datasets);
		expect(
			withRecordStatus(datasets, "d_other", ["r_00000001"], "failed"),
		).toBe(datasets);
	});
});

describe("retryPreset", () => {
	it("reruns failed records", () => {
		const r = result([item("r1", "front", true), item("r3", "front", false)]);
		expect(retryPreset({ ...preset, selected: ["x"] }, r)).toEqual({
			...preset,
			records: "failed",
		});
		expect(retryPreset({ ...preset, markExported: false }, r)).toMatchObject({
			records: "selected",
			selected: ["r3"],
		});
	});
});

describe("unwrittenRecordIds", () => {
	it("lists records with an item that was not written, all of them for a PDF", () => {
		const fronts: ExportPreset = { ...preset, sides: ["front"] };
		const r = result([item("r_00000001", "front", true)], true);
		expect(unwrittenRecordIds(workspace, fronts, r)).toEqual([
			"r_00000002",
			"r_00000003",
			"r_00000005",
		]);
		expect(
			unwrittenRecordIds(workspace, { ...fronts, format: "pdf" }, r),
		).toEqual(["r_00000001", "r_00000002", "r_00000003", "r_00000005"]);
	});
});
