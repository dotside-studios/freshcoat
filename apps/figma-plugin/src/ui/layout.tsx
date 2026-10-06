import type { ComponentChildren, JSX } from "preact";

// Layout primitives. Spacing is a property of the relationship between two
// elements, so it lives on the container that owns that relationship, not as
// <VerticalSpace> sprinkled between siblings, where every call site has to
// re-derive the scale and a conditional block silently drops (or doubles) a gap.
//
// The panel is designed for Figma's compact plugin window, 320 by 480, on the
// grid Figma's own panels use: 11 px text, 24 px controls in 32 px rows, 8 px
// between related things and 12 px between sections. The scale, smallest to
// largest:
//   extraSmall  a line and the line that qualifies it
//   small       control → control, and a control row's cadence
//   medium      section → section
//   large       page-level breathing room

export type Space = "extraSmall" | "small" | "medium" | "large";

const SPACE: Record<Space, string> = {
	extraSmall: "4px",
	small: "8px",
	medium: "12px",
	large: "16px",
};

/** The side margin of every tab. 12 px at the compact width, growing a little
 *  with the window so a wide panel breathes instead of stretching. */
const GUTTER = "var(--fc-gutter)";

/** The width of a label beside its control, as Figma's property rows have. */
const LABEL_WIDTH = "64px";

/** Vertical flow with one uniform gap. Null/false children collapse without
 *  leaving a gap behind, which is the main thing manual spacers get wrong. */
export function Stack(props: {
	gap?: Space;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: SPACE[props.gap ?? "small"],
			}}
		>
			{props.children}
		</div>
	);
}

/** Horizontal flow. `fill` marks the child that absorbs leftover width: wrap
 *  it in <Fill> rather than styling it at the call site. */
export function Row(props: {
	gap?: Space;
	align?: "center" | "start" | "baseline";
	/** "end" pushes the children to the trailing edge, as a button row is. */
	justify?: "start" | "end";
	children: ComponentChildren;
}): JSX.Element {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: props.align ?? "center",
				justifyContent: props.justify === "end" ? "flex-end" : undefined,
				gap: SPACE[props.gap ?? "small"],
				minWidth: 0,
			}}
		>
			{props.children}
		</div>
	);
}

/** Horizontal flow that wraps onto more lines instead of overflowing. For runs
 *  of small items with no fixed count: badges, chips, tags. */
export function Wrap(props: {
	gap?: Space;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: SPACE[props.gap ?? "extraSmall"],
			}}
		>
			{props.children}
		</div>
	);
}

/** The child of a Row that takes the remaining width and truncates rather than
 *  pushing its siblings out of the panel. */
export function Fill(props: { children: ComponentChildren }): JSX.Element {
	return <div style={{ flex: 1, minWidth: 0 }}>{props.children}</div>;
}

/** One line that ends in an ellipsis rather than wrapping, with the whole text
 *  in a tooltip. For names the author chose, which can be any length. */
export function Truncate(props: {
	text: string;
	bold?: boolean;
	muted?: boolean;
}): JSX.Element {
	return (
		<span
			title={props.text}
			style={{
				display: "block",
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				lineHeight: "16px",
				fontWeight: props.bold ? "var(--font-weight-bold)" : undefined,
				color: props.muted ? "var(--figma-color-text-secondary)" : undefined,
			}}
		>
			{props.text}
		</span>
	);
}

/** The outer frame of a tab: the gutter, and section-to-section rhythm. It
 *  fills the tab's height, so a `footer` sits at the bottom of the window
 *  when the content is short and stays pinned there when it scrolls: the way
 *  to act on a form is never below the fold. */
export function Panel(props: {
	children: ComponentChildren;
	footer?: ComponentChildren;
}): JSX.Element {
	return (
		<div style={{ display: "flex", flexDirection: "column", flex: "1 0 auto" }}>
			<div
				style={{
					flex: "1 0 auto",
					padding: `8px ${GUTTER} 12px`,
				}}
			>
				<Stack gap="medium">{props.children}</Stack>
			</div>
			{props.footer ? <Footer>{props.footer}</Footer> : null}
		</div>
	);
}

/** The action bar at the bottom of a tab. */
function Footer(props: { children: ComponentChildren }): JSX.Element {
	return (
		<div
			class="fc-footer"
			style={{
				position: "sticky",
				bottom: 0,
				zIndex: 2,
				padding: `8px ${GUTTER}`,
				borderTop: "1px solid var(--figma-color-border)",
				background: "var(--figma-color-bg)",
			}}
		>
			{props.children}
		</div>
	);
}

/** A titled block. Every section after the first on a panel is set off by a
 *  full-width rule, as Figma's own panels divide theirs; the first passes
 *  `divider={false}`. The title row is as tall as a control row, so a trailing
 *  `action` (an icon button) sits in it without growing it. */
