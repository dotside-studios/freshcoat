import {
	IconCheck16,
	IconChevronDown16,
	IconChevronRight16,
} from "@create-figma-plugin/ui";
import type { ComponentChildren, JSX } from "preact";
import { IconSlot } from "~/ui/components";
import { Stack } from "~/ui/layout";

/** One step of the Export sequence. The header is a disclosure button: a
 *  number (a check once done), the title, and when closed, a one-line summary
 *  of what the step holds or still needs, beside the title so a closed step
 *  is one 32 px row. */
export function Step(props: {
	n: number;
	title: string;
	summary: string;
	done: boolean;
	open: boolean;
	/** Omitted for a step that is always there. */
	onToggle?: () => void;
	children?: ComponentChildren;
}): JSX.Element {
	const bodyId = `step-${props.n}-body`;
	const summaryId = `step-${props.n}-summary`;
	const marker = (
		<span
			aria-hidden="true"
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: "16px",
				height: "16px",
				flexShrink: 0,
				borderRadius: "8px",
				fontSize: "10px",
				fontWeight: 600,
				color: props.done
					? "var(--figma-color-text-onbrand)"
					: "var(--figma-color-text-secondary)",
				background: props.done
					? "var(--figma-color-bg-brand)"
					: "var(--figma-color-bg-secondary)",
			}}
		>
			{props.done ? <IconCheck16 color="onbrand" /> : props.n}
		</span>
	);
	const showSummary = !props.open && props.summary !== "";
	const heading = (
		<span
			style={{
				display: "flex",
				alignItems: "baseline",
				gap: "8px",
				flex: 1,
				minWidth: 0,
				lineHeight: "16px",
			}}
		>
			<span style={{ flexShrink: 0, fontWeight: 600 }}>{props.title}</span>
			{showSummary ? (
				<span
					id={summaryId}
					title={props.summary}
					style={{
						flex: 1,
						minWidth: 0,
						color: "var(--figma-color-text-secondary)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{props.summary}
				</span>
			) : null}
		</span>
	);
	return (
		<section
			aria-label={props.title}
			style={{
				borderBottom: props.onToggle
					? "1px solid var(--figma-color-border)"
					: undefined,
			}}
		>
			{props.onToggle ? (
				<h3 style={{ margin: 0, fontSize: "inherit", fontWeight: "inherit" }}>
					<button
						type="button"
						class="fc-step-header"
						aria-expanded={props.open}
						aria-controls={bodyId}
						aria-label={`${props.title}${props.done ? ", done" : ""}`}
						aria-describedby={showSummary ? summaryId : undefined}
						onClick={props.onToggle}
					>
						{marker}
						{heading}
						<IconSlot>
							{props.open ? <IconChevronDown16 /> : <IconChevronRight16 />}
						</IconSlot>
					</button>
				</h3>
			) : (
				<h3
					class="fc-step-header"
					style={{ margin: 0, fontSize: "inherit", cursor: "default" }}
				>
					{marker}
					{heading}
				</h3>
			)}
			{props.open ? (
				<div id={bodyId} style={{ padding: "4px 0 12px 24px" }}>
					<Stack gap="small">{props.children}</Stack>
				</div>
			) : null}
		</section>
	);
}
