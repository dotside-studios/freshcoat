import { DEFAULT_SHEET_LAYOUT, imposeSheets } from "@freshcoat-js/workspace";
import type { SheetItem } from "@freshcoat-js/workspace/export";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SheetPreview } from "~/export/SheetPreview";
import { doc } from "./doc-fixture";

vi.mock("~/export/sheet-thumbs", async (load) => {
	const m = await load<typeof import("~/export/sheet-thumbs")>();
	return {
		...m,
		peekSheetThumb: () => undefined,
		renderSheetThumb: () => new Promise(() => {}),
	};
});

beforeEach(() => {
	vi.stubGlobal("fetch", async () => {
		throw new Error("offline");
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("printer's marks on the sheet preview", () => {
	const items = Array.from(
		{ length: 4 },
		(_, i) =>
			({
				key: `r${i}-${i % 2}`,
				recordId: `r${Math.floor(i / 2)}`,
				recordIndex: Math.floor(i / 2),
				side: i % 2 === 0 ? "front" : "back",
				sideIndex: i % 2,
				values: {},
			}) as unknown as SheetItem,
	);

	function sheet(page: number, overrides = {}) {
		const layout = {
			...DEFAULT_SHEET_LAYOUT,
			duplex: "long-edge" as const,
			...overrides,
		};
		render(
			<SheetPreview
				template={doc()}
				imposition={imposeSheets(
					items,
					{ widthMm: 85.6, heightMm: 54 },
					layout,
				)}
				page={page}
				marks={layout}
				job="Members"
			/>,
		);
	}

	test("draws crop marks only by default", () => {
		sheet(0);
		expect(screen.getByTestId("sheet-crop-marks")).toBeTruthy();
		expect(screen.queryByTestId("sheet-printer-marks")).toBeNull();
	});

	test("draws targets on fronts and backs, the colour bar and the slug", () => {
		const all = { registrationMarks: true, colorBar: true, slug: true };
		sheet(1, all);
		expect(screen.queryByTestId("sheet-crop-marks")).toBeNull();
		expect(screen.getAllByTestId("sheet-registration-mark")).toHaveLength(4);
		expect(
			screen.getByTestId("sheet-color-bar").querySelectorAll("rect"),
		).toHaveLength(13);
		expect(screen.getByTestId("sheet-slug").textContent).toMatch(
			/^Members · Sheet 1 of 1 · Back · \d{4}-\d{2}-\d{2}$/,
		);
	});
});