export function Section(props: {
	title: ComponentChildren;
	divider?: boolean;
	action?: ComponentChildren;
	children?: ComponentChildren;
}): JSX.Element {
	return (
		<section
			style={{
				display: "flex",
				flexDirection: "column",
				gap: SPACE.small,
				...(props.divider === false
					? {}
					: {
							margin: `0 calc(-1 * ${GUTTER})`,
							padding: `${SPACE.small} ${GUTTER} 0`,
							borderTop: "1px solid var(--figma-color-border)",
						}),
			}}
		>
			<SectionTitle action={props.action}>{props.title}</SectionTitle>
			{props.children}
		</section>
	);
}

/** A section's heading line: 11 px bold, 24 px tall, truncating. */
export function SectionTitle(props: {
	children: ComponentChildren;
	action?: ComponentChildren;
}): JSX.Element {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: SPACE.small,
				minHeight: "24px",
				margin: `-${SPACE.extraSmall} 0`,
			}}
		>
			<h2
				title={typeof props.children === "string" ? props.children : undefined}
				style={{
					flex: 1,
					minWidth: 0,
					margin: 0,
					fontSize: "inherit",
					fontWeight: "var(--font-weight-bold)",
					lineHeight: "16px",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{props.children}
			</h2>
			{props.action}
		</div>
	);
}

const LABEL_TEXT: JSX.CSSProperties = {
	color: "var(--figma-color-text-secondary)",
	lineHeight: "16px",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

function labelledStyle(inline: boolean | undefined): JSX.CSSProperties {
	return inline
		? {
				display: "grid",
				gridTemplateColumns: `${LABEL_WIDTH} minmax(0, 1fr)`,
				alignItems: "center",
				columnGap: SPACE.small,
			}
		: {
				display: "flex",
				flexDirection: "column",
				gap: SPACE.extraSmall,
			};
}

/** A labelled single control. Renders a real <label>, so clicking the caption
 *  focuses the input and assistive tech reads the two as one thing. `inline`
 *  puts a short label beside the control, as Figma's property rows do; long
 *  labels go above.
 *
 *  Only for controls that are a single labelable element: Textbox is, and is
 *  the common case. Dropdown and SegmentedControl render their own <label>
 *  elements internally and cannot be nested inside another one; use FieldGroup
 *  for those. */
export function Field(props: {
	label: string;
	inline?: boolean;
	children: ComponentChildren;
}): JSX.Element {
	return (
		/* biome-ignore lint/a11y/noLabelWithoutControl: the control is the
		   children, which the rule cannot see into. */
		<label style={labelledStyle(props.inline)}>
			<span style={LABEL_TEXT}>{props.label}</span>
			{props.children}
		</label>
	);
}

/** A labelled group of controls, for anything Field can't wrap: Dropdown,
 *  SegmentedControl, a row of buttons. Same look, associated via aria-label
 *  instead of <label> nesting. */
export function FieldGroup(props: {
	label: string;
	inline?: boolean;
	children: ComponentChildren;
}): JSX.Element {
	return (
		/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> carries UA
		   styling and layout this panel doesn't want; role="group" is the same
		   semantic without it. */
		<div
			role="group"
			aria-label={props.label}
			style={labelledStyle(props.inline)}
		>
			<span aria-hidden="true" style={LABEL_TEXT}>
				{props.label}
			</span>
			{props.children}
		</div>
	);
}

/** A control that belongs to the inline rows above it but has no label of its
 *  own, such as a checkbox: it lines up with their controls. */
export function Indented(props: { children: ComponentChildren }): JSX.Element {
	return (
		<div style={{ paddingLeft: `calc(${LABEL_WIDTH} + ${SPACE.small})` }}>
			{props.children}
		</div>
	);
}

const THUMB_WIDTH = 48;
const THUMB_HEIGHT = 32;

/** A frame preview. Fixed box, `contain` fit — a CR80 card and an A4
 *  certificate both land in the same slot without distortion. Renders an empty
 *  well while the export is in flight, so a list doesn't reflow as thumbnails
 *  arrive. Clickable when `onClick` is given, to select the frame on canvas. */
export function Thumbnail(props: {
	src?: string;
	alt: string;
	onClick?: () => void;
}): JSX.Element {
	const box: JSX.CSSProperties = {
		width: `${THUMB_WIDTH}px`,
		height: `${THUMB_HEIGHT}px`,
		flexShrink: 0,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		padding: 0,
		borderRadius: "2px",
		border: "1px solid var(--figma-color-border)",
		background: "var(--figma-color-bg-secondary)",
	};
	const inner = props.src ? (
		<img
			src={props.src}
			alt={props.alt}
			style={{ maxWidth: "100%", maxHeight: "100%", display: "block" }}
		/>
	) : null;

	if (!props.onClick) return <div style={box}>{inner}</div>;
	return (
		<button
			type="button"
			onClick={props.onClick}
			title="Select this frame on the canvas"
			style={{ ...box, cursor: "pointer" }}
		>
			{inner}
		</button>
	);
}
