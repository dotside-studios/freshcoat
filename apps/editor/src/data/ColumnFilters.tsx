import { Button } from "@freshcoat-js/ui/button";
import { TextField } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { DialogTrigger, Popover } from "@freshcoat-js/ui/popover";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { type Column, newId } from "@freshcoat-js/workspace";
import { useState } from "react";
import { Dialog as RACDialog } from "react-aria-components";
import AddIcon from "~icons/mingcute/add-line";
import CloseIcon from "~icons/mingcute/close-line";
import {
	type ColumnFilter,
	type ColumnFilterOp,
	FILTER_OPS,
	filterActive,
} from "./gallery-model";

/**
 * Column filters as chips beside the status filter: each opens to change
 * its column, test and value, and its cross removes it.
 */
export function ColumnFilters({
	columns,
	filters,
	onChange,
}: {
	columns: readonly Column[];
	filters: readonly ColumnFilter[];
	onChange: (filters: ColumnFilter[]) => void;
}) {
	const [editing, setEditing] = useState<string | null>(null);
	const update = (next: ColumnFilter) =>
		onChange(filters.map((f) => (f.id === next.id ? next : f)));
	const remove = (id: string) => onChange(filters.filter((f) => f.id !== id));
	const add = () => {
		const column = columns[0];
		if (!column) return;
		const filter: ColumnFilter = {
			id: newId("f"),
			column: column.key,
			op: "contains",
			value: "",
		};
		onChange([...filters, filter]);
		setEditing(filter.id);
	};
	return (
		<div
			className="flex min-w-0 shrink items-center gap-0.5"
			data-testid="column-filters"
		>
			{filters.map((f) => (
				<FilterChip
					key={f.id}
					filter={f}
					columns={columns}
					open={editing === f.id}
					onOpenChange={(open) => {
						setEditing(open ? f.id : null);
						if (!open && !filterActive(f, columns)) remove(f.id);
					}}
					onChange={update}
					onRemove={() => remove(f.id)}
				/>
			))}
			<IconButton
				aria-label="Add column filter"
				tooltip="Add column filter"
				data-testid="add-column-filter"
				isDisabled={columns.length === 0}
				onPress={add}
			>
				<AddIcon />
			</IconButton>
		</div>
	);
}

function chipText(filter: ColumnFilter): string {
	const op = FILTER_OPS.find((o) => o.id === filter.op)?.label ?? filter.op;
	return filter.op === "empty"
		? `${filter.column} ${op}`
		: `${filter.column} ${op} ${filter.value}`;
}

function FilterChip({
	filter,
	columns,
	open,
	onOpenChange,
	onChange,
	onRemove,
}: {
	filter: ColumnFilter;
	columns: readonly Column[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChange: (filter: ColumnFilter) => void;
	onRemove: () => void;
}) {
	const active = filterActive(filter, columns);
	return (
		<span
			className={cn(
				"flex h-fc-control min-w-0 items-center rounded-[3px]",
				active
					? "bg-fc-accent-soft text-fc-text"
					: "bg-fc-raised text-fc-muted",
			)}
			data-testid="column-filter"
		>
			<DialogTrigger isOpen={open} onOpenChange={onOpenChange}>
				<Button
					variant="ghost"
					aria-label={`Filter: ${chipText(filter)}`}
					className="h-full min-w-0 max-w-44 px-1.5 font-normal data-hovered:bg-transparent"
				>
					<span className="truncate">{chipText(filter)}</span>
				</Button>
				<Popover placement="bottom start" className="w-64">
					<RACDialog
						aria-label="Column filter"
						className="flex flex-col gap-2 p-3 outline-none"
						data-testid="column-filter-popover"
					>
						<Select
							label="Column"
							labelPosition="side"
							value={filter.column}
							onChange={(k) => onChange({ ...filter, column: String(k) })}
						>
							{columns.map((c) => (
								<SelectItem key={c.key} id={c.key} textValue={c.key}>
									{c.key}
								</SelectItem>
							))}
						</Select>
						<Select
							label="Test"
							labelPosition="side"
							value={filter.op}
							onChange={(k) => onChange({ ...filter, op: k as ColumnFilterOp })}
						>
							{FILTER_OPS.map((o) => (
								<SelectItem key={o.id} id={o.id} textValue={o.label}>
									{o.label}
								</SelectItem>
							))}
						</Select>
						{filter.op === "empty" ? null : (
							<TextField
								label="Value"
								labelPosition="side"
								value={filter.value}
								onChange={(value) => onChange({ ...filter, value })}
								onKeyDown={(e) => {
									if (e.key === "Enter") onOpenChange(false);
								}}
								autoFocus
								autoComplete="off"
							/>
						)}
					</RACDialog>
				</Popover>
			</DialogTrigger>
			<IconButton
				aria-label={`Remove filter ${chipText(filter)}`}
				onPress={onRemove}
				className="size-5 [&_svg]:size-3"
			>
				<CloseIcon />
			</IconButton>
		</span>
	);
}
