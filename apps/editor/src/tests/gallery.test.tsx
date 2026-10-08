import type { Column, Dataset, DatasetAsset } from "@freshcoat-js/workspace";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { useState } from "react";
import type { Selection } from "react-aria-components";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ControllerProvider } from "../app/context";
import { EditorController } from "../app/controller";
import { DataSection } from "../data/DataSection";
import {
	CARD_GAP,
	CARD_SIZES,
	cardLayout,
	defaultView,
	filterByStatus,
	forgetViews,
	photoBytes,
	rememberView,
	thumbWidthFor,
	titleColumn,
	viewFor,
} from "../data/gallery-model";
import { GridUiStore, selectionIds } from "../data/grid-state";
import { RecordsGallery } from "../data/RecordsGallery";
import { setThumbnailBackend } from "../data/thumbnails";
import { photoWatermark } from "../samples/photo-watermark";
import { fastUser } from "./aria";
import { doc } from "./doc-fixture";

const col = (key: string, type: Column["type"]): Column => ({ key, type });

function asset(n: number): DatasetAsset {
	return {
		sha256: String(n).padStart(64, "0"),
		contentType: "image/png",
		name: `p${n}.png`,
		size: 1000 * n,
		width: 40,
		height: 20,
		blob: new Blob([new Uint8Array(4)], { type: "image/png" }),
	};
}

function photos(n = 8): Dataset {
	const assets = Array.from({ length: n }, (_, i) => asset(i + 1));
	return {
		id: "d_photos",
		name: "Photos",
		columns: [
			col("photo", "image"),
			{ key: "file_name", type: "text", required: true },
			col("width", "integer"),
		],
		records: assets.map((a, i) => ({
			id: `r_${i + 1}`,
			values: {
				photo: `ws:${a.sha256}`,
				// the third has no name, which the schema requires
				...(i === 2 ? {} : { file_name: a.name }),
				width: 40,
			},
			status: i === 1 ? "exported" : "pending",
		})),
		assets,
	};
}

describe("default view", () => {
	beforeEach(forgetViews);

	it("is the gallery when an image column is among the first three", () => {
		expect(defaultView([col("photo", "image"), col("name", "text")])).toBe(
			"gallery",
		);
		expect(
			defaultView([col("a", "text"), col("b", "text"), col("p", "image")]),
		).toBe("gallery");
	});

	it("is the table otherwise", () => {
		expect(
			defaultView([
				col("a", "text"),
				col("b", "text"),
				col("c", "text"),
				col("p", "image"),
			]),
		).toBe("table");
		expect(defaultView([col("a", "text")])).toBe("table");
		expect(defaultView([])).toBe("table");
	});

	it("is remembered per dataset for the session", () => {
		const a = { id: "a", columns: [col("p", "image")] };
		const b = { id: "b", columns: [col("p", "image")] };
		rememberView("a", "table");
		expect(viewFor(a)).toBe("table");
		expect(viewFor(b)).toBe("gallery");
	});
});

