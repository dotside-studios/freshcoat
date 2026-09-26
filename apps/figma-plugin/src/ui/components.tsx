import {
	Button,
	IconImage16,
	IconLink16,
	IconText16,
} from "@create-figma-plugin/ui";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { BindProperty, FieldFormat } from "~/lib/figma/binding";
import { Stack } from "~/ui/layout";

// Presentational pieces shared by more than one tab. Each owns its look so a
// row that points at a layer, an empty tab or a confirmation reads the same
// wherever it appears.

const HEX = /^#([0-9a-f]{3,8})$/i;

/** The glyph for a field's type: the same one in the Layer, Fields and Export
 *  tabs, so a field is recognizable by shape before its name is read. */
export function FormatIcon(props: {
	format: FieldFormat | string;
	color?: string;
}): JSX.Element {
	if (props.format === "image") return <IconImage16 />;
	if (props.format === "url") return <IconLink16 />;
	if (props.format === "color") {
		const valid = props.color && HEX.test(props.color);
		return (
			<div
				style={{
					width: 12,
					height: 12,
					margin: 2,
					borderRadius: 3,
					background: valid ? props.color : "var(--figma-color-bg-tertiary)",
					border: "1px solid var(--figma-color-border)",
				}}
			/>
		);
	}
	return <IconText16 />;
}

function QrIcon(): JSX.Element {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
			<path
				fill="currentColor"
				d="M3 3h4v4H3zm1 1v2h2V4zm5-1h4v4H9zm1 1v2h2V4zM3 9h4v4H3zm1 1v2h2v-2zm5-1h1v1H9zm2 0h2v1h-2zm-2 2h2v2H9zm3 0h1v2h-1z"
			/>
		</svg>
	);
}

/** The Freshcoat mark, from freshcoat/brand/freshcoat-mark-mono.svg. */
export function FreshcoatMark(): JSX.Element {
	return (
		<svg
			width="14"
			height="12"
			viewBox="0 0 138 120"
			aria-hidden="true"
			style={{ display: "block", flexShrink: 0 }}
		>
			<path
				fill="currentColor"
				d="M68.221.163c12.537-.569 25.46.344 37.139 2.922 11.38 2.51 23.082 6.931 31.784 14.478l-10.812 12.464-10.809 12.465c-1.427-1.236-3.564-2.554-6.446-3.803a5 5 0 0 0-1.28-.61l-1.189-.374a60 60 0 0 0-5.249-1.641L56.945 22.17a5 5 0 0 0-6.264 3.278l-2.462 7.872a5 5 0 0 0 3.279 6.265l50.852 15.908a5 5 0 0 0 4.62-.872l-1.436 4.59a.5.5 0 0 1-.561.344l-28.108-4.762a5.5 5.5 0 0 0-6.168 3.782l-2.09 6.678-1.943-.608-.729 2.329-1.873 8.172 7.415 2.321 3.118-7.784.728-2.33-1.943-.608 2.089-6.678a.5.5 0 0 1 .561-.344l28.108 4.762a5.5 5.5 0 0 0 6.168-3.78l2.253-7.203c2.207 2.782 4.14 5.789 5.681 9.029l-3.927 1.867q.315.228.626.461l-9.916 13.189-9.915 13.188c-1.308-.983-4.688-2.66-10.544-4.145a82 82 0 0 0-6.63-1.378c4.46 6.35 8.545 12.85 11.722 19.07l-29.388 15.012c-9.296-18.195-30.288-41.844-38.29-49.186l1.833-2-4.862-5.101c4.926-4.696 11.248-7.449 17.203-9.126a55 55 0 0 0-2.72.076c-7.07.376-11.514 2.064-13.816 3.766L9.808 44.957 0 31.688a45 45 0 0 1 5.502-3.472l-3.371-2.669C9.573 16.145 20.829 10.262 31.732 6.59 42.968 2.803 55.702.73 68.222.163M55.724 95.096a3 3 0 0 0 1.873 4.02l5.532 1.732a3 3 0 0 0 3.83-2.237l4.517-21.143-7.415-2.32z"
			/>
		</svg>
	);
}

