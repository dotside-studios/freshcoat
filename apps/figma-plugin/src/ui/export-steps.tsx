import {
	Banner,
	Button,
	Dropdown,
	type DropdownOption,
	IconWarningSmall24,
	SegmentedControl,
	Textbox,
} from "@create-figma-plugin/ui";
import { COAT_EXTENSION } from "@freshcoat-js/coatfile/coat";
import type { JSX } from "preact";
import type { ProductRegistryEntry } from "~/lib/figma/transpiler";
import type { SizeIssue } from "~/lib/figma/transpiler/exact-size";
import { slug } from "~/lib/slug";
import type { FieldOverviewItem, PluginSettings } from "~/shared/protocol";
import { Hint, ProgressBar } from "~/ui/components";
import { plural } from "~/ui/copy";
import { FrameRow, ResultCard } from "~/ui/export-parts";
import type { ExportTarget } from "~/ui/export-target";
import type { FieldDetector } from "~/ui/fields-tab";
import { Field, FieldGroup, Indented, Row, Stack } from "~/ui/layout";
import { postToMain } from "~/ui/post";
import { Step } from "~/ui/steps";
import type { Phase, Result } from "~/ui/use-export";
import { WarningList } from "~/ui/warnings";

type StepState = {
	done: boolean;
	open: boolean;
	onToggle: () => void;
	onNext: () => void;
};

const focus = (nodeId: string) => () =>
	postToMain({ type: "focus-node", nodeId });

export function StepCanvas(
	props: StepState & {
		target: ExportTarget;
		products: ProductRegistryEntry[];
		productSku: string;
		onPersist: (patch: Partial<PluginSettings>) => void;
	},
): JSX.Element {
	const { target, products, productSku, onPersist } = props;
	const { daviMode, node, product } = target;

	const canvasSummary = daviMode
		? `Davi card product · ${product?.displayName ?? "no product"}`
		: node
			? `Custom · ${node.width}×${node.height}`
			: "Custom";

	const productOptions: DropdownOption[] = products.map((p) => ({
		value: p.sku,
		text: p.displayName,
	}));

	return (
		<Step
			n={1}
			title="Canvas"
			summary={canvasSummary}
			done={props.done}
			open={props.open}
			onToggle={props.onToggle}
		>
			<SegmentedControl
				options={[
					{ value: "custom", children: "Custom" },
					{ value: "davi", children: "Davi card product" },
				]}
				value={daviMode ? "davi" : "custom"}
				onValueChange={(v) => onPersist({ daviMode: v === "davi" })}
			/>
			{daviMode ? (
				<Stack gap="extraSmall">
					<FieldGroup label="Product" inline>
						<Dropdown
							options={productOptions}
							value={productSku || null}
							onValueChange={(v) => onPersist({ productSku: v })}
						/>
					</FieldGroup>
					<Hint>
						{product
							? `Printed at ${product.width}×${product.height}. Every side must match.`
							: "Pick the product it prints on"}
					</Hint>
				</Stack>
			) : (
				<Hint>Sized from the frame, for Freshcoat and coatfile</Hint>
			)}
			<div>
				<Button secondary onClick={props.onNext}>
					Continue
				</Button>
			</div>
		</Step>
	);
}