describe("gallery model", () => {
	it("keeps a card's height its width plus the caption", () => {
		for (const size of ["s", "m", "l"] as const) {
			const l = cardLayout(size, false);
			const caption = CARD_SIZES[size].caption;
			expect(l.minItemSize.height - l.minItemSize.width).toBe(caption);
			expect(l.maxItemSize.height - l.maxItemSize.width).toBe(caption);
		}
	});

	it("divides a narrow grid into a fixed number of columns", () => {
		const l = cardLayout("m", true, 820);
		expect(l.maxColumns).toBe(2);
		expect(l.minItemSize.width).toBe(Math.floor((820 - CARD_GAP * 3) / 2));
		expect(l.maxItemSize).toEqual(l.minItemSize);
		// Unmeasured, it falls back to the desktop grid.
		expect(cardLayout("m", true, 0).maxColumns).toBe(Number.POSITIVE_INFINITY);
	});

	it("asks for the smallest thumbnail that stays sharp", () => {
		expect(thumbWidthFor(150)).toBe(160);
		expect(thumbWidthFor(150, 2)).toBe(320);
		expect(thumbWidthFor(400)).toBe(640);
	});

	it("titles a card by its first text column", () => {
		expect(
			titleColumn([col("p", "image"), col("n", "integer"), col("t", "text")])
				?.key,
		).toBe("t");
		expect(titleColumn([col("p", "image"), col("e", "email")])?.key).toBe("e");
	});

	it("filters by status and by issues, and totals the photos", () => {
		const d = photos(4);
		expect(filterByStatus(d.records, d, "all")).toHaveLength(4);
		expect(filterByStatus(d.records, d, "exported").map((r) => r.id)).toEqual([
			"r_2",
		]);
		expect(filterByStatus(d.records, d, "issues").map((r) => r.id)).toEqual([
			"r_3",
		]);
		expect(photoBytes(d)).toBe(10_000);
	});

	it("reads a selection in the order the rows are shown", () => {
		const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
		expect(selectionIds("all", rows)).toEqual(["a", "b", "c"]);
		expect(selectionIds(new Set(["c", "a", "gone"]), rows)).toEqual(["a", "c"]);
		expect(selectionIds(new Set(), rows)).toEqual([]);
	});
});

