import {
	Bold,
	Code,
	IconInfo16,
	IconWarning16,
	Text,
} from "@create-figma-plugin/ui";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { IconSlot } from "~/ui/components";
import { plural } from "~/ui/copy";
import { Stack } from "~/ui/layout";
import { postToMain } from "~/ui/post";

export type Severity = "error" | "warn" | "info";

/** One line in the list: a transpiler warning, or a validation error, with
 *  the layer it is about when there is one. */
export type Issue = {
	severity: Severity;
	code: string;
	message: string;
	nodeId?: string;
	slot?: string;
	layerName?: string;
};

function ErrorIcon(): JSX.Element {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
			<circle
				cx="8"
				cy="8"
				r="6"
				fill="none"
				stroke="currentColor"
				stroke-width="1.2"
			/>
			<path
				d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"
				stroke="currentColor"
				stroke-width="1.2"
			/>
		</svg>
	);
}

// Each severity has its own shape and its own word, and color only on top of
// those, so the list reads the same without color.
const GROUPS: Array<{
	severity: Severity;
	one: string;
	many: string;
	icon: () => JSX.Element;
	color: string;
}> = [
	{
		severity: "error",
		one: "error",
		many: "errors",
		icon: ErrorIcon,
		color: "var(--figma-color-icon-danger)",
	},
	{
		severity: "warn",
		one: "warning",
		many: "warnings",
		icon: () => <IconWarning16 />,
		color: "var(--figma-color-icon-warning)",
	},
	{
		severity: "info",
		one: "note",
		many: "notes",
		icon: () => <IconInfo16 />,
		color: "var(--figma-color-icon-secondary)",
	},
];

export function issueKey(i: Issue): string {
	return `${i.severity}:${i.code}:${i.nodeId ?? ""}:${i.slot ?? ""}:${i.message}`;
}

export function WarningList(props: { issues: Issue[] }): JSX.Element | null {
	const [showCodes, setShowCodes] = useState(false);
	if (props.issues.length === 0) return null;
	return (
		<Stack gap="small">
			{GROUPS.map((g) => {
				const items = props.issues.filter((i) => i.severity === g.severity);
				if (items.length === 0) return null;
				const Icon = g.icon;
				const heading = plural(items.length, g.one, g.many);
				return (
					<section key={g.severity} aria-label={heading}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "4px",
								marginBottom: "2px",
							}}
						>
							<IconSlot>
								<span style={{ color: g.color, display: "flex" }}>
									<Icon />
								</span>
							</IconSlot>
							<Text>
								<Bold>
									{heading.charAt(0).toUpperCase() + heading.slice(1)}
								</Bold>
							</Text>
						</div>
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{items.map((i) => (
								<li key={issueKey(i)}>
									<IssueRow issue={i} showCode={showCodes} />
								</li>
							))}
						</ul>
					</section>
				);
			})}
			<div>
				<button
					type="button"
					class="fc-link"
					aria-pressed={showCodes}
					onClick={() => setShowCodes((v) => !v)}
					style={{ minHeight: "24px" }}
				>
					{showCodes ? "Hide codes" : "Show codes"}
				</button>
			</div>
		</Stack>
	);
}

function IssueRow(props: { issue: Issue; showCode: boolean }): JSX.Element {
	const { issue } = props;
	const where = [issue.layerName, issue.slot].filter(Boolean).join(" · ");
	const body = (
		<span style={{ display: "block", minWidth: 0 }}>
			<span style={{ display: "block", lineHeight: "16px" }}>
				{issue.message}
			</span>
			{where || props.showCode ? (
				<span
					style={{
						display: "block",
						lineHeight: "16px",
						color: "var(--figma-color-text-secondary)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{where}
					{where && props.showCode ? " · " : ""}
					{props.showCode ? <Code>{issue.code}</Code> : null}
				</span>
			) : null}
		</span>
	);
	const nodeId = issue.nodeId;
	if (!nodeId) {
		return (
			<div
				style={{
					padding: "4px 8px 4px 20px",
					fontSize: "11px",
				}}
			>
				{body}
			</div>
		);
	}
	return (
		<button
			type="button"
			class="fc-row"
			title="Select on canvas"
			onClick={() => postToMain({ type: "focus-node", nodeId })}
			style={{ padding: "4px 8px 4px 20px", alignItems: "flex-start" }}
		>
			{body}
		</button>
	);
}
