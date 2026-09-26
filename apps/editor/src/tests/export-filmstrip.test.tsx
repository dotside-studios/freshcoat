import type { DataRecord, Dataset } from "@freshcoat/workspace";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { Filmstrip } from "~/export/Filmstrip";
import {
	cellsPerPage,
	filmstripEntries,
	stepIndex,
	withVariantEntries,
} from "~/export/filmstrip-model";
import {
	clampSplit,
	effectiveMode,
	previewModes,
	sourceField,
	splitAt,
	stepSplit,
} from "~/export/preview-mode";
import { photoWatermark } from "~/samples/photo-watermark";
import { doc } from "./doc-fixture";

const record = (
	id: string,
	status: DataRecord["status"] = "pending",
): DataRecord => ({ id, status, values: { name: `Name ${id}` } });

const dataset: Pick<Dataset, "records"> = {
	records: [
		record("a", "exported"),
		record("b"),
		record("c", "failed"),
		record("d", "skipped"),
		record("e"),
	],
};

describe("filmstrip entries", () => {
	const planned = new Set(["a", "b", "c", "e"]);

	test("the export scope is the planned records, in dataset order", () => {
		const out = filmstripEntries(dataset, planned, "export");
		expect(out.map((e) => [e.record.id, e.index, e.planned])).toEqual([
			["a", 0, true],
			["b", 1, true],
			["c", 2, true],
			["e", 4, true],
		]);
	});

	test("all shows every record and marks the ones left out", () => {
		const out = filmstripEntries(dataset, planned, "all");
		expect(out.map((e) => e.record.id)).toEqual(["a", "b", "c", "d", "e"]);
		expect(out.find((e) => e.record.id === "d")?.planned).toBe(false);
	});

	test("failed is the failed status and the last job's failures", () => {
		const out = filmstripEntries(dataset, planned, "failed", new Set(["e"]));
		expect(out.map((e) => e.record.id)).toEqual(["c", "e"]);
	});

	test("no dataset, no entries", () => {
		expect(filmstripEntries(undefined, planned, "all")).toEqual([]);
	});
});

describe("filmstrip keys", () => {
	test("arrows step one and stop at the ends", () => {
		expect(stepIndex(2, "ArrowRight", 5)).toBe(3);
		expect(stepIndex(2, "ArrowLeft", 5)).toBe(1);
		expect(stepIndex(4, "ArrowRight", 5)).toBe(4);
		expect(stepIndex(0, "ArrowLeft", 5)).toBe(0);
		expect(stepIndex(1, "ArrowDown", 5)).toBe(2);
		expect(stepIndex(1, "ArrowUp", 5)).toBe(0);
	});

	test("Home, End and a page of cells", () => {
		expect(stepIndex(2, "Home", 50)).toBe(0);
		expect(stepIndex(2, "End", 50)).toBe(49);
		expect(stepIndex(2, "PageDown", 50, 8)).toBe(10);
		expect(stepIndex(45, "PageDown", 50, 8)).toBe(49);
		expect(stepIndex(5, "PageUp", 50, 8)).toBe(0);
	});

	test("with nothing current a step lands on the first cell, End on the last", () => {
		expect(stepIndex(-1, "ArrowRight", 5)).toBe(0);
		expect(stepIndex(-1, "ArrowLeft", 5)).toBe(0);
		expect(stepIndex(-1, "End", 5)).toBe(4);
	});

	test("other keys and empty lists are not the filmstrip's", () => {
		expect(stepIndex(1, "Enter", 5)).toBeNull();
		expect(stepIndex(-1, "a", 5)).toBeNull();
		expect(stepIndex(0, "ArrowRight", 0)).toBeNull();
	});
});

describe("filmstrip virtualisation", () => {
	test("a page is the whole cells that fit", () => {
		expect(cellsPerPage(460, 92)).toBe(5);
		expect(cellsPerPage(50, 92)).toBe(1);
	});
});