/** A button label led by the Freshcoat mark. */
export function OpenInFreshcoatLabel(): JSX.Element {
	return (
		<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
			<FreshcoatMark />
			Open in Freshcoat
		</span>
	);
}

function BarcodeIcon(): JSX.Element {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
			<path
				fill="currentColor"
				d="M2 4h1v8H2zm2 0h2v8H4zm3 0h1v8H7zm2 0h1v8H9zm2 0h2v8h-2zm3 0h1v8h-1z"
			/>
		</svg>
	);
}

/** The glyph for what a layer is bound as. A QR code and a barcode are both
 *  text or URL fields underneath, so they get their own shapes here. */
export function PropertyIcon(props: {
	property: BindProperty;
	format: FieldFormat;
	/** A color field's default, shown in its swatch. */
	color?: string;
}): JSX.Element {
	if (props.property === "qr") return <QrIcon />;
	if (props.property === "barcode") return <BarcodeIcon />;
	return <FormatIcon format={props.format} color={props.color} />;
}

/** Two lines: a name, and a muted detail under it, each truncating with the
 *  whole text in its tooltip. */
export function Lines(props: {
	title: ComponentChildren;
	meta?: ComponentChildren;
}): JSX.Element {
	const tip = (c: ComponentChildren) => (typeof c === "string" ? c : undefined);
	return (
		<span style={{ display: "block", minWidth: 0 }}>
			<span style={TRUNCATE} title={tip(props.title)}>
				{props.title}
			</span>
			{props.meta ? (
				<span
					title={tip(props.meta)}
					style={{ ...TRUNCATE, color: "var(--figma-color-text-secondary)" }}
				>
					{props.meta}
				</span>
			) : null}
		</span>
	);
}

/** A full-width row that is one action: bind as, jump to a field's layer.
 *  A real button, so it takes focus and answers Enter and Space. One 32 px
 *  line: the title, then its detail in muted text, truncating from the end,
 *  with both in the tooltip. */
export function ListButton(props: {
	icon?: ComponentChildren;
	title: string;
	meta?: string;
	onClick: () => void;
	disabled?: boolean;
	label?: string;
	tooltip?: string;
}): JSX.Element {
	const full = [props.title, props.meta].filter(Boolean).join(" · ");
	return (
		<button
			type="button"
			class="fc-row"
			onClick={props.onClick}
			disabled={props.disabled}
			aria-label={props.label}
			title={props.tooltip ? `${full}\n${props.tooltip}` : full}
		>
			{props.icon ? <IconSlot>{props.icon}</IconSlot> : null}
			<span
				style={{
					...TRUNCATE,
					flexShrink: props.meta ? 0 : 1,
					maxWidth: props.meta ? "60%" : undefined,
				}}
			>
				{props.title}
			</span>
			{props.meta ? (
				<span
					style={{
						...TRUNCATE,
						flex: 1,
						minWidth: 0,
						color: "var(--figma-color-text-secondary)",
					}}
				>
					{props.meta}
				</span>
			) : null}
		</button>
	);
}

const TRUNCATE: JSX.CSSProperties = {
	display: "block",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	lineHeight: "16px",
};

export function IconSlot(props: { children: ComponentChildren }): JSX.Element {
	return (
		<span
			aria-hidden="true"
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: "16px",
				height: "16px",
				flexShrink: 0,
				color: "var(--figma-color-icon)",
			}}
		>
			{props.children}
		</span>
	);
}

/** A link-styled button naming a layer; clicking it selects that layer. */
export function JumpButton(props: {
	onClick: () => void;
	title?: string;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<button
			type="button"
			class="fc-link"
			onClick={props.onClick}
			title={props.title ?? "Select on canvas"}
			style={{
				display: "block",
				maxWidth: "100%",
				minHeight: "24px",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
			}}
		>
			{props.children}
		</button>
	);
}

export function Badge(props: { children: ComponentChildren }): JSX.Element {
	return (
		<span
			style={{
				fontSize: "11px",
				lineHeight: "16px",
				padding: "0 6px",
				borderRadius: "4px",
				background: "var(--figma-color-bg-secondary)",
				color: "var(--figma-color-text-secondary)",
			}}
		>
			{props.children}
		</span>
	);
}

