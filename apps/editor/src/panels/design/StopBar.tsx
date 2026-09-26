import { ColorInput } from "@freshcoat/ui/color";
import { cn } from "@freshcoat/ui/lib/cn";
import { NumberField } from "@freshcoat/ui/number-field";
import {
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { RemoveButton } from "./controls";
import { sameValue } from "./field-helpers";
import {
	insertStop,
	moveStop,
	removeStop,
	replaceAt,
	type Stop,
	sortedStops,
} from "./fills";

/** How far past the bar, in pixels, a dragged stop is pulled off it. */
const TEAR_OFF = 28;
/** The bar's inset on each side, so a stop at 0 or 1 stays on the bar. */
const INSET = 6;

let dragSerial = 0;

export function gradientCss(stops: readonly Stop[], head = "90deg"): string {
	const list = sortedStops(stops)
		.map((s) => `${s.color} ${Math.round(s.offset * 1000) / 10}%`)
		.join(", ");
	return `${head}, ${list}`;
}

type Drag = {
	pointerId: number;
	field: string;
	/** The stops the drag started from, after any stop it added. */
	base: Stop[];
	index: number;
};

/**
 * A gradient's stops on a bar: drag a stop to move it, click the bar to add
 * one coloured as the gradient is there, drag a stop off the bar or press
 * Delete to remove it. Arrow keys move the selected stop by 1%, with Shift
 * by 10%. Every write from one drag carries the same field, so the
 * inspector merges it into one undo step.
 */
export function StopBar({
	stops,
	selected,
	onSelect,
	onChange,
}: {
	stops: Stop[];
	selected: number;
	onSelect: (index: number) => void;
	onChange: (field: string, stops: Stop[]) => void;
}) {
	const strip = useRef<HTMLDivElement>(null);
	const markers = useRef<(HTMLDivElement | null)[]>([]);
	const drag = useRef<Drag | null>(null);
	const focusNext = useRef(false);
	const [tearing, setTearing] = useState(false);

	useEffect(() => {
		if (!focusNext.current) return;
		focusNext.current = false;
		markers.current[selected]?.focus();
	});

	const write = (field: string, next: Stop[]) => {
		if (!sameValue(next, stops)) onChange(field, next);
	};

	const offsetAt = (clientX: number) => {
		const r = strip.current?.getBoundingClientRect();
		if (!r || r.width <= 0) return 0;
		return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
	};

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		const field = `stop-drag:${++dragSerial}`;
		const marker = (e.target as Element).closest?.("[data-stop]");
		let base = stops;
		let index: number;
		if (marker) {
			index = Number(marker.getAttribute("data-stop"));
			(marker as HTMLElement).focus();
		} else {
			const added = insertStop(stops, offsetAt(e.clientX));
			base = added.stops;
			index = added.index;
			onChange(field, base);
		}
		drag.current = { pointerId: e.pointerId, field, base, index };
		e.currentTarget.setPointerCapture?.(e.pointerId);
		focusNext.current = true;
		onSelect(index);
	};

	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		const r = strip.current?.getBoundingClientRect();
		const off =
			!!r &&
			d.base.length > 2 &&
			(e.clientY < r.top - TEAR_OFF || e.clientY > r.bottom + TEAR_OFF);
		setTearing(off);
		if (off) {
			write(d.field, removeStop(d.base, d.index));
			onSelect(Math.max(0, Math.min(d.index, d.base.length - 2)));
			return;
		}
		const moved = moveStop(d.base, d.index, offsetAt(e.clientX));
		write(d.field, moved.stops);
		onSelect(moved.index);
	};

	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		if (drag.current?.pointerId !== e.pointerId) return;
		drag.current = null;
		setTearing(false);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const s = stops[selected];
		if (!s) return;
		const step = e.shiftKey ? 0.1 : 0.01;
		const by =
			e.key === "ArrowRight" || e.key === "ArrowUp"
				? step
				: e.key === "ArrowLeft" || e.key === "ArrowDown"
					? -step
					: 0;
		if (by) {
			e.preventDefault();
			const moved = moveStop(stops, selected, s.offset + by);
			write("stop-nudge", moved.stops);
			focusNext.current = true;
			onSelect(moved.index);
			return;
		}
		if (e.key === "Delete" || e.key === "Backspace") {
			// Held back even when no stop can go, so it never reaches the layer.
			e.preventDefault();
			if (stops.length <= 2) return;
			onChange("stop-remove", removeStop(stops, selected));
			focusNext.current = true;
			onSelect(Math.max(0, Math.min(selected, stops.length - 2)));
		}
	};

	return (
		<div
			data-testid="stop-bar"
			className="relative h-6 touch-none select-none pointer-coarse:h-8"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
		>
			<div
				className="fc-checkerboard absolute inset-y-1 overflow-hidden rounded-[3px] shadow-[inset_0_0_0_1px_var(--color-fc-swatch-ring)]"
				style={{ left: INSET, right: INSET }}
			>
				<div
					className="absolute inset-0"
					style={{ background: `linear-gradient(${gradientCss(stops)})` }}
				/>
			</div>
			<div
				ref={strip}
				aria-hidden
				className="absolute inset-y-0"
				style={{ left: INSET, right: INSET }}
			/>
			{stops.map((s, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: stops have no identity
					key={i}
					ref={(el) => {
						markers.current[i] = el;
					}}
					data-stop={i}
					role="slider"
					tabIndex={i === selected ? 0 : -1}
					aria-label={`Stop ${i + 1}`}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(s.offset * 1000) / 10}
					aria-valuetext={`${Math.round(s.offset * 1000) / 10}%, ${s.color}`}
					data-selected={i === selected || undefined}
					onKeyDown={onKeyDown}
					onFocus={() => i !== selected && onSelect(i)}
					className={cn(
						"absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize rounded-[3px] shadow-(--shadow-fc-handle) outline-none ring-2 ring-white",
						i === selected && "z-10 ring-fc-accent",
						i === selected && tearing && "opacity-40",
					)}
					style={{
						left: `calc(${INSET}px + (100% - ${INSET * 2}px) * ${s.offset})`,
						// The colour over a checkerboard, so a transparent stop is
						// still a marker to grab.
						background: `linear-gradient(${s.color}, ${s.color}), repeating-conic-gradient(var(--color-fc-checker-b) 0 25%, var(--color-fc-checker-a) 0 50%) 0 0 / 8px 8px`,
					}}
				/>
			))}
		</div>
	);
}