describe("preview modes", () => {
	const photo = photoWatermark();

	test("Source and Split need an image field bound to a column", () => {
		expect(
			sourceField(photo, {
				fields: { photo: { kind: "column", column: "photo" } },
			}),
		).toBe("photo");
		expect(
			sourceField(photo, {
				fields: { photo: { kind: "constant", value: "ws:abc" } },
			}),
		).toBeNull();
		expect(sourceField(photo, undefined)).toBeNull();
		expect(
			sourceField(doc(), {
				fields: { name: { kind: "column", column: "name" } },
			}),
		).toBeNull();
		expect(previewModes("photo")).toEqual(["output", "source", "split"]);
		expect(previewModes(null)).toEqual(["output"]);
	});

	test("a size-from-image preset's field is the source", () => {
		const template = {
			fields: {
				type: "object" as const,
				properties: {
					logo: { type: "string" as const, format: "image" as const },
					photo: { type: "string" as const, format: "image" as const },
				},
			},
		};
		const binding = {
			fields: {
				logo: { kind: "column" as const, column: "logo" },
				photo: { kind: "column" as const, column: "photo" },
			},
		};
		expect(sourceField(template, binding)).toBe("logo");
		expect(
			sourceField(template, binding, {
				id: "p",
				name: "p",
				templateId: "t",
				records: "all",
				sides: "all",
				format: "jpeg-zip",
				size: { kind: "image", field: "photo" },
				scale: 1,
				dpi: 300,
				fileName: "x",
				markExported: true,
			}),
		).toBe("photo");
	});

	test("a mode that is not offered shows the output", () => {
		expect(effectiveMode("split", ["output"])).toBe("output");
		expect(effectiveMode("split", ["output", "source", "split"])).toBe("split");
	});

	test("the divider follows the pointer and the keys, within the image", () => {
		expect(splitAt(150, { left: 100, width: 200 })).toBe(0.25);
		expect(splitAt(0, { left: 100, width: 200 })).toBe(0);
		expect(splitAt(900, { left: 100, width: 200 })).toBe(1);
		expect(stepSplit(0.5, "ArrowRight")).toBeCloseTo(0.51);
		expect(stepSplit(0.5, "ArrowLeft", true)).toBeCloseTo(0.4);
		expect(stepSplit(0.995, "ArrowRight")).toBe(1);
		expect(stepSplit(0.5, "Home")).toBe(0);
		expect(stepSplit(0.5, "End")).toBe(1);
		expect(stepSplit(0.5, "Enter")).toBeNull();
		expect(clampSplit(Number.NaN)).toBe(0.5);
	});
});

