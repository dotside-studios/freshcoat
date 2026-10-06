import {
	Button,
	Disclosure,
	IconApprovedCheckmark16,
	IconWarning16,
} from "@create-figma-plugin/ui";
import type { JSX } from "preact";
import type { SizeIssue } from "~/lib/figma/transpiler/exact-size";
import {
	Card,
	Hint,
	IconSlot,
	JumpButton,
	Lines,
	OpenInFreshcoatLabel,
} from "~/ui/components";
import { formatBytes, plural } from "~/ui/copy";
import { Fill, Row, Stack, Thumbnail, Truncate, Wrap } from "~/ui/layout";
import { postToMain } from "~/ui/post";
import type { Result } from "~/ui/use-export";

/** One frame in step 2: its preview, its name and what it is, and when it is
 *  the wrong size, the size it has and needs, with a Resize. */
export function FrameRow(props: {
	src?: string;
	alt: string;
	onFocus?: () => void;
	title: string;
	meta?: string;
	issue?: SizeIssue;
	onResize: (issue: SizeIssue) => void;
}): JSX.Element {
	const { issue } = props;
	return (
		<Row>
			<Thumbnail src={props.src} alt={props.alt} onClick={props.onFocus} />
			<Fill>
				{issue ? (
					<span style={{ display: "block", minWidth: 0 }}>
						<Truncate text={props.title} />
						<span
							title="Wrong size"
							style={{
								display: "flex",
								alignItems: "center",
								gap: "4px",
								lineHeight: "16px",
								color: "var(--figma-color-text-danger)",
								whiteSpace: "nowrap",
							}}
						>
							<span
								aria-hidden="true"
								style={{
									display: "flex",
									color: "var(--figma-color-icon-danger)",
								}}
							>
								<IconWarning16 />
							</span>
							<span class="fc-sr">Wrong size: </span>
							{issue.width}×{issue.height} → {issue.expectedWidth}×
							{issue.expectedHeight}
						</span>
					</span>
				) : (
					<Lines title={props.title} meta={props.meta} />
				)}
			</Fill>
			{issue ? (
				<Button secondary onClick={() => props.onResize(issue)}>
					Resize
				</Button>
			) : null}
		</Row>
	);
}

const REASON: Record<string, string> = {
	skip: "skipped",
	flatten: "rasterized",
};

export function ResultCard(props: {
	result: Result;
	detailsOpen: boolean;
	onToggleDetails: () => void;
	onDownload: () => void;
	onOpen: () => void;
	onDiagnostics: () => void;
	busy: boolean;
}): JSX.Element {
	const { result: r } = props;
	const t = r.template;
	const facts = [
		`${t.width}×${t.height}`,
		plural(r.sides, "side"),
		plural(r.fields, "field"),
		r.packed ? formatBytes(r.packed.byteLength) : null,
	]
		.filter(Boolean)
		.join(" · ");
	const shown = r.decisions.slice(0, 20);
	return (
		<Card>
			<Row gap="extraSmall">
				<IconSlot>
					<IconApprovedCheckmark16 color="success" />
				</IconSlot>
				<Fill>
					<Truncate text={t.name} bold />
				</Fill>
			</Row>
			<Hint truncate title={r.fileName}>
				{r.downloaded ? r.fileName : "Not downloaded"}
			</Hint>
			<Hint truncate>{facts}</Hint>
			{r.mode === "davi" ? (
				<Hint>Import it in Davi admin under Templates</Hint>
			) : null}
			{r.note ? <Hint>{r.note}</Hint> : null}
			<div style={{ paddingTop: "4px" }}>
				<Wrap gap="small">
					<Button secondary onClick={props.onDownload} disabled={props.busy}>
						{r.downloaded ? "Download again" : "Download .coat"}
					</Button>
					<Button secondary onClick={props.onOpen} disabled={props.busy}>
						<OpenInFreshcoatLabel />
					</Button>
				</Wrap>
			</div>
			<div style={{ margin: "0 -8px -8px" }}>
				<Disclosure
					open={props.detailsOpen}
					onClick={props.onToggleDetails}
					title="Diagnostics"
				>
					<Stack gap="extraSmall">
						<Hint>
							{r.counts.native} native · {r.counts.flattened} rasterized ·{" "}
							{r.counts.skipped} skipped
						</Hint>
						{shown.map((d) => (
							<JumpButton
								key={d.nodeId}
								onClick={() =>
									postToMain({ type: "focus-node", nodeId: d.nodeId })
								}
							>
								{d.name} · {REASON[d.decision] ?? d.decision}
								{d.reason ? ` (${d.reason.replace(/_/g, " ")})` : ""}
							</JumpButton>
						))}
						{r.decisions.length > shown.length ? (
							<Hint>
								And {plural(r.decisions.length - shown.length, "more")}
							</Hint>
						) : null}
						<div>
							<Button secondary onClick={props.onDiagnostics}>
								Download diagnostics
							</Button>
						</div>
						<Hint>
							The file has the scene as read and every layer's decision
						</Hint>
					</Stack>
				</Disclosure>
			</div>
		</Card>
	);
}
