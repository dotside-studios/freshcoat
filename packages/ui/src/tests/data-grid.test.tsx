import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { Selection } from "react-aria-components";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { type DataGridColumn, VirtualDataGrid } from "../data-grid";

globalThis.CSS ??= {} as typeof CSS;
CSS.escape ??= (value: string) =>
	value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

const restore: (() => void)[] = [];

// jsdom has no layout, so the scroller reports a ten row viewport.
beforeAll(() => {
	const height = 26 + 24 * 10;
	for (const prop of ["offsetHeight", "clientHeight", "offsetWidth"] as const) {
		const original = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			prop,
		);
		Object.defineProperty(HTMLElement.prototype, prop, {
			configurable: true,
			get() {
				if (this.getAttribute("role") !== "grid") return 0;
				return prop === "offsetWidth" ? 400 : height;
			},
		});
		restore.push(() => {
			if (original)
				Object.defineProperty(HTMLElement.prototype, prop, original);
		});
	}
	const scrollTo = HTMLElement.prototype.scrollTo;
	HTMLElement.prototype.scrollTo = function (
		this: HTMLElement,
		options?: ScrollToOptions | number,
	) {
		if (typeof options === "object" && options.top !== undefined) {
			this.scrollTop = options.top;
			this.dispatchEvent(new Event("scroll"));
		}
	} as typeof HTMLElement.prototype.scrollTo;
	restore.push(() => {
		HTMLElement.prototype.scrollTo = scrollTo;
	});
});

afterAll(() => {
	for (const fn of restore) fn();
});

const columns: DataGridColumn[] = [
	{ id: "name", header: "Name", width: 120, isRowHeader: true },
	{ id: "size", header: "Size", width: 80, numeric: true },
];

const keys = Array.from({ length: 200 }, (_, i) => `r${i}`);

function Grid({
	rowKeys = keys,
	onSelectionChange,
}: {
	rowKeys?: string[];
	onSelectionChange?: (keys: Selection) => void;
}) {
	const [selected, setSelected] = useState<Selection>(new Set());
	return (
		<VirtualDataGrid
			aria-label="Rows"
			columns={columns}
			rowKeys={rowKeys}
			renderCell={(key, c) => `${key}:${c.id}`}
			selectedKeys={selected}
			onSelectionChange={(next) => {
				setSelected(next);
				onSelectionChange?.(next);
			}}
			rowHeight={24}
			headingHeight={26}
		/>
	);
}

const grid = () => screen.getByRole("grid");
const tabStops = () =>
	Array.from(grid().querySelectorAll<HTMLElement>('[tabindex="0"]'));
const cell = (row: string, col = "name") =>
	grid().querySelector<HTMLElement>(
		`[data-row="${row}"][data-column="${col}"]`,
	) as HTMLElement;
const headerCell = (col: string) =>
	grid().querySelector<HTMLElement>(
		`[data-header][data-column="${col}"]`,
	) as HTMLElement;
const selectedRows = () =>
	Array.from(grid().querySelectorAll('[role=row][aria-selected="true"]')).map(
		(r) => r.getAttribute("data-row"),
	);
const flush = () =>
	act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

test("Shift+Arrow extends the selection from the anchor and shrinks back", async () => {
	const user = userEvent.setup();
	render(<Grid />);
	act(() => cell("r2").focus());
	await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
	await flush();
	expect(selectedRows()).toEqual(["r2", "r3", "r4"]);
	expect(document.activeElement).toBe(cell("r4"));
	await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
	await flush();
	expect(selectedRows()).toEqual(["r2", "r3"]);
	await user.keyboard("{Shift>}{ArrowUp}{ArrowUp}{/Shift}");
	await flush();
	expect(selectedRows()).toEqual(["r1", "r2"]);
});

test("Shift+Home and Shift+End extend to the first and last row", async () => {
	const user = userEvent.setup();
	const onSelectionChange = vi.fn();
	render(<Grid onSelectionChange={onSelectionChange} />);
	act(() => cell("r3").focus());
	await user.keyboard("{Shift>}{Home}{/Shift}");
	await flush();
	expect(selectedRows()).toEqual(["r0", "r1", "r2", "r3"]);
	expect(document.activeElement).toBe(cell("r0"));
	await user.keyboard("{Shift>}{End}{/Shift}");
	await flush();
	const last = onSelectionChange.mock.lastCall?.[0] as Set<string>;
	expect([...last].sort()).toEqual(keys.slice(3).sort());
});

test("plain arrows move the anchor without selecting", async () => {
	const user = userEvent.setup();
	render(<Grid />);
	act(() => cell("r0").focus());
	await user.keyboard("{ArrowDown}{ArrowDown}");
	await flush();
	expect(selectedRows()).toEqual([]);
	await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
	await flush();
	expect(selectedRows()).toEqual(["r2", "r3"]);
});

test("Shift+Click extends from the last clicked row", async () => {
	const user = userEvent.setup();
	render(<Grid />);
	await user.click(cell("r1"));
	await user.keyboard("{Shift>}");
	await user.click(cell("r4"));
	await user.keyboard("{/Shift}");
	expect(selectedRows()).toEqual(["r1", "r2", "r3", "r4"]);
});

test("one tab stop with focus in the body or the header", async () => {
	const user = userEvent.setup();
	render(<Grid />);
	expect(tabStops()).toEqual([cell("r0")]);

	act(() => cell("r1", "size").focus());
	expect(tabStops()).toEqual([cell("r1", "size")]);

	await user.keyboard("{ArrowUp}{ArrowUp}");
	await flush();
	expect(document.activeElement).toBe(headerCell("size"));
	expect(tabStops()).toEqual([headerCell("size")]);

	await user.keyboard("{ArrowDown}");
	await flush();
	expect(tabStops()).toEqual([cell("r0", "size")]);
});

test("an empty grid keeps a header tab stop", () => {
	render(<Grid rowKeys={[]} />);
	expect(tabStops()).toEqual([headerCell("name")]);
});

test("ARIA indices match the full grid after scrolling", async () => {
	const user = userEvent.setup();
	render(<Grid />);
	const el = grid();
	expect(el.getAttribute("aria-rowcount")).toBe("201");
	expect(el.getAttribute("aria-colcount")).toBe("3");

	act(() => {
		el.scrollTop = 24 * 100;
		el.dispatchEvent(new Event("scroll"));
	});
	await flush();

	const rows = Array.from(
		el.querySelectorAll<HTMLElement>("[role=row][data-row]"),
	);
	expect(rows.length).toBeGreaterThan(0);
	expect(rows.length).toBeLessThan(40);
	expect(cell("r0")).toBeNull();
	for (const r of rows) {
		const index = keys.indexOf(r.dataset.row as string);
		expect(index).toBeGreaterThanOrEqual(90);
		expect(r.getAttribute("aria-rowindex")).toBe(String(index + 2));
		expect(r.getAttribute("aria-selected")).toBe("false");
		const cols = Array.from(r.querySelectorAll("[aria-colindex]")).map((c) =>
			c.getAttribute("aria-colindex"),
		);
		expect(cols).toEqual(["1", "2", "3"]);
	}
	expect(tabStops()).toHaveLength(1);

	await user.click(cell("r104"));
	expect(selectedRows()).toEqual(["r104"]);
});
