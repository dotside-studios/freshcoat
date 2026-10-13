import type { Template } from "@freshcoat-js/coatfile";
import { DEFAULT_SHEET_LAYOUT, imposeSheets } from "@freshcoat-js/workspace";
import type { SheetItem } from "@freshcoat-js/workspace/export";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { COMMAND_BY_ID } from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { setBleedShown, toggleBleed } from "~/canvas/bleed-view";
import { BleedShade, PrintGuides } from "~/canvas/PrintGuides";
import { SheetPreview } from "~/export/SheetPreview";
import { thumbKey } from "~/export/sheet-thumbs";
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
	setBleedShown(true);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const VIEW = { x: 100, y: 50, zoom: 0.5 };

function canvas(t: Template) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	render(
		<ControllerProvider controller={c}>
			<svg>
				<title>overlay</title>
				<BleedShade view={VIEW} />
				<PrintGuides view={VIEW} />
			</svg>
		</ControllerProvider>,
	);
	return c;
}

describe("bleed on the canvas", () => {
	test("shades the bleed outside the trim, each side its own", () => {
		canvas({ ...doc(), bleed: { top: 10, right: 20, bottom: 30, left: 40 } });
		const d = screen.getByTestId("bleed-shade").getAttribute("d");
		// Outer box: x 100 - 40/2, y 50 - 10/2, w 500 + 30, h 300 + 20.
		expect(d).toBe("M80 45H610V365H80ZM100 50H600V350H100Z");
	});

	test("is not drawn without a bleed, nor when hidden", () => {
		canvas(doc());
		expect(screen.queryByTestId("bleed-shade")).toBeNull();
		cleanup();
		canvas({ ...doc(), bleed: 12 });
		expect(screen.getByTestId("bleed-shade")).toBeTruthy();
		act(() => toggleBleed());
		expect(screen.queryByTestId("bleed-shade")).toBeNull();
		act(() => toggleBleed());
		expect(screen.getByTestId("bleed-shade")).toBeTruthy();
	});

	test("View > Bleed toggles it in Edit and Export", async () => {
		const command = COMMAND_BY_ID.get("view.bleed");
		expect(command?.sections).toEqual(["edit", "export"]);
		const c = canvas({ ...doc(), bleed: 12 });
		await act(() => command?.run({ controller: c } as never));
		expect(screen.queryByTestId("bleed-shade")).toBeNull();
	});
});

describe("bleed on the sheet preview", () => {
	const template: Template = { ...doc(), bleed: 12 };
	const items = Array.from(
		{ length: 2 },
		(_, i) =>
			({
				key: `r${i}`,
				recordId: `r${i}`,
				recordIndex: i,
				side: "front",
				sideIndex: 0,
				values: {},
			}) as unknown as SheetItem,
	);
	const card = { widthMm: 85.6, heightMm: 54 };

	function sheet(bleedMm?: number) {
		const imposition = imposeSheets(items, card, DEFAULT_SHEET_LAYOUT, {
			...(bleedMm ? { bleedMm } : {}),
		});
		render(
			<SheetPreview template={template} imposition={imposition} page={0} />,
		);
		return imposition;
	}

	test("shades each card's bleed when the cards carry one", () => {
		const imposition = sheet(1);
		const path = screen
			.getByTestId("sheet-bleed-shade")
			.querySelector("path")
			?.getAttribute("d");
		const slot = imposition.pages[0]?.slots[0];
		if (!slot) throw new Error("no slot");
		expect(path).toContain(`M${slot.xMm - 1} ${slot.yMm - 1}H`);
		expect(path?.match(/M/g)).toHaveLength(4);
	});

	test("leaves it out without bleed, or when hidden", () => {
		sheet();
		expect(screen.queryByTestId("sheet-bleed-shade")).toBeNull();
		cleanup();
		setBleedShown(false);
		sheet(1);
		expect(screen.queryByTestId("sheet-bleed-shade")).toBeNull();
	});

	test("a slot painted with bleed is cached apart", () => {
		const req = {
			template,
			side: 0,
			values: {},
			fonts: new Map(),
			density: 1,
		};
		expect(thumbKey({ ...req, bleed: true })).not.toBe(thumbKey(req));
	});
});
