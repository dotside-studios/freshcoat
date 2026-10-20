import { describe, expect, it } from "vitest";
import { planExport } from "../plan";
import {
	posterPreset,
	posterWorkspace,
	preset,
	workspace,
} from "../test-fixtures";
import type { ExportPreset, SheetLayout, Workspace } from "../types";
import { presetReadiness, templateSpotInks } from "./readiness";

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

describe("presetReadiness with pieces", () => {
	const pdf: ExportPreset = { ...posterPreset, format: "pdf" };

	it("blocks vector PDF pages", () => {
		const r = presetReadiness(posterWorkspace, {
			...pdf,
			pdfPageImage: "vector",
		});
		expect(r.blocked).toEqual({
			reason: "pieces",
			message: "Pieces need PNG or JPEG pages, not vector",
		});
	});

	it("lets vector pages through when nothing is split", () => {
		const r = presetReadiness(posterWorkspace, {
			...pdf,
			split: "none",
			pdfPageImage: "vector",
		});
		expect(r.blocked).toBeNull();
	});

	it("blocks sheets whose pieces differ in size", () => {
		const r = presetReadiness(posterWorkspace, {
			...pdf,
			layout: sheetsPreset.layout,
		});
		expect(r.blocked).toMatchObject({
			reason: "sheets",
			message: "Sheets need one piece size",
		});
	});

	it("lays out sheets of pieces that share a size", () => {
		const r = presetReadiness(posterWorkspace, {
			...pdf,
			sides: ["front"],
			layout: sheetsPreset.layout,
		});
		expect(r.blocked).toBeNull();
		expect(r.sheets?.imposition?.pages.flatMap((p) => p.slots)).toHaveLength(3);
	});
});

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

	it("is blocked, naming the field, when the back offset is off the paper", () => {
		const drifting: ExportPreset = {
			...sheetsPreset,
			layout: {
				...(sheetsPreset.layout as SheetLayout),
				duplex: "long-edge",
				backOffsetMm: { x: 50, y: 0 },
			},
		};
		const r = presetReadiness(workspace, drifting);
		expect(r.sheets?.field).toBe("backOffset");
		expect(r.sheets?.error).toMatch(
			/^The back offset \(50 mm, 0 mm\) moves the backs off the paper/,
		);
		expect(r.blocked?.message).toBe("Back offset out of range");
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

describe("presetReadiness notices", () => {
	const spotted: Workspace = {
		...workspace,
		templates: workspace.templates.map((t) =>
			t.id === "t_member"
				? {
						...t,
						template: {
							...t.template,
							template_data: t.template.template_data.map((f, i) =>
								i === 0
									? {
											...f,
											background: {
												...f.background,
												properties: {
													...f.background?.properties,
													spot: {
														fill: { spot: "White" },
														stroke: { spot: "Foil" },
													},
												},
											},
										}
									: f,
							),
						} as typeof t.template,
					}
				: t,
		),
	};
	const vector: ExportPreset = {
		...preset,
		format: "pdf",
		pdfPageImage: "vector",
	};
	const printing: ExportPreset = { ...vector, print: { enabled: true } };

	it("has none for a plain preset", () => {
		expect(presetReadiness(workspace, preset).notices).toEqual([]);
		expect(presetReadiness(workspace, vector).notices).toEqual([]);
	});

	it("says a print target draws vector pages as PNG", () => {
		expect(
			presetReadiness(workspace, printing).notices.map((n) => n.reason),
		).toEqual(["print_raster"]);
	});

	it("says spot inks print as plain color off vector pages", () => {
		expect(presetReadiness(spotted, vector).notices).toEqual([]);
		const png = presetReadiness(spotted, preset).notices;
		expect(png).toEqual([
			expect.objectContaining({
				reason: "spot_raster",
				message: "Spot inks White, Foil print as plain color",
			}),
		]);
		expect(
			presetReadiness(spotted, printing).notices.map((n) => n.reason),
		).toEqual(["print_raster", "spot_raster"]);
	});

	it("finds spot inks in layers and variants, each once", () => {
		const template = spotted.templates.find((t) => t.id === "t_member")
			?.template as Workspace["templates"][number]["template"];
		expect(
			templateSpotInks({
				...template,
				variants: [
					{
						id: "gold",
						label: "Gold",
						overrides: [
							{
								name: "front",
								elements: [
									{
										id: "name",
										properties: { spot: { fill: { spot: "Gold" } } },
									},
									{
										id: "photo",
										properties: { spot: { fill: { spot: "White" } } },
									},
								],
							},
						],
					},
				],
			} as typeof template),
		).toEqual(["White", "Foil", "Gold"]);
	});
});
