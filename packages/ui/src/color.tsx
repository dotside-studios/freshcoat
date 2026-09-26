import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Button,
	type Color,
	ColorArea,
	ColorField,
	ColorPicker,
	ColorSlider,
	ColorSwatch,
	ColorSwatchPicker,
	ColorSwatchPickerItem,
	ColorThumb,
	Dialog,
	DialogTrigger,
	Group,
	Input,
	parseColor,
	SliderTrack,
} from "react-aria-components";
import { inputBase } from "./field";
import { cn } from "./lib/cn";
import { fieldLabel } from "./lib/styles";
import { NumberField } from "./number-field";
import { Popover } from "./popover";

export interface ColorInputProps {
	/** `#rrggbb`, `#rrggbbaa`, any CSS colour, or a raw token such as `{{brand}}`. */
	value: string;
	onChange: (value: string) => void;
	onCommit?: () => void;
	label?: ReactNode;
	"aria-label"?: string;
	/** Document colours offered in the picker. */
	swatches?: string[];
	isDisabled?: boolean;
	className?: string;
}

const CHECKER =
	"repeating-conic-gradient(var(--color-fc-checker-b) 0 25%, var(--color-fc-checker-a) 0 50%) 0 0 / 8px 8px";

/** Parses what RAC understands, or returns null (tokens, named colours, typos). */
export function tryParseColor(value: string): Color | null {
	const v = value.trim();
	if (!v) return null;
	try {
		return parseColor(v);
	} catch {
		return null;
	}
}

function hex2(n: number) {
	return Math.round(Math.min(255, Math.max(0, n)))
		.toString(16)
		.padStart(2, "0");
}

/** `#rrggbb`, or `#rrggbbaa` when alpha < 1. Always lowercase. */
export function colorToHex(color: Color): string {
	const rgb = color.toFormat("rgb");
	const r = rgb.getChannelValue("red");
	const g = rgb.getChannelValue("green");
	const b = rgb.getChannelValue("blue");
	const a = rgb.getChannelValue("alpha");
	const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
	return a < 1 ? `${base}${hex2(a * 255)}` : base;
}

function cssSupportsColor(value: string) {
	return (
		typeof CSS !== "undefined" &&
		typeof CSS.supports === "function" &&
		CSS.supports("color", value)
	);
}

/**
 * Resolves text typed into the hex field. Hex without `#` is accepted.
 * Returns the value to emit, or null to revert.
 */
export function resolveColorText(text: string): string | null {
	const t = text.trim();
	if (!t) return null;
	const hexish = /^[0-9a-f]{3,8}$/i.test(t) ? `#${t}` : t;
	const parsed = tryParseColor(hexish);
	if (parsed) return colorToHex(parsed);
	if (t.includes("{{") || cssSupportsColor(t)) return t;
	return null;
}

function Checker({
	color,
	className,
}: {
	color: string | null;
	className?: string;
}) {
	return (
		<span
			className={cn("relative block overflow-hidden rounded-[2px]", className)}
			style={{ background: color ? CHECKER : undefined }}
		>
			<span
				className={cn(
					"absolute inset-0",
					!color &&
						"bg-fc-active bg-[linear-gradient(to_top_right,transparent_calc(50%-0.75px),var(--color-fc-faint)_calc(50%-0.75px),var(--color-fc-faint)_calc(50%+0.75px),transparent_calc(50%+0.75px))]",
				)}
				style={color ? { background: color } : undefined}
			/>
			<span className="absolute inset-0 rounded-[2px] shadow-[inset_0_0_0_1px_var(--color-fc-swatch-ring)]" />
		</span>
	);
}

export function ColorInput({
	value,
	onChange,
	onCommit,
	label,
	"aria-label": ariaLabel,
	swatches,
	isDisabled,
	className,
}: ColorInputProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const parsed = useMemo(() => tryParseColor(value), [value]);
	const swatchColor = parsed ? value : cssSupportsColor(value) ? value : null;
	const name = ariaLabel ?? (typeof label === "string" ? label : "Color");

	function commitDraft() {
		if (draft === null) return;
		const next = resolveColorText(draft);
		setDraft(null);
		if (next !== null && next !== value) {
			onChange(next);
			onCommit?.();
		}
	}

	function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter") {
			e.preventDefault();
			commitDraft();
		} else if (e.key === "Escape" && draft !== null) {
			e.preventDefault();
			e.stopPropagation();
			setDraft(null);
		}
	}

	return (
		<div className={cn("flex min-w-0 items-center gap-2", className)}>
			{label != null && (
				<span className={cn(fieldLabel, "w-16 shrink-0 truncate")}>
					{label}
				</span>
			)}
			<Group
				isDisabled={isDisabled}
				className="flex h-fc-control min-w-0 flex-1 items-center gap-1.5 rounded-[3px] border border-transparent bg-fc-raised pl-[3px] data-hovered:border-fc-border-strong data-focus-within:border-fc-accent data-focus-within:data-hovered:border-fc-accent data-disabled:opacity-40 data-focus-visible:outline-none"
			>
				<DialogTrigger>
					<Button
						aria-label={`${name}: open picker`}
						isDisabled={isDisabled}
						className="flex size-4.5 shrink-0 cursor-default rounded-[2px] outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-offset-1 pointer-coarse:size-6"
					>
						<Checker color={swatchColor} className="size-full" />
					</Button>
					<Popover placement="bottom start" className="overflow-visible">
						<Dialog aria-label={name} className="outline-none">
							<ColorPickerPanel
								value={value}
								parsed={parsed}
								onChange={onChange}
								onCommit={onCommit}
								swatches={swatches}
							/>
						</Dialog>
					</Popover>
				</DialogTrigger>
				<Input
					aria-label={name}
					value={draft ?? value}
					disabled={isDisabled}
					spellCheck={false}
					autoComplete="off"
					onChange={(e) => setDraft(e.target.value)}
					onFocus={(e) => e.target.select()}
					onBlur={commitDraft}
					onKeyDown={onKeyDown}
					className="h-full min-w-0 flex-1 bg-transparent pr-1.5 font-fc-mono text-[11px] text-fc-text outline-none placeholder:text-fc-faint data-focus-visible:outline-none"
				/>
			</Group>
		</div>
	);
}

