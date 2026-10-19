import type { RasterizedSide } from "@freshcoat-js/workspace/export";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ChecksBadge, ChecksList } from "~/export/Checks";
import { checksSummary, exportChecks } from "~/export/checks";

afterEach(cleanup);

const input = {
	blocked: null,
	unbound: false,
	unfilled: 0,
	glyphs: [],
	failed: 0,
	labelFor: (id: string) => id,
	showSide: false,
	canPick: true,
};

const rasterized: RasterizedSide[] = [
	{
		side: "front",
		layers: [
			{ layer: "pink", features: ["shadow"], spots: ["Pink"] },
			{ layer: "bg", features: ["grain", "halftone"], spots: [] },
			{ features: ["backdrop blur"], spots: [] },
		],
	},
];

describe("rasterized layer checks", () => {
	test("warns for a lost spot and tells the rest once", () => {
		const checks = exportChecks({ ...input, rasterized });
		expect(checks.map((c) => [c.id, c.severity])).toEqual([
			["spots", "warning"],
			["rasterized", "info"],
		]);
		render(<ChecksList checks={checks} onTarget={() => {}} />);
		expect(screen.getByTestId("export-check-spots").textContent).toContain(
			"Pink (pink)",
		);
		expect(screen.getByTestId("export-check-rasterized").textContent).toBe(
			"Drawn as images in the PDF: bg (grain, halftone); backdrop blur",
		);
	});

	test("names the side when there are several", () => {
		const [check] = exportChecks({
			...input,
			showSide: true,
			rasterized: [
				{
					side: "back",
					layers: [{ layer: "a", features: ["mask"], spots: [] }],
				},
			],
		});
		expect(check?.message).toBe("back: Drawn as images in the PDF: a (mask)");
	});

	test("does not count an info check as an issue", () => {
		const checks = exportChecks({
			...input,
			rasterized: [
				{
					side: "front",
					layers: [{ layer: "a", features: ["mask"], spots: [] }],
				},
			],
		});
		expect(checksSummary(checks)).toBe("All clear");
		render(<ChecksBadge checks={checks} onTarget={() => {}} />);
		expect(screen.queryByTestId("export-checks-badge")).toBeNull();
	});
});