describe("<Filmstrip>", () => {
	const saved = new Map<string, PropertyDescriptor | undefined>();
	beforeAll(() => {
		// 5 cells of 92 px fit.
		for (const prop of ["clientWidth", "offsetWidth"]) {
			saved.set(
				prop,
				Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop),
			);
			Object.defineProperty(HTMLElement.prototype, prop, {
				configurable: true,
				get: () => 460,
			});
		}
	});
	afterAll(() => {
		for (const [prop, d] of saved)
			if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
	});
	afterEach(cleanup);

	const many: Pick<Dataset, "records"> = {
		records: Array.from({ length: 200 }, (_, i) =>
			record(`r${i}`, i % 7 === 3 ? "failed" : "pending"),
		),
	};
	const all = new Set(many.records.map((r) => r.id));

	function Harness({ start = null }: { start?: string | null }) {
		const [current, setCurrent] = useState<string | null>(start);
		return (
			<>
				<output data-testid="current">{current ?? ""}</output>
				<Filmstrip
					entries={filmstripEntries(many, all, "export")}
					currentId={current}
					onPick={setCurrent}
					assetFor={() => undefined}
					labelFor={(r) => String(r.values.name)}
					aspect={1.5}
					emptyText="Nothing"
				/>
			</>
		);
	}

	test("mounts only the cells in view, with their status", () => {
		render(<Harness />);
		const options = screen.getAllByRole("option");
		expect(options.length).toBeLessThan(20);
		expect(options[0]?.getAttribute("aria-setsize")).toBe("200");
		expect(options[3]?.dataset.status).toBe("failed");
	});

	test("a click previews the record and marks it selected", () => {
		render(<Harness />);
		fireEvent.click(screen.getAllByRole("option")[2] as HTMLElement);
		expect(screen.getByTestId("current").textContent).toBe("r2");
		expect(
			screen.getAllByRole("option")[2]?.getAttribute("aria-selected"),
		).toBe("true");
		const list = screen.getByRole("listbox");
		expect(list.getAttribute("aria-activedescendant")).toBe("filmstrip-r2");
	});

	test("under every variant, a cell per variant with its swatch, and none for Default", () => {
		const t = {
			...doc(),
			variants: [
				{ id: "dark", label: "Dark", swatch: "#111111", overrides: [] },
				{ id: "plain", label: "Plain", overrides: [] },
			],
		};
		const entries = withVariantEntries(
			filmstripEntries(dataset, new Set(["a"]), "export"),
			t,
			() => [undefined, "dark", "plain"],
		);
		render(
			<Filmstrip
				entries={entries}
				currentId={null}
				onPick={() => {}}
				assetFor={() => undefined}
				labelFor={(r) => String(r.values.name)}
				aspect={1.5}
				emptyText="Nothing"
			/>,
		);
		const cells = screen.getAllByRole("option");
		expect(cells.map((c) => c.dataset.variant)).toEqual([
			"default",
			"dark",
			"plain",
		]);
		expect(cells.map((c) => c.getAttribute("aria-label"))).toEqual([
			"1. Name a, Default, exported",
			"1. Name a, Dark, exported",
			"1. Name a, Plain, exported",
		]);
		const swatch = (cell: HTMLElement | undefined) =>
			cell?.querySelector<HTMLElement>('[data-testid="variant-swatch"]');
		expect(swatch(cells[0])).toBeNull();
		expect(swatch(cells[1])?.style.background).toBe("rgb(17, 17, 17)");
		// a variant without a swatch shows the slash the Variants list shows
		expect(swatch(cells[2])).not.toBeNull();
		expect(swatch(cells[2])?.style.background).toContain("linear-gradient");
	});

	test("arrow keys step, Home and End jump, and the current cell stays mounted", () => {
		render(<Harness start="r0" />);
		const list = screen.getByRole("listbox");
		fireEvent.keyDown(list, { key: "ArrowRight" });
		expect(screen.getByTestId("current").textContent).toBe("r1");
		fireEvent.keyDown(list, { key: "ArrowLeft" });
		fireEvent.keyDown(list, { key: "ArrowLeft" });
		expect(screen.getByTestId("current").textContent).toBe("r0");
		fireEvent.keyDown(list, { key: "End" });
		expect(screen.getByTestId("current").textContent).toBe("r199");
		expect(document.getElementById("filmstrip-r199")).not.toBeNull();
		expect(list.getAttribute("aria-activedescendant")).toBe("filmstrip-r199");
		fireEvent.keyDown(list, { key: "PageUp" });
		expect(screen.getByTestId("current").textContent).toBe("r194");
		fireEvent.keyDown(list, { key: "Home" });
		expect(screen.getByTestId("current").textContent).toBe("r0");
		// a modified arrow is someone else's shortcut
		fireEvent.keyDown(list, { key: "ArrowRight", metaKey: true });
		expect(screen.getByTestId("current").textContent).toBe("r0");
	});

	test("an empty scope says so", () => {
		render(
			<Filmstrip
				entries={[]}
				currentId={null}
				onPick={() => {}}
				assetFor={() => undefined}
				labelFor={() => ""}
				aspect={1}
				emptyText="No failed records"
			/>,
		);
		expect(screen.getByText("No failed records")).toBeTruthy();
	});
});