export function StepFrames(
	props: StepState & {
		target: ExportTarget;
		thumbnails: Record<string, string | undefined>;
		sizeIssues: SizeIssue[];
		onResize: (issue: SizeIssue) => void;
	},
): JSX.Element {
	const { target, thumbnails, sizeIssues, onResize: resize } = props;
	const { daviMode, card, node, product } = target;

	const candidates = daviMode ? target.cards : target.nodes;
	const pickedName = daviMode ? card?.name : node?.name;
	const selectedId = daviMode ? target.selectedCardId : target.selectedNodeId;
	const pickedId = daviMode ? target.cardId : target.nodeId;
	const colorways = target.colorwaySource?.colorways ?? [];
	const missingSides =
		daviMode && card && product
			? product.frames.filter(
					(f) => !card.sides.find((s) => s.side === f.name)?.nodeId,
				)
			: [];

	const framesSummary =
		sizeIssues.length > 0
			? sizeIssues.length === 1
				? "A frame is the wrong size"
				: `${plural(sizeIssues.length, "frame")} are the wrong size`
			: !pickedName
				? daviMode
					? "Pick a card"
					: "Pick a frame"
				: missingSides.length > 0
					? `${pickedName} · missing ${missingSides.map((s) => s.label).join(", ")}`
					: [
							pickedName,
							daviMode && product
								? plural(product.frames.length, "side")
								: null,
							colorways.length > 0
								? plural(colorways.length, "colorway")
								: null,
						]
							.filter(Boolean)
							.join(" · ");

	// A frame of the wrong size says so in its own row, with its Resize, so
	// the step lists each frame once. One the rows do not show (another
	// side's instance, say) gets a row of its own after them.
	const issueFor = (nodeId: string): SizeIssue | undefined =>
		sizeIssues.find((i) => i.nodeId === nodeId);
	const shownIds = new Set<string>([
		...(daviMode
			? (card?.sides ?? []).flatMap((s) => (s.nodeId ? [s.nodeId] : []))
			: node
				? [node.id]
				: []),
		...colorways.map((cw) => cw.instanceId),
	]);
	const strayIssues = sizeIssues.filter((i) => !shownIds.has(i.nodeId));

	return (
		<Step
			n={2}
			title="Frames"
			summary={framesSummary}
			done={props.done && sizeIssues.length === 0}
			open={props.open}
			onToggle={props.onToggle}
		>
			<FieldGroup label={daviMode ? "Card" : "Frame"} inline>
				<Dropdown
					options={candidates.map((c) => ({
						value: c.id,
						text: "width" in c ? `${c.name} · ${c.width}×${c.height}` : c.name,
					}))}
					value={pickedId || null}
					onValueChange={daviMode ? target.setCardId : target.setNodeId}
					disabled={candidates.length === 0}
					placeholder={daviMode ? "Select a card" : "Select a frame"}
				/>
			</FieldGroup>
			{candidates.length === 0 ? (
				<Hint>
					{daviMode
						? `No cards on ${target.pageName || "this page"}`
						: `No frames on ${target.pageName || "this page"}`}
				</Hint>
			) : null}
			{selectedId && selectedId !== pickedId ? (
				<div>
					<Button
						secondary
						onClick={() =>
							daviMode
								? target.setCardId(selectedId)
								: target.setNodeId(selectedId)
						}
					>
						Use selection
					</Button>
				</div>
			) : null}
			{!daviMode && node ? (
				<FrameRow
					src={thumbnails[node.id]}
					alt={`${node.name} preview`}
					onFocus={focus(node.id)}
					title={node.name}
					meta={`${node.width}×${node.height} · side “${target.customFrameName}”`}
					issue={issueFor(node.id)}
					onResize={resize}
				/>
			) : null}
			{daviMode && card && product ? (
				<Stack gap="small">
					{product.frames.map((slot) => {
						const side = card.sides.find((s) => s.side === slot.name);
						const sideNodeId = side?.nodeId ?? null;
						return (
							<FrameRow
								key={slot.name}
								src={sideNodeId ? thumbnails[sideNodeId] : undefined}
								alt={`${slot.label} preview`}
								onFocus={sideNodeId ? focus(sideNodeId) : undefined}
								title={slot.label}
								meta={
									sideNodeId
										? (side?.nodeName ?? "")
										: `No layer named “${slot.name}”`
								}
								issue={sideNodeId ? issueFor(sideNodeId) : undefined}
								onResize={resize}
							/>
						);
					})}
				</Stack>
			) : null}
			{target.colorwaySource?.canHaveColorways ? (
				<FieldGroup label={`Colorways (${colorways.length})`}>
					{colorways.length > 0 ? (
						<Stack gap="small">
							{colorways.map((cw) => (
								<FrameRow
									key={cw.instanceId}
									src={thumbnails[cw.instanceId]}
									alt={`${cw.label} preview`}
									onFocus={focus(cw.instanceId)}
									title={cw.label}
									issue={issueFor(cw.instanceId)}
									onResize={resize}
								/>
							))}
						</Stack>
					) : (
						<Hint>No colorways</Hint>
					)}
					{target.colorwaySource.unmatchedInstances > 0 ? (
						<Hint>
							{plural(target.colorwaySource.unmatchedInstances, "instance")}{" "}
							left out. Name them “{target.colorwaySource.name} / Label”.
						</Hint>
					) : null}
				</FieldGroup>
			) : null}
			{sizeIssues.length > 0 ? (
				<Hint>
					{daviMode
						? "The product prints at an exact size"
						: "Every side shares one canvas"}
				</Hint>
			) : null}
			{strayIssues.length > 0 ? (
				<Stack gap="small">
					{strayIssues.map((issue) => (
						<FrameRow
							key={issue.nodeId}
							src={thumbnails[issue.nodeId]}
							alt={`${issue.nodeName} preview`}
							onFocus={focus(issue.nodeId)}
							title={issue.nodeName}
							issue={issue}
							onResize={resize}
						/>
					))}
				</Stack>
			) : null}
			<div>
				<Button secondary onClick={props.onNext} disabled={!props.done}>
					Continue
				</Button>
			</div>
		</Step>
	);
}