const NEUTRAL = parseColor("#808080");

/** The picker `ColorInput` opens, for a caller that shows it in its own
 *  popover beside other controls. */
export function ColorPanel({
	value,
	onChange,
	onCommit,
	swatches,
}: {
	value: string;
	onChange: (value: string) => void;
	onCommit?: () => void;
	swatches?: string[];
}) {
	const parsed = useMemo(() => tryParseColor(value), [value]);
	return (
		<ColorPickerPanel
			value={value}
			parsed={parsed}
			onChange={onChange}
			onCommit={onCommit}
			swatches={swatches}
		/>
	);
}

function ColorPickerPanel({
	value,
	parsed,
	onChange,
	onCommit,
	swatches,
}: {
	value: string;
	parsed: Color | null;
	onChange: (value: string) => void;
	onCommit?: () => void;
	swatches?: string[];
}) {
	// Held locally in HSB so hue survives passing through grey and black.
	const [color, setColor] = useState<Color>(() =>
		(parsed ?? NEUTRAL).toFormat("hsb"),
	);
	const emitted = useRef(value);

	useEffect(() => {
		if (value === emitted.current || !parsed) return;
		emitted.current = value;
		setColor(parsed.toFormat("hsb"));
	}, [value, parsed]);

	function change(next: Color) {
		const hsb = next.toFormat("hsb");
		setColor(hsb);
		const hex = colorToHex(hsb);
		emitted.current = hex;
		if (hex !== value) onChange(hex);
	}

	const commit = () => onCommit?.();
	const alpha = Math.round(color.getChannelValue("alpha") * 100);
	const usable = (swatches ?? []).filter((s) => tryParseColor(s));

	const trackWithChecker = ({
		defaultStyle,
	}: {
		defaultStyle: CSSProperties;
	}): CSSProperties => ({
		...defaultStyle,
		background: `${defaultStyle.background}, ${CHECKER}`,
	});

	const thumb =
		"size-3.5 rounded-full border-2 border-white shadow-(--shadow-fc-handle) outline-none data-focus-visible:size-4 pointer-coarse:size-5";

	return (
		<ColorPicker value={color} onChange={change}>
			<div className="flex w-60 flex-col gap-2.5 p-2.5">
				<ColorArea
					colorSpace="hsb"
					xChannel="saturation"
					yChannel="brightness"
					onChangeEnd={commit}
					className="aspect-[4/3] w-full shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_var(--color-fc-swatch-ring)]"
				>
					<ColorThumb className={thumb} />
				</ColorArea>
				<ColorSlider
					colorSpace="hsb"
					channel="hue"
					onChangeEnd={commit}
					aria-label="Hue"
				>
					<SliderTrack className="h-3 w-full rounded-full pointer-coarse:h-5">
						<ColorThumb className={cn(thumb, "top-1/2 -translate-y-1/2")} />
					</SliderTrack>
				</ColorSlider>
				<ColorSlider channel="alpha" onChangeEnd={commit} aria-label="Alpha">
					<SliderTrack
						className="h-3 w-full rounded-full pointer-coarse:h-5"
						style={trackWithChecker}
					>
						<ColorThumb className={cn(thumb, "top-1/2 -translate-y-1/2")} />
					</SliderTrack>
				</ColorSlider>
				<div className="flex gap-1.5">
					<ColorField
						aria-label="Hex"
						onChange={commit}
						className="min-w-0 flex-1"
					>
						<Input
							className={cn(
								inputBase,
								"h-fc-control border-fc-border bg-fc-panel font-fc-mono text-[11px] uppercase",
							)}
						/>
					</ColorField>
					<NumberField
						aria-label="Alpha"
						label="A"
						unit="%"
						min={0}
						max={100}
						precision={0}
						value={alpha}
						onChange={(v) => change(color.withChannelValue("alpha", v / 100))}
						onCommit={commit}
						className="w-18 shrink-0 border-fc-border bg-fc-panel"
					/>
				</div>
				{usable.length > 0 && (
					<ColorSwatchPicker
						aria-label="Template colors"
						onChange={commit}
						className="flex flex-wrap gap-1 border-fc-border border-t pt-2.5"
					>
						{usable.map((s) => (
							<ColorSwatchPickerItem
								key={s}
								color={s}
								className="size-5 cursor-default rounded-[3px] outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-offset-1 data-selected:shadow-[0_0_0_1px_var(--color-fc-panel),0_0_0_2px_var(--color-fc-text)] pointer-coarse:size-7"
							>
								<ColorSwatch
									className="size-full rounded-[3px] shadow-[inset_0_0_0_1px_var(--color-fc-swatch-ring)]"
									style={({ color: c }) => ({
										background: `linear-gradient(${c.toString("css")}, ${c.toString("css")}), ${CHECKER}`,
									})}
								/>
							</ColorSwatchPickerItem>
						))}
					</ColorSwatchPicker>
				)}
			</div>
		</ColorPicker>
	);
}
