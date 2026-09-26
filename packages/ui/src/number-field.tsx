import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Group, Input } from "react-aria-components";
import { cn } from "./lib/cn";

export interface NumberFieldProps {
	/** Short scrub handle shown inside the field, e.g. "X", "W", "°". */
	label?: ReactNode;
	"aria-label"?: string;
	/** `null` is a mixed multi-selection and shows the placeholder. */
	value: number | null;
	onChange: (value: number) => void;
	/** Fired once per gesture: scrub release, Enter, blur, or an arrow step. */
	onCommit?: () => void;
	step?: number;
	min?: number;
	max?: number;
	/** Suffix such as "%", "°" or "px", shown after the value. Typed copies of it are ignored. */
	unit?: string;
	formatOptions?: Intl.NumberFormatOptions;
	/** Maximum fraction digits kept. Defaults to formatOptions or 2. */
	precision?: number;
	placeholder?: string;
	isDisabled?: boolean;
	id?: string;
	className?: string;
	inputClassName?: string;
}

/**
 * Evaluates `+ - * /`, parentheses, unary signs and decimals.
 * Returns null for anything else, so a typo reverts instead of committing.
 */
export function evaluateExpression(source: string): number | null {
	const s = source.replace(/\s+/g, "");
	if (s === "") return null;
	let i = 0;

	const peek = () => s[i];

	function number(): number | null {
		const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
		if (!m) return null;
		i += m[0].length;
		return Number.parseFloat(m[0]);
	}

	function primary(): number | null {
		if (peek() === "(") {
			i++;
			const v = expr();
			if (v === null || peek() !== ")") return null;
			i++;
			return v;
		}
		return number();
	}

	function unary(): number | null {
		const c = peek();
		if (c === "-" || c === "+") {
			i++;
			const v = unary();
			return v === null ? null : c === "-" ? -v : v;
		}
		return primary();
	}

	function term(): number | null {
		let left = unary();
		while (left !== null && (peek() === "*" || peek() === "/")) {
			const op = s[i++];
			const right = unary();
			if (right === null) return null;
			left = op === "*" ? left * right : left / right;
		}
		return left;
	}

	function expr(): number | null {
		let left = term();
		while (left !== null && (peek() === "+" || peek() === "-")) {
			const op = s[i++];
			const right = term();
			if (right === null) return null;
			left = op === "+" ? left + right : left - right;
		}
		return left;
	}

	const result = expr();
	if (result === null || i !== s.length || !Number.isFinite(result))
		return null;
	return result;
}

function roundTo(value: number, digits: number): number {
	const f = 10 ** digits;
	return Math.round(value * f) / f;
}

const SCRUB_THRESHOLD = 3;

interface ScrubState {
	pointerId: number;
	startX: number;
	lastX: number;
	acc: number;
	moved: boolean;
}