/** The stop bar with the selected stop's position and colour under it. */
export function GradientStops({
	stops,
	swatches,
	onChange,
}: {
	stops: Stop[];
	swatches: string[];
	onChange: (field: string, stops: Stop[]) => void;
}) {
	const [picked, setPicked] = useState(0);
	const selected = Math.min(picked, stops.length - 1);
	const s = stops[selected];
	return (
		<div className="flex flex-col gap-1.5">
			<StopBar
				stops={stops}
				selected={selected}
				onSelect={setPicked}
				onChange={onChange}
			/>
			{s && (
				<div className="flex min-w-0 items-center gap-1.5">
					<NumberField
						aria-label="Stop position"
						className="w-[60px] shrink-0"
						unit="%"
						min={0}
						max={100}
						precision={1}
						value={Math.round(s.offset * 1000) / 10}
						onChange={(v) => {
							const moved = moveStop(stops, selected, v / 100);
							onChange("stop-offset", moved.stops);
							setPicked(moved.index);
						}}
					/>
					<ColorInput
						aria-label="Stop color"
						className="min-w-0 flex-1"
						value={s.color}
						swatches={swatches}
						onChange={(c) =>
							onChange(
								`stop:${selected}:color`,
								replaceAt(stops, selected, { ...s, color: c }),
							)
						}
					/>
					<RemoveButton
						label="Remove stop"
						isDisabled={stops.length <= 2}
						onPress={() => {
							onChange("stop-remove", removeStop(stops, selected));
							setPicked(Math.max(0, Math.min(selected, stops.length - 2)));
						}}
					/>
				</div>
			)}
		</div>
	);
}
