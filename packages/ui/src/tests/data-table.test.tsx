import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import {
	DataBody,
	DataCell,
	DataColumn,
	DataRow,
	DataTable,
	DataTableHeader,
} from "../data-table";

// jsdom has no CSS.escape, which the collection focus code calls.
globalThis.CSS ??= {} as typeof CSS;
CSS.escape ??= (value: string) =>
	value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

interface Person {
	id: string;
	name: string;
	age: number;
}

const people: Person[] = [
	{ id: "a", name: "Ana", age: 31 },
	{ id: "b", name: "Ben", age: 24 },
	{ id: "c", name: "Cy", age: 45 },
];

const columns = [
	{ id: "name", name: "Name", isRowHeader: true },
	{ id: "age", name: "Age", numeric: true },
];

function People({
	onSortChange,
	onSelectionChange,
}: {
	onSortChange?: (d: SortDescriptor) => void;
	onSelectionChange?: (keys: Selection) => void;
}) {
	const [sort, setSort] = useState<SortDescriptor>();
	const [selected, setSelected] = useState<Selection>(new Set());
	return (
		<DataTable
			aria-label="People"
			selectionMode="multiple"
			selectedKeys={selected}
			onSelectionChange={(keys) => {
				setSelected(keys);
				onSelectionChange?.(keys);
			}}
			sortDescriptor={sort}
			onSortChange={(d) => {
				setSort(d);
				onSortChange?.(d);
			}}
		>
			<DataTableHeader columns={columns}>
				{(c) => (
					<DataColumn
						id={c.id}
						isRowHeader={c.isRowHeader}
						numeric={c.numeric}
						allowsSorting
					>
						{c.name}
					</DataColumn>
				)}
			</DataTableHeader>
			<DataBody items={people}>
				{(p) => (
					<DataRow id={p.id} columns={columns}>
						{(c) => (
							<DataCell numeric={c.numeric}>
								{c.id === "age" ? p.age : p.name}
							</DataCell>
						)}
					</DataRow>
				)}
			</DataBody>
		</DataTable>
	);
}

describe("DataTable", () => {
	it("renders the header, a checkbox column and the rows", () => {
		render(<People />);
		const grid = screen.getByRole("grid", { name: "People" });
		const rows = within(grid).getAllByRole("row");
		expect(rows).toHaveLength(4);
		const headers = within(rows[0] as HTMLElement).getAllByRole("columnheader");
		expect(headers.map((h) => h.textContent)).toEqual(["", "Name", "Age"]);
		expect(rows.slice(1).map((r) => r.textContent)).toEqual([
			"Ana31",
			"Ben24",
			"Cy45",
		]);
		const age = within(rows[1] as HTMLElement).getAllByRole("gridcell")[1];
		expect(age?.className).toContain("tabular-nums");
	});

	it("fires onSortChange with the column and direction", async () => {
		const user = userEvent.setup();
		const onSortChange = vi.fn();
		render(<People onSortChange={onSortChange} />);
		await user.click(screen.getByRole("columnheader", { name: "Age" }));
		expect(onSortChange).toHaveBeenLastCalledWith({
			column: "age",
			direction: "ascending",
		});
		await user.click(screen.getByRole("columnheader", { name: "Age" }));
		expect(onSortChange).toHaveBeenLastCalledWith({
			column: "age",
			direction: "descending",
		});
		expect(
			screen
				.getByRole("columnheader", { name: "Age" })
				.getAttribute("aria-sort"),
		).toBe("descending");
	});

	it("selects rows with the checkboxes", async () => {
		const user = userEvent.setup();
		const onSelectionChange = vi.fn();
		render(<People onSelectionChange={onSelectionChange} />);
		const boxes = screen.getAllByRole("checkbox");
		expect(boxes).toHaveLength(4);

		await user.click(boxes[2] as HTMLElement);
		expect([...(onSelectionChange.mock.lastCall?.[0] as Set<string>)]).toEqual([
			"b",
		]);
		const ben = screen.getAllByRole("row")[2] as HTMLElement;
		expect(ben.getAttribute("aria-selected")).toBe("true");

		await user.click(boxes[0] as HTMLElement);
		expect(onSelectionChange).toHaveBeenLastCalledWith("all");
		expect(
			screen
				.getAllByRole("row")
				.slice(1)
				.every((r) => r.getAttribute("aria-selected") === "true"),
		).toBe(true);
	});
});
