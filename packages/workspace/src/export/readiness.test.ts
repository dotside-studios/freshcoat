import { describe, expect, it } from "vitest";
import { planExport } from "../plan";
import { preset, workspace } from "../test-fixtures";
import type { ExportPreset, SheetLayout, Workspace } from "../types";
import { presetReadiness } from "./readiness";

const sheetsPreset: ExportPreset = {
	...preset,
	id: "p_sheets",
	format: "pdf",
	layout: {
		kind: "sheet",
		paper: "a4",
		orientation: "auto",
		marginMm: 10,
		gapMm: 0,
		cropMarks: true,
		duplex: "none",
	},
};

describe("presetReadiness", () => {
	it("is not blocked when the preset can run", () => {
		const r = presetReadiness(workspace, preset);
		expect(r.blocked).toBeNull();
		expect(r.entry?.id).toBe("t_member");
		expect(r.plan).toEqual(planExport(workspace, preset));
		expect(r.issues).toBe(0);
		expect(r.sheets).toBeNull();
	});

	it("lists the required fields no column fills", () => {
		const ws: Workspace = {
			...workspace,
			templates: workspace.templates.map((t) =>
				t.id === "t_member"
					? {
							...t,
							binding: { datasetId: "d_members", fields: {} },
						}
					: t,
			),
		};
		expect(presetReadiness(ws, preset).unfilled).toEqual(["name"]);
	});

	it("is blocked when the template is not in the workspace", () => {
		const r = presetReadiness(workspace, { ...preset, templateId: "gone" });
		expect(r.entry).toBeUndefined();
		expect(r.plan).toEqual([]);
		expect(r.blocked?.reason).toBe("missing_template");
	});

	it("is blocked, counting them, when the template has issues", () => {
		const ws: Workspace = {
			...workspace,
			templates: workspace.templates.map((t) =>
				t.id === "t_member"
					? { ...t, template: { ...t.template, width: -1 } }
					: t,
			),
		};
		const r = presetReadiness(ws, preset);
		expect(r.issues).toBeGreaterThan(0);
		expect(r.blocked).toEqual({
			reason: "template_issues",
			message: `Template has ${r.issues} ${r.issues === 1 ? "issue" : "issues"}`,
		});
	});

	it("is blocked, with the whole reason, when the sheets don't lay out", () => {
		const tight: ExportPreset = {
			...sheetsPreset,
			layout: { ...(sheetsPreset.layout as SheetLayout), marginMm: 500 },
		};
		const r = presetReadiness(workspace, tight);
		expect(r.sheets?.error).toBeDefined();
		expect(r.blocked).toEqual({
			reason: "sheets",
			message: r.sheets?.shortError,
			detail: r.sheets?.error,
		});
	});

	it("is blocked when there is nothing to export", () => {
		const none: ExportPreset = {
			...preset,
			records: "selected",
			selected: [],
		};
		expect(presetReadiness(workspace, none).blocked).toEqual({
			reason: "nothing",
			message: "Nothing to export",
		});
	});

	it("plans over the plan it is given", () => {
		const r = presetReadiness(workspace, preset, []);
		expect(r.plan).toEqual([]);
		expect(r.blocked?.reason).toBe("nothing");
	});

	it("lays the plan out on sheets when the preset uses them", () => {
		const r = presetReadiness(workspace, sheetsPreset);
		expect(r.sheets?.imposition).toBeDefined();
		expect(r.blocked).toBeNull();
	});
});