/** A tab with nothing to show: a title of a few words, at most one line, and at
 *  most one action. */
export function EmptyState(props: {
	title: string;
	line?: ComponentChildren;
	action?: ComponentChildren;
}): JSX.Element {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: "var(--space-extra-small)",
				padding: "32px var(--fc-gutter)",
				textAlign: "center",
			}}
		>
			<div style={{ fontWeight: "var(--font-weight-bold)" }}>{props.title}</div>
			{props.line ? <Hint>{props.line}</Hint> : null}
			{props.action ? (
				<div style={{ marginTop: "8px" }}>{props.action}</div>
			) : null}
		</div>
	);
}

/** "Unbind name?" with the two answers, in place of the control that asked.
 *  Cancel takes focus, so Enter straight after the first click is not a second
 *  destructive click; Escape answers Cancel. */
export function InlineConfirm(props: {
	question: string;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
}): JSX.Element {
	const cancelRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		cancelRef.current?.focus();
	}, []);
	return (
		<div
			role="alertdialog"
			aria-label={props.question}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					props.onCancel();
				}
			}}
			style={{
				display: "flex",
				alignItems: "center",
				gap: "8px",
				minHeight: "32px",
				padding: "4px 4px 4px 8px",
				borderRadius: "4px",
				border: "1px solid var(--figma-color-border-danger)",
				background: "var(--figma-color-bg-secondary)",
			}}
		>
			<span
				title={props.question}
				style={{
					...TRUNCATE,
					flex: 1,
					minWidth: 0,
					fontWeight: "var(--font-weight-bold)",
				}}
			>
				{props.question}
			</span>
			<Button danger onClick={props.onConfirm}>
				{props.confirmLabel}
			</Button>
			<Button ref={cancelRef} secondary onClick={props.onCancel}>
				Cancel
			</Button>
		</div>
	);
}

/** A thin bar for a long step. Determinate when `value` (0 to 1) is known,
 *  a sliding band otherwise. */
export function ProgressBar(props: {
	value?: number;
	label: string;
}): JSX.Element {
	const known = props.value !== undefined;
	const pct = known
		? Math.round(Math.min(1, Math.max(0, props.value ?? 0)) * 100)
		: 0;
	return (
		<div
			role="progressbar"
			aria-label={props.label}
			aria-valuemin={known ? 0 : undefined}
			aria-valuemax={known ? 100 : undefined}
			aria-valuenow={known ? pct : undefined}
			aria-valuetext={props.label}
			style={{
				position: "relative",
				height: "4px",
				borderRadius: "2px",
				overflow: "hidden",
				background: "var(--figma-color-bg-tertiary)",
			}}
		>
			<div
				class={known ? undefined : "fc-indeterminate"}
				style={{
					position: "absolute",
					top: 0,
					bottom: 0,
					left: 0,
					width: known ? `${pct}%` : "40%",
					background: "var(--figma-color-bg-brand)",
					transition: known ? "width 0.2s" : undefined,
					animation: known
						? undefined
						: "fc-indeterminate 1.2s ease-in-out infinite",
				}}
			/>
		</div>
	);
}

/** A bordered block for a finished result. */
export function Card(props: { children: ComponentChildren }): JSX.Element {
	return (
		<div
			style={{
				padding: "8px",
				borderRadius: "6px",
				border: "1px solid var(--figma-color-border)",
				background: "var(--figma-color-bg)",
			}}
		>
			<Stack gap="extraSmall">{props.children}</Stack>
		</div>
	);
}

/** A muted line under a control. `truncate` holds it to one line, for a hint
 *  that names something of the author's; the rest wrap. */
export function Hint(props: {
	children: ComponentChildren;
	truncate?: boolean;
	title?: string;
}): JSX.Element {
	return (
		<div
			title={props.title}
			style={{
				...(props.truncate ? TRUNCATE : { lineHeight: "16px" }),
				color: "var(--figma-color-text-secondary)",
			}}
		>
			{props.children}
		</div>
	);
}