export function StepDetails(
	props: StepState & {
		daviMode: boolean;
		name: string;
		onName: (v: string) => void;
		description: string;
		onDescription: (v: string) => void;
		mood: string;
		onMood: (v: string) => void;
		fields: FieldOverviewItem[];
		detector: FieldDetector;
	},
): JSX.Element {
	const { daviMode, name, fields, detector } = props;

	const detailsSummary =
		name.trim() !== ""
			? `${name.trim()} · ${plural(fields.length, "field")}`
			: "Name the template";

	return (
		<Step
			n={3}
			title="Details"
			summary={detailsSummary}
			done={props.done}
			open={props.open}
			onToggle={props.onToggle}
		>
			<Field label="Name" inline>
				<Textbox
					value={name}
					onValueInput={props.onName}
					placeholder="Aurora member card"
				/>
			</Field>
			<Field label="Description" inline>
				<Textbox
					value={props.description}
					onValueInput={props.onDescription}
					placeholder="Optional"
				/>
			</Field>
			{daviMode ? (
				<Field label="Mood" inline>
					<Textbox
						value={props.mood}
						onValueInput={props.onMood}
						placeholder="Optional: minimal, warm"
					/>
				</Field>
			) : null}
			<Indented>
				<Row gap="extraSmall">
					<span style={{ lineHeight: "16px" }}>
						{plural(fields.length, "field")} ·
					</span>
					<button
						type="button"
						class="fc-link"
						style={{ lineHeight: "16px" }}
						onClick={detector.detect}
						disabled={!detector.ready || detector.detecting}
					>
						{detector.detecting ? "Detecting…" : "Detect fields"}
					</button>
				</Row>
			</Indented>
			<div>
				<Button secondary onClick={props.onNext} disabled={!props.done}>
					Continue
				</Button>
			</div>
		</Step>
	);
}

export function StepExport(props: {
	phase: Phase;
	result: Result | null;
	/** What still stands between the author and an export, if anything. */
	missing: string | null;
	product: ProductRegistryEntry | undefined;
	name: string;
	detailsOpen: boolean;
	onToggleDetails: () => void;
	onExportAnyway: () => void;
	onDownload: () => void;
	onOpen: (r: Result) => void;
	onDiagnostics: () => void;
}): JSX.Element {
	const { phase, result, product } = props;

	const blocked = phase.kind === "blocked" ? phase : null;
	const showResult =
		result !== null && phase.kind !== "blocked" && phase.kind !== "failed";
	const exportBody =
		phase.kind === "working" ||
		phase.kind === "failed" ||
		blocked !== null ||
		showResult;
	const exportSummary =
		props.missing ??
		(product
			? `${product.sku}-${slug(props.name.trim(), { fallback: "card" })}${COAT_EXTENSION}`
			: "");

	return (
		<Step
			n={4}
			title="Export"
			summary={exportSummary}
			done={false}
			open={exportBody}
		>
			{phase.kind === "working" ? (
				<Stack gap="extraSmall">
					<ProgressBar value={phase.progress} label={phase.text} />
					<Hint truncate>{phase.text}</Hint>
				</Stack>
			) : null}
			{phase.kind === "failed" ? (
				<Banner icon={<IconWarningSmall24 />} variant="warning">
					Couldn't export. {phase.text}
				</Banner>
			) : null}
			{blocked ? (
				<Stack gap="small">
					<Banner icon={<IconWarningSmall24 />} variant="warning">
						{blocked.canProceed
							? `${plural(blocked.issues.length, "layer")} will export as a placeholder`
							: "Couldn't export. The template isn't valid."}
					</Banner>
					<WarningList issues={blocked.issues} />
					{blocked.canProceed ? (
						<div>
							<Button secondary onClick={props.onExportAnyway}>
								Export anyway
							</Button>
						</div>
					) : null}
				</Stack>
			) : null}
			{showResult && result ? (
				<ResultCard
					result={result}
					detailsOpen={props.detailsOpen}
					onToggleDetails={props.onToggleDetails}
					onDownload={props.onDownload}
					onOpen={() => props.onOpen(result)}
					onDiagnostics={props.onDiagnostics}
					busy={phase.kind === "working"}
				/>
			) : null}
			{result && phase.kind === "idle" ? (
				<WarningList issues={result.issues} />
			) : null}
		</Step>
	);
}