export function NumberField({
	label,
	"aria-label": ariaLabel,
	value,
	onChange,
	onCommit,
	step = 1,
	min = Number.NEGATIVE_INFINITY,
	max = Number.POSITIVE_INFINITY,
	unit,
	formatOptions,
	precision,
	placeholder = "Mixed",
	isDisabled,
	id,
	className,
	inputClassName,
}: NumberFieldProps) {
	const autoId = useId();
	const inputId = id ?? autoId;
	const inputRef = useRef<HTMLInputElement>(null);
	const [draft, setDraft] = useState<string | null>(null);
	const [scrubbing, setScrubbing] = useState(false);
	const scrub = useRef<ScrubState | null>(null);

	const digits = precision ?? formatOptions?.maximumFractionDigits ?? 2;
	const formatter = useMemo(
		() =>
			new Intl.NumberFormat("en-US", {
				useGrouping: false,
				maximumFractionDigits: digits,
				...formatOptions,
			}),
		[digits, formatOptions],
	);

	const clamp = (v: number) => Math.min(max, Math.max(min, roundTo(v, digits)));
	const display =
		value === null ? "" : `${formatter.format(value)}${unit ?? ""}`;

	function parse(text: string): number | null {
		let t = text.trim();
		if (unit) t = t.split(unit).join("");
		t = t.replace(/px/gi, "");
		// "*2" or "/2" applies to the current value.
		if (/^[*/]/.test(t) && value !== null) t = `${value}${t}`;
		return evaluateExpression(t);
	}

	function emit(next: number) {
		if (next !== value) {
			onChange(next);
			onCommit?.();
		}
	}

	function commitDraft() {
		if (draft === null) return;
		const parsed = parse(draft);
		setDraft(null);
		if (parsed !== null) emit(clamp(parsed));
	}

	function multiplier(e: { shiftKey: boolean; altKey: boolean }) {
		return e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
	}

	function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter") {
			e.preventDefault();
			commitDraft();
			// Only while the field still has focus: select() focuses an input, so
			// a frame late it would pull focus back from wherever it went next.
			requestAnimationFrame(() => {
				const input = inputRef.current;
				if (input && input === document.activeElement) input.select();
			});
		} else if (e.key === "Escape") {
			if (draft !== null) {
				e.preventDefault();
				e.stopPropagation();
				setDraft(null);
			}
		} else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault();
			const base = (draft !== null ? parse(draft) : null) ?? value ?? 0;
			const dir = e.key === "ArrowUp" ? 1 : -1;
			setDraft(null);
			emit(clamp(base + dir * step * multiplier(e)));
		}
	}

	function onPointerDown(e: PointerEvent<HTMLSpanElement>) {
		if (isDisabled || e.button !== 0) return;
		e.preventDefault();
		try {
			e.currentTarget.setPointerCapture?.(e.pointerId);
		} catch {
			// jsdom and some pens cannot capture; move events still arrive on the label.
		}
		commitDraft();
		scrub.current = {
			pointerId: e.pointerId,
			startX: e.clientX,
			lastX: e.clientX,
			acc: value ?? (Number.isFinite(min) ? min : 0),
			moved: false,
		};
	}

	function onPointerMove(e: PointerEvent<HTMLSpanElement>) {
		const s = scrub.current;
		if (!s || s.pointerId !== e.pointerId) return;
		let dx = e.clientX - s.lastX;
		s.lastX = e.clientX;
		if (!s.moved) {
			const total = e.clientX - s.startX;
			if (Math.abs(total) < SCRUB_THRESHOLD) return;
			s.moved = true;
			setScrubbing(true);
			dx = total;
		}
		s.acc = Math.min(max, Math.max(min, s.acc + dx * step * multiplier(e)));
		const next = clamp(s.acc);
		if (next !== value) onChange(next);
	}

	function endScrub(e: PointerEvent<HTMLSpanElement>) {
		const s = scrub.current;
		if (!s || s.pointerId !== e.pointerId) return;
		scrub.current = null;
		try {
			e.currentTarget.releasePointerCapture?.(e.pointerId);
		} catch {
			// Already released.
		}
		if (s.moved) {
			setScrubbing(false);
			onCommit?.();
		} else if (e.type === "pointerup") {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}

	const accessibleName =
		ariaLabel ?? (typeof label === "string" ? label : undefined);

	return (
		<Group
			isDisabled={isDisabled}
			data-scrubbing={scrubbing || undefined}
			className={cn(
				"flex h-fc-control min-w-0 items-center rounded-[3px] border border-transparent bg-fc-raised text-fc-base",
				"data-hovered:border-fc-border-strong data-focus-within:border-fc-accent data-focus-within:data-hovered:border-fc-accent data-disabled:opacity-40",
				"data-focus-visible:outline-none",
				className,
			)}
		>
			{label != null && (
				<span
					aria-hidden="true"
					data-scrub-handle=""
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={endScrub}
					onPointerCancel={endScrub}
					className={cn(
						"flex h-full min-w-5 shrink-0 cursor-ew-resize touch-none select-none items-center justify-center pl-1 text-fc-base text-fc-muted",
						"[&_svg]:size-3.5",
						scrubbing && "text-fc-text",
						isDisabled && "cursor-default",
					)}
				>
					{label}
				</span>
			)}
			<Input
				ref={inputRef}
				id={inputId}
				role="spinbutton"
				inputMode="decimal"
				autoComplete="off"
				spellCheck={false}
				aria-label={accessibleName}
				aria-valuenow={value ?? undefined}
				aria-valuetext={value === null ? placeholder : undefined}
				aria-valuemin={Number.isFinite(min) ? min : undefined}
				aria-valuemax={Number.isFinite(max) ? max : undefined}
				disabled={isDisabled}
				placeholder={placeholder}
				value={draft ?? display}
				onChange={(e) => setDraft(e.target.value)}
				onFocus={(e) => e.target.select()}
				onBlur={commitDraft}
				onKeyDown={onKeyDown}
				className={cn(
					"h-full w-full min-w-0 bg-transparent text-fc-base text-fc-text tabular-nums outline-none placeholder:text-fc-faint data-focus-visible:outline-none",
					label != null ? "pr-1.5 pl-1" : "px-1.5",
					inputClassName,
				)}
			/>
		</Group>
	);
}
