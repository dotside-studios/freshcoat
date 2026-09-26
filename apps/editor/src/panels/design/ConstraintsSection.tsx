import type { Constraint, Constraints, Element } from "@freshcoat/coatfile";
import { cn } from "@freshcoat/ui/lib/cn";
import { PanelSection } from "@freshcoat/ui/panel";
import { Select, SelectItem } from "@freshcoat/ui/select";
import { isAutoLayoutChild } from "~/doc/geometry";
import { Row, SharedNotice } from "./controls";
import { commonValue, type Inspect } from "./field-helpers";

type Axis = "horizontal" | "vertical";

export const CONSTRAINT_LABELS: Record<Axis, [Constraint, string][]> = {
	horizontal: [
		["start", "Left"],
		["end", "Right"],
		["stretch", "Left and right"],
		["center", "Center"],
		["scale", "Scale"],
	],
	vertical: [
		["start", "Top"],
		["end", "Bottom"],
		["stretch", "Top and bottom"],
		["center", "Center"],
		["scale", "Scale"],
	],
};

/** Whether the Constraints section applies: every layer is placed by its own
 *  box, not by an auto layout. */
export function takesConstraints(ins: Pick<Inspect, "template" | "keys">) {
	return ins.keys.every(
		(k) => !k.endsWith("/bg") && !isAutoLayoutChild(ins.template, k),
	);
}

/** Sets one axis, dropping the default so an untouched layer stays bare. */
export function withConstraint(
	current: Constraints | undefined,
	axis: Axis,
	value: Constraint,
): Constraints | undefined {
	const next: Constraints = { ...current, [axis]: value };
	if (next[axis] === "start") delete next[axis];
	return Object.keys(next).length > 0 ? next : undefined;
}

export function ConstraintsSection({ ins }: { ins: Inspect }) {
	const els = ins.layers as Element[];
	const value = (axis: Axis) =>
		commonValue(els.map((e) => e.constraints?.[axis] ?? "start"));
	const h = value("horizontal");
	const v = value("vertical");

	const select = (axis: Axis, current: Constraint | null) => (
		<Select
			aria-label={
				axis === "horizontal" ? "Horizontal constraint" : "Vertical constraint"
			}
			className="min-w-0 flex-1"
			value={current}
			placeholder="Mixed"
			onChange={(next) =>
				ins.setShared(`constraints-${axis}`, (el) => ({
					constraints: withConstraint(
						(el as Element).constraints,
						axis,
						next as Constraint,
					),
				}))
			}
		>
			{CONSTRAINT_LABELS[axis].map(([id, label]) => (
				<SelectItem key={id} id={id} textValue={label}>
					{label}
				</SelectItem>
			))}
		</Select>
	);

	return (
		<PanelSection title="Constraints">
			<SharedNotice />
			<div className="flex items-center gap-2">
				<PinDiagram horizontal={h} vertical={v} />
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<Row label="H">{select("horizontal", h)}</Row>
					<Row label="V">{select("vertical", v)}</Row>
				</div>
			</div>
		</PanelSection>
	);
}

/**
 * A layer in its parent, with the sides it keeps its distance to drawn in the
 * accent colour: both for stretch, the middle line for center, and none for
 * scale, which keeps proportions rather than distances.
 */
export function PinDiagram({
	horizontal,
	vertical,
}: {
	horizontal: Constraint | null;
	vertical: Constraint | null;
}) {
	const on = (axis: Axis, side: "start" | "end" | "center") => {
		const c = axis === "horizontal" ? horizontal : vertical;
		if (side === "center") return c === "center";
		return c === side || c === "stretch";
	};
	const pin = (active: boolean) =>
		cn(active ? "stroke-fc-accent" : "stroke-fc-border-strong");
	return (
		<svg
			viewBox="0 0 56 56"
			className="size-14 shrink-0 rounded-[3px] bg-fc-raised"
			role="img"
			aria-label={`Pinned ${describe(horizontal, "horizontal")}, ${describe(vertical, "vertical")}`}
			data-testid="constraints-diagram"
		>
			<rect
				x={4.5}
				y={4.5}
				width={47}
				height={47}
				rx={2}
				className="fill-none stroke-fc-border"
			/>
			<rect
				x={19.5}
				y={19.5}
				width={17}
				height={17}
				rx={1.5}
				className={cn(
					"stroke-fc-muted",
					horizontal === "scale" || vertical === "scale"
						? "fill-fc-accent-soft"
						: "fill-none",
				)}
			/>
			<g strokeWidth={2} strokeLinecap="round">
				<line
					x1={9}
					y1={28}
					x2={16}
					y2={28}
					className={pin(on("horizontal", "start"))}
					data-pin="left"
					data-on={on("horizontal", "start")}
				/>
				<line
					x1={40}
					y1={28}
					x2={47}
					y2={28}
					className={pin(on("horizontal", "end"))}
					data-pin="right"
					data-on={on("horizontal", "end")}
				/>
				<line
					x1={28}
					y1={9}
					x2={28}
					y2={16}
					className={pin(on("vertical", "start"))}
					data-pin="top"
					data-on={on("vertical", "start")}
				/>
				<line
					x1={28}
					y1={40}
					x2={28}
					y2={47}
					className={pin(on("vertical", "end"))}
					data-pin="bottom"
					data-on={on("vertical", "end")}
				/>
				{on("horizontal", "center") ? (
					<line
						x1={28}
						y1={23}
						x2={28}
						y2={33}
						className="stroke-fc-accent"
						data-pin="hcenter"
					/>
				) : null}
				{on("vertical", "center") ? (
					<line
						x1={23}
						y1={28}
						x2={33}
						y2={28}
						className="stroke-fc-accent"
						data-pin="vcenter"
					/>
				) : null}
			</g>
		</svg>
	);
}

function describe(c: Constraint | null, axis: Axis): string {
	if (c === null) return "mixed";
	return (
		CONSTRAINT_LABELS[axis].find(([id]) => id === c)?.[1] ?? c
	).toLowerCase();
}