// jsdom lays nothing out; the virtualizer needs a viewport to fill.
let restore: (() => void)[] = [];
beforeAll(() => {
	const w = vi
		.spyOn(HTMLElement.prototype, "clientWidth", "get")
		.mockImplementation(() => 900);
	const h = vi
		.spyOn(HTMLElement.prototype, "clientHeight", "get")
		.mockImplementation(() => 700);
	restore = [() => w.mockRestore(), () => h.mockRestore()];
	setThumbnailBackend(async ({ blob }) => blob);
});
afterAll(() => {
	for (const r of restore) r();
	setThumbnailBackend(null);
});
beforeEach(() => {
	window.innerWidth = 1440;
	forgetViews();
	Element.prototype.scrollIntoView ??= () => {};
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

function Harness({
	dataset,
	ui,
	onOpen,
	onDelete,
	onSelection,
}: {
	dataset: Dataset;
	ui: GridUiStore;
	onOpen: (id: string) => void;
	onDelete: (ids: string[]) => void;
	onSelection: (s: Selection) => void;
}) {
	const [selection, setSelection] = useState<Selection>(() => new Set());
	return (
		<RecordsGallery
			dataset={dataset}
			rows={dataset.records}
			selection={selection}
			onSelectionChange={(s) => {
				setSelection(s);
				onSelection(s);
			}}
			selectedIds={selectionIds(selection, dataset.records)}
			ui={ui}
			size="m"
			narrow={false}
			onOpen={onOpen}
			onDeleteRows={onDelete}
			emptyState="Nothing"
		/>
	);
}

function renderGallery(dataset = photos()) {
	const ui = new GridUiStore();
	const onOpen = vi.fn();
	const onDelete = vi.fn();
	let selection: Selection = new Set();
	render(
		<Harness
			dataset={dataset}
			ui={ui}
			onOpen={onOpen}
			onDelete={onDelete}
			onSelection={(s) => {
				selection = s;
			}}
		/>,
	);
	const selected = () =>
		selection === "all" ? "all" : [...selection].map(String).sort();
	return { ui, onOpen, onDelete, selected, user: fastUser() };
}

const card = (id: string) =>
	document.querySelector(`[role=row][data-row="${id}"]`) as HTMLElement;

type Mods = { shiftKey?: boolean; ctrlKey?: boolean };

/** A mouse click. user-event's pointer events carry the signature of a
 *  screen reader's virtual click, which react-aria treats as a tap. */
function click(el: HTMLElement, mods: Mods = {}, detail = 1) {
	const init = {
		pointerType: "mouse",
		pointerId: 1,
		width: 10,
		height: 10,
		pressure: 0.5,
		detail,
		button: 0,
		buttons: 1,
		isPrimary: true,
		...mods,
	};
	act(() => {
		// A press focuses what it lands on, as the browser does on mousedown.
		el.focus();
		fireEvent.pointerDown(el, init);
		fireEvent.mouseDown(el, init);
		fireEvent.pointerUp(el, { ...init, buttons: 0 });
		fireEvent.mouseUp(el, init);
		fireEvent.click(el, init);
	});
}

function doubleClick(el: HTMLElement) {
	click(el);
	click(el, {}, 2);
	act(() => {
		fireEvent.doubleClick(el, { detail: 2 });
	});
}

describe("RecordsGallery", () => {
	it("shows a card per record with its title, status and issues", () => {
		renderGallery();
		const grid = screen.getByRole("grid", { name: "Records of Photos" });
		expect(within(grid).getAllByRole("row")).toHaveLength(8);
		expect(within(card("r_1")).getByTestId("card-title").textContent).toBe(
			"p1.png",
		);
		expect(within(card("r_2")).getByTestId("card-status").textContent).toBe(
			"Exported",
		);
		// No file_name: titled by its position, with one issue.
		expect(within(card("r_3")).getByTestId("card-title").textContent).toBe(
			"Record 3",
		);
		expect(within(card("r_3")).getByTestId("card-issues").textContent).toBe(
			"1",
		);
		expect(within(card("r_1")).queryByTestId("card-issues")).toBeNull();
	});

	it("selects as the table does: click, Shift, Mod and Mod+A", async () => {
		const { user, selected, ui } = renderGallery();
		click(card("r_2"));
		expect(selected()).toEqual(["r_2"]);
		expect(ui.get().active?.row).toBe("r_2");

		click(card("r_5"), { shiftKey: true });
		expect(selected()).toEqual(["r_2", "r_3", "r_4", "r_5"]);

		click(card("r_3"), { ctrlKey: true });
		click(card("r_8"), { ctrlKey: true });
		expect(selected()).toEqual(["r_2", "r_4", "r_5", "r_8"]);

		// A plain click starts over.
		click(card("r_1"));
		expect(selected()).toEqual(["r_1"]);

		await user.keyboard("{Control>}a{/Control}");
		expect(selected()).toBe("all");
	});

	it("moves with the arrow keys and extends with Shift", async () => {
		const { user, selected, ui } = renderGallery();
		click(card("r_1"));
		await user.keyboard("{ArrowRight}");
		expect(ui.get().active?.row).toBe("r_2");
		expect(selected()).toEqual(["r_2"]);
		await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
		expect(selected()).toEqual(["r_2", "r_3"]);
	});

	it("opens a record with Enter or a double-click", async () => {
		const { user, onOpen } = renderGallery();
		click(card("r_4"));
		await user.keyboard("{Enter}");
		expect(onOpen).toHaveBeenLastCalledWith("r_4");
		doubleClick(card("r_6"));
		expect(onOpen).toHaveBeenLastCalledWith("r_6");
	});

	it("deletes the selection with Delete", async () => {
		const { user, onDelete } = renderGallery();
		click(card("r_2"));
		click(card("r_3"), { shiftKey: true });
		await user.keyboard("{Delete}");
		expect(onDelete).toHaveBeenCalledWith(["r_2", "r_3"]);
	});
});

describe("Data section with a photo dataset", () => {
	let controller: EditorController;

	function setup(d: Dataset = photos()) {
		controller = new EditorController();
		controller.dispatch({
			type: "open",
			template: doc(),
			fileName: "doc.coat",
		});
		controller.dispatch({ type: "datasetEdit", datasets: [d] });
		render(
			<ControllerProvider controller={controller}>
				<DataSection />
			</ControllerProvider>,
		);
		return fastUser();
	}

	it("opens as a gallery, and remembers the table when chosen", async () => {
		const user = setup();
		expect(screen.getByTestId("records-gallery")).toBeTruthy();
		await user.click(screen.getByRole("radio", { name: "Table" }));
		expect(screen.getByTestId("records-grid")).toBeTruthy();
		cleanup();
		setup();
		expect(screen.getByTestId("records-grid")).toBeTruthy();
	});

	it("moves a cropped photo in its box, as the bound template frames it", async () => {
		const d = photos();
		d.columns.push({ key: "photo_focus", type: "text" });
		controller = new EditorController();
		controller.dispatch({
			type: "open",
			template: photoWatermark(),
			fileName: "watermark.coat",
		});
		controller.dispatch({ type: "datasetEdit", datasets: [d] });
		controller.dispatch({
			type: "setBinding",
			id: controller.state.workspace?.activeTemplateId ?? "",
			binding: {
				datasetId: d.id,
				fields: {
					photo: { kind: "column", column: "photo" },
					photo_focus: { kind: "column", column: "photo_focus" },
				},
				variant: { kind: "image", field: "photo" },
			},
		});
		render(
			<ControllerProvider controller={controller}>
				<DataSection />
			</ControllerProvider>,
		);
		doubleClick(card("r_1"));
		const handle = await screen.findByTestId("photo-framing");
		expect(handle.style.width).toBe("75%");
		expect(handle.style.left).toBe("12.5%");
		act(() => {
			fireEvent.keyDown(handle, { key: "ArrowRight" });
		});
		const record = controller.state.workspace?.datasets[0]?.records[0];
		expect(record?.values.photo_focus).toBe("0.51,0.5");
	});

	it("opens a record in the Record tab and edits a field there", async () => {
		const user = setup();
		expect(screen.getByTestId("data-status").textContent).toContain(
			"8 photos, 35 KB",
		);
		doubleClick(card("r_3"));
		const panel = screen.getByTestId("record-panel");
		expect(panel.dataset.record).toBe("r_3");
		expect(within(panel).getByTestId("record-photo-info").textContent).toBe(
			"40 × 20 · 2.9 KB · PNG",
		);
		const name = within(panel).getByLabelText(/^file_name/);
		expect(within(panel).getByTestId("field-issue")).toBeTruthy();
		await user.type(name, "third.png{Enter}");
		const record = controller.state.workspace?.datasets[0]?.records[2];
		expect(record?.values.file_name).toBe("third.png");
		expect(within(card("r_3")).getByTestId("card-title").textContent).toBe(
			"third.png",
		);
		expect(within(panel).queryByTestId("field-issue")).toBeNull();
		// One undo step takes the edit back.
		act(() => {
			controller.dispatch({ type: "datasetUndo" });
		});
		expect(
			controller.state.workspace?.datasets[0]?.records[2]?.values.file_name,
		).toBeUndefined();
	});

	it("keeps the tab where it was put while records take the focus", async () => {
		const user = setup();
		await user.click(screen.getByRole("tab", { name: "Columns" }));
		click(card("r_2"));
		expect(
			screen.getByRole("tab", { name: "Columns", selected: true }),
		).toBeTruthy();
		// Opening a record is asking for it.
		doubleClick(card("r_5"));
		expect(
			screen.getByRole("tab", { name: "Record", selected: true }),
		).toBeTruthy();
		expect(screen.getByTestId("record-panel").dataset.record).toBe("r_5");
	});

	it("steps through the records from the Record tab", async () => {
		const user = setup();
		click(card("r_1"));
		const panel = screen.getByTestId("record-panel");
		expect(panel.dataset.record).toBe("r_1");
		await user.click(screen.getByRole("button", { name: "Next record" }));
		expect(screen.getByTestId("record-panel").dataset.record).toBe("r_2");
		expect(screen.getByTestId("data-status").textContent).toContain(
			"1 selected",
		);
	});

	it("filters by status from the toolbar", async () => {
		const user = setup();
		await user.click(screen.getByTestId("status-filter"));
		await user.click(screen.getByRole("menuitemradio", { name: "Exported" }));
		expect(screen.getByTestId("data-status-records").textContent).toBe(
			"1 of 8 records",
		);
		expect(
			within(screen.getByTestId("records-gallery")).getAllByRole("row"),
		).toHaveLength(1);
	});

	it("offers a drop zone for a dataset with no records", () => {
		setup({ ...photos(0), records: [], assets: [] });
		expect(screen.getByTestId("dataset-drop-zone")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add photos…" })).toBeTruthy();
	});
});
