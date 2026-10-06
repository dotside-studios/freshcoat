import {
	Banner,
	Button,
	Disclosure,
	Dropdown,
	type DropdownOption,
	IconApprovedCheckmark16,
	IconWarning16,
	IconWarningSmall24,
	SegmentedControl,
	Textbox,
} from "@create-figma-plugin/ui";
import {
	COAT_EXTENSION,
	COAT_MEDIA_TYPE,
	packTemplate,
} from "@freshcoat-js/coatfile/coat";
// js-sha256 because crypto.subtle is unavailable in the plugin iframe (non-secure context).
import { sha256 } from "js-sha256";
import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { NodeTrace, ProductRegistryEntry } from "~/lib/figma/transpiler";
import {
	type SizeIssue,
	SizeMismatchError,
} from "~/lib/figma/transpiler/exact-size";
import { type FigmaNode, isContainerNode } from "~/lib/figma/types";
import { checkFreshcoatAddress, openInFreshcoat } from "~/lib/handoff";
import type {
	FieldOverviewItem,
	PluginSettings,
	ReadDocumentMessage,
	TemplateMode,
} from "~/shared/protocol";
import {
	Card,
	Hint,
	IconSlot,
	JumpButton,
	Lines,
	OpenInFreshcoatLabel,
	ProgressBar,
} from "~/ui/components";
import { formatBytes, plural } from "~/ui/copy";
import { buildDiagnostics, type Diagnostics } from "~/ui/diagnostics";
import { download } from "~/ui/download";
import type { ExportTarget } from "~/ui/export-target";
import type { FieldDetector } from "~/ui/fields-tab";
import {
	Field,
	FieldGroup,
	Fill,
	Indented,
	Panel,
	Row,
	Stack,
	Thumbnail,
	Truncate,
	Wrap,
} from "~/ui/layout";
import { useMainMessage } from "~/ui/messages";
import { postToMain } from "~/ui/post";
import {
	ExportBlockedError,
	type ExportedTemplate,
	type ExportMetadata,
	runTranspileToTemplate,
	slugify,
} from "~/ui/run-transpile";
import { useAnnounce } from "~/ui/status";
import { Step } from "~/ui/steps";
import { useThumbnails } from "~/ui/use-thumbnails";
import { type Issue, WarningList } from "~/ui/warnings";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	return sha256(bytes);
}

function pack(template: ExportedTemplate): Promise<Uint8Array> {
	return packTemplate(template, { sha256: sha256Hex });
}

function coatBlob(bytes: Uint8Array): Blob {
	return new Blob([bytes as Uint8Array<ArrayBuffer>], {
		type: COAT_MEDIA_TYPE,
	});
}

/** What the export button pressed: a download, or a hand-off to Freshcoat. */
type Action = "download" | "open";

type Phase =
	| { kind: "idle" }
	| { kind: "working"; action: Action; text: string; progress?: number }
	| { kind: "failed"; text: string }
	/** The export stopped before saving. `canProceed`: every issue is a
	 *  placeholder the author may accept by exporting anyway. */
	| { kind: "blocked"; issues: Issue[]; canProceed: boolean };

type Result = {
	template: ExportedTemplate;
	fileName: string;
	/** Packed on first need and kept, so "Download again" is instant. */
	packed: Uint8Array | null;
	downloaded: boolean;
	mode: TemplateMode;
	sides: number;
	fields: number;
	counts: { native: number; flattened: number; skipped: number };
	/** Prepared with the export and downloaded on request: a plugin's UI is a
	 *  sandboxed iframe, where a second download in the same task is dropped. */
	diagnostics: Diagnostics;
	/** Layers that did not come through as authored. */
	decisions: NodeTrace[];
	issues: Issue[];
	/** A hand-off that fell back to a file says so here until the next one. */
	note?: string;
};

// The export's progress and outcome show in step 4 itself (the bar, the
// banner, the result card, the rows of wrong-size frames), so the status line
// reads them out without drawing them a second time under the footer.
const QUIET = { quiet: true };

// Main reports rasterizing as "Rasterizing layer 3 of 12…". The counts are what
// makes the bar determinate.
const COUNT = /(\d+)\s+of\s+(\d+)/;

function progressOf(text: string): number | undefined {
	const m = COUNT.exec(text);
	if (!m) return undefined;
	const total = Number(m[2]);
	return total > 0 ? Number(m[1]) / total : undefined;
}

/** Layer names by node id, from the trees main read. Warnings and
 *  validation errors name a node; the list shows the layer. */
function layerNames(msg: ReadDocumentMessage): Map<string, string> {
	const names = new Map<string, string>();
	const walk = (n: FigmaNode): void => {
		names.set(n.id, n.name);
		if (isContainerNode(n)) for (const c of n.children ?? []) walk(c);
	};
	for (const s of msg.slots) walk(s.tree);
	for (const cw of msg.colorways) {
		for (const tree of Object.values(cw.perSide)) walk(tree);
	}
	return names;
}

function withLayer(
	w: Omit<Issue, "layerName">,
	names: Map<string, string>,
): Issue {
	const layerName = w.nodeId ? names.get(w.nodeId) : undefined;
	return layerName ? { ...w, layerName } : w;
}

export function ExportTab(props: {
	target: ExportTarget;
	products: ProductRegistryEntry[];
	/** Ask the shell to load the live product catalog. Called only once the
	 *  author opts into a Davi export. */
	onNeedProducts: () => void;
	productSku: string;
	/** False until main's stored settings arrive; nothing is written back
	 *  before then, or a default would overwrite the stored choice. */
	settingsLoaded: boolean;
	onPersist: (patch: Partial<PluginSettings>) => void;
	fields: FieldOverviewItem[];
	detector: FieldDetector;
	freshcoatUrl: string;
	showDiagnostics: boolean;
	onOpenSettings: () => void;
}): JSX.Element {
	const {
		target,
		products,
		onNeedProducts,
		productSku,
		settingsLoaded,
		onPersist,
		fields,
		detector,
	} = props;
	const { daviMode, card, node, product } = target;
	const announce = useAnnounce();

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [mood, setMood] = useState("");
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [result, setResult] = useState<Result | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [sizeIssues, setSizeIssues] = useState<SizeIssue[]>([]);
	// undefined: follow progress (the first unfinished step is open). A click
	// on a header takes over from there.
	const [openStep, setOpenStep] = useState<number | null | undefined>(
		undefined,
	);

	// Snapshots taken at the click and consumed when the read returns.
	const pendingMetaRef = useRef<ExportMetadata | null>(null);
	const actionRef = useRef<Action>("download");
	// The read a blocked export came from, so "Export anyway" needs no new one.
	const lastReadRef = useRef<ReadDocumentMessage | null>(null);
	// Set once the author types a name, which stops the prefill from the frame.
	const nameEditedRef = useRef(false);
	// The latest props for the read handler, which outlives many renders.
	const liveRef = useRef(props);
	liveRef.current = props;

	const working = phase.kind === "working";

	// Previews for exactly what is on screen: the picked frame or its sides,
	// colorway instances, and frames that need resizing.
	const thumbnailIds = useMemo(() => {
		const ids = daviMode
			? (card?.sides ?? []).map((s) => s.nodeId).filter((id) => id !== null)
			: node
				? [node.id]
				: [];
		return [
			...ids,
			...(target.colorwaySource?.colorways ?? []).map((cw) => cw.instanceId),
			...sizeIssues.map((i) => i.nodeId),
		];
	}, [daviMode, card, node, target.colorwaySource, sizeIssues]);
	const thumbnails = useThumbnails(thumbnailIds);

	// Prefill the name from the picked frame's name until the author edits it.
	useEffect(() => {
		if (nameEditedRef.current) return;
		const picked = daviMode ? card : node;
		if (picked) setName(picked.name);
	}, [daviMode, card, node]);

	useEffect(() => {
		if (settingsLoaded && daviMode) onNeedProducts();
	}, [settingsLoaded, daviMode, onNeedProducts]);

	// The catalog lands asynchronously, so seed an empty product pick from it.
	useEffect(() => {
		if (settingsLoaded && !productSku && products[0])
			onPersist({ productSku: products[0].sku });
	}, [settingsLoaded, products, productSku, onPersist]);

	async function handOff(r: Result): Promise<void> {
		const live = liveRef.current;
		const outcome = await openInFreshcoat(
			r.template,
			{ address: live.freshcoatUrl, fileName: r.fileName },
			{ post: postToMain, download },
		);
		if (outcome.kind === "no-address") {
			live.onOpenSettings();
			announce("Set the Freshcoat address first", "info");
		} else if (outcome.kind === "bad-address") {
			live.onOpenSettings();
			announce(outcome.reason, "error");
		} else if (outcome.kind === "link") {
			setResult((prev) => (prev ? { ...prev, note: undefined } : prev));
			announce("Opened in Freshcoat", "success");
		} else {
			setResult((prev) =>
				prev ? { ...prev, downloaded: true, note: outcome.message } : prev,
			);
			announce(outcome.message, "info", QUIET);
		}
	}

	async function handleRead(
		msg: ReadDocumentMessage,
		proceed = false,
	): Promise<void> {
		const action = actionRef.current;
		lastReadRef.current = msg;
		setPhase({ kind: "working", action, text: "Building template…" });
		announce("Building template…", "working", QUIET);
		const names = layerNames(msg);
		try {
			const metadata = pendingMetaRef.current ?? { name: "Untitled" };
			const { template, trace } = await runTranspileToTemplate(
				msg,
				sha256Hex,
				metadata,
				{ proceed },
			);
			const stem = `${msg.product.sku}-${slugify(metadata.name) || "card"}`;
			const fileName = `${stem}${COAT_EXTENSION}`;
			let packed: Uint8Array | null = null;
			if (action === "download") {
				packed = await pack(template);
				download(fileName, coatBlob(packed));
			}
			const counts = template.source.report.counts;
			const next: Result = {
				template,
				fileName,
				packed,
				downloaded: action === "download",
				mode: msg.mode,
				sides: template.template_data.length,
				fields: Object.keys(template.fields.properties ?? {}).length,
				counts,
				diagnostics: buildDiagnostics({
					msg,
					trace,
					template: {
						id: template.id,
						name: template.name,
						width: template.width,
						height: template.height,
					},
					counts,
					exportedAt: template.source.importedAt,
				}),
				decisions: trace.filter(
					(t) => t.decision === "flatten" || t.decision === "skip",
				),
				issues: (template.warnings ?? []).map((w) => withLayer(w, names)),
			};
			setResult(next);
			setDetailsOpen(liveRef.current.showDiagnostics);
			setSizeIssues([]);
			setPhase({ kind: "idle" });
			setOpenStep(null);
			if (action === "download")
				announce(`Exported ${fileName}`, "success", QUIET);
			else await handOff(next);
		} catch (err) {
			if (err instanceof SizeMismatchError) {
				setSizeIssues(err.issues);
				setPhase({ kind: "idle" });
				setOpenStep(2);
				const n = err.issues.length;
				announce(
					n === 1
						? "A frame is the wrong size"
						: `${plural(n, "frame")} are the wrong size`,
					"error",
					QUIET,
				);
				return;
			}
			if (err instanceof ExportBlockedError) {
				setPhase({
					kind: "blocked",
					issues: err.issues.map((i) => withLayer(i, names)),
					canProceed: err.canProceed,
				});
				announce(
					err.canProceed
						? "Some layers will export as placeholders"
						: "Couldn't export. The template isn't valid.",
					"error",
					QUIET,
				);
				return;
			}
			const text = (err as Error)?.message ?? String(err);
			setPhase({ kind: "failed", text });
			announce("Couldn't export", "error", QUIET);
		}
	}

	useMainMessage((msg) => {
		if (msg.type === "read-document") {
			void handleRead(msg);
		} else if (msg.type === "read-progress") {
			// Only while a read is in flight; a late one must not bring the bar
			// back over a finished export.
			setPhase((prev) =>
				prev.kind === "working"
					? { ...prev, text: msg.text, progress: progressOf(msg.text) }
					: prev,
			);
			announce(msg.text, "working", QUIET);
		} else if (msg.type === "read-failed") {
			setPhase({ kind: "failed", text: msg.message });
			announce("Couldn't read the frames", "error", QUIET);
		}
	});

	// Step completion, in order.
	const nameOk = name.trim() !== "";
	const done: Record<1 | 2 | 3, boolean> = {
		1: !daviMode || !!product,
		2: target.complete,
		3: nameOk,
	};
	const firstOpen = ([1, 2, 3] as const).find((n) => !done[n]) ?? null;
	const current = openStep === undefined ? firstOpen : openStep;
	const toggle = (n: number) => () => setOpenStep(current === n ? null : n);
	const next = (n: number) => () => {
		const after = ([1, 2, 3] as const).find((m) => m > n && !done[m]);
		setOpenStep(after ?? null);
	};
	const ready = done[1] && done[2] && done[3];
	const missing = !done[2]
		? daviMode
			? "Pick a card in step 2"
			: "Pick a frame in step 2"
		: !done[3]
			? "Name the template in step 3"
			: null;

	function start(action: Action): void {
		if (!product || !target.targetId || !ready) return;
		if (action === "open") {
			const address = props.freshcoatUrl.trim();
			if (!address) {
				props.onOpenSettings();
				announce("Set the Freshcoat address first", "info");
				return;
			}
			const check = checkFreshcoatAddress(address);
			if (!check.ok) {
				props.onOpenSettings();
				announce(check.reason, "error");
				return;
			}
		}
		const d = description.trim();
		const m = mood.trim();
		pendingMetaRef.current = {
			name: name.trim(),
			...(d ? { description: d } : {}),
			...(daviMode && m ? { mood: m } : {}),
		};
		actionRef.current = action;
		setPhase({ kind: "working", action, text: "Reading frames…" });
		announce("Reading frames…", "working", QUIET);
		postToMain({
			type: "request-read",
			product,
			mode: daviMode ? "davi" : "custom",
			cardId: target.targetId,
			sideAssignment: target.sideAssignment,
		});
	}

	async function downloadResult(): Promise<void> {
		if (!result) return;
		const packed = result.packed ?? (await pack(result.template));
		download(result.fileName, coatBlob(packed));
		setResult((prev) => (prev ? { ...prev, packed, downloaded: true } : prev));
		announce(`Downloaded ${result.fileName}`, "success");
	}

	function downloadDiagnostics(): void {
		if (!result) return;
		const fileName = `${result.fileName.slice(0, -COAT_EXTENSION.length)}.diagnostics.json`;
		download(
			fileName,
			new Blob([JSON.stringify(result.diagnostics)], {
				type: "application/json",
			}),
		);
		announce(`Downloaded ${fileName}`, "success");
	}

	function resize(issue: SizeIssue): void {
		postToMain({
			type: "resize-node",
			nodeId: issue.nodeId,
			width: issue.expectedWidth,
			height: issue.expectedHeight,
		});
		setSizeIssues((prev) => prev.filter((i) => i.nodeId !== issue.nodeId));
		announce(`Resized ${issue.nodeName}`, "success");
	}

	const focus = (nodeId: string) => () =>
		postToMain({ type: "focus-node", nodeId });

	// ---- Step 1 · Canvas -----------------------------------------------------

	const canvasSummary = daviMode
		? `Davi card product · ${product?.displayName ?? "no product"}`
		: node
			? `Custom · ${node.width}×${node.height}`
			: "Custom";

	const productOptions: DropdownOption[] = products.map((p) => ({
		value: p.sku,
		text: p.displayName,
	}));

	const stepCanvas = (
		<Step
			n={1}
			title="Canvas"
			summary={canvasSummary}
			done={done[1]}
			open={current === 1}
			onToggle={toggle(1)}
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
				<Button secondary onClick={next(1)}>
					Continue
				</Button>
			</div>
		</Step>
	);

	// ---- Step 2 · Frames -----------------------------------------------------

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

	const stepFrames = (
		<Step
			n={2}
			title="Frames"
			summary={framesSummary}
			done={done[2] && sizeIssues.length === 0}
			open={current === 2}
			onToggle={toggle(2)}
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
				<Button secondary onClick={next(2)} disabled={!done[2]}>
					Continue
				</Button>
			</div>
		</Step>
	);

	// ---- Step 3 · Details ----------------------------------------------------

	const detailsSummary = nameOk
		? `${name.trim()} · ${plural(fields.length, "field")}`
		: "Name the template";

	const stepDetails = (
		<Step
			n={3}
			title="Details"
			summary={detailsSummary}
			done={done[3]}
			open={current === 3}
			onToggle={toggle(3)}
		>
			<Field label="Name" inline>
				<Textbox
					value={name}
					onValueInput={(v) => {
						nameEditedRef.current = true;
						setName(v);
					}}
					placeholder="Aurora member card"
				/>
			</Field>
			<Field label="Description" inline>
				<Textbox
					value={description}
					onValueInput={setDescription}
					placeholder="Optional"
				/>
			</Field>
			{daviMode ? (
				<Field label="Mood" inline>
					<Textbox
						value={mood}
						onValueInput={setMood}
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
				<Button secondary onClick={next(3)} disabled={!done[3]}>
					Continue
				</Button>
			</div>
		</Step>
	);

	// ---- Step 4 · Export -----------------------------------------------------

	const blocked = phase.kind === "blocked" ? phase : null;
	const showResult =
		result !== null && phase.kind !== "blocked" && phase.kind !== "failed";
	const exportBody =
		phase.kind === "working" ||
		phase.kind === "failed" ||
		blocked !== null ||
		showResult;
	const exportSummary =
		missing ??
		(product
			? `${product.sku}-${slugify(name.trim()) || "card"}${COAT_EXTENSION}`
			: "");

	const stepExport = (
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
							<Button
								secondary
								onClick={() => {
									if (lastReadRef.current)
										void handleRead(lastReadRef.current, true);
								}}
							>
								Export anyway
							</Button>
						</div>
					) : null}
				</Stack>
			) : null}
			{showResult && result ? (
				<ResultCard
					result={result}
					detailsOpen={detailsOpen}
					onToggleDetails={() => setDetailsOpen((o) => !o)}
					onDownload={() => void downloadResult()}
					onOpen={() => void handOff(result)}
					onDiagnostics={downloadDiagnostics}
					busy={working}
				/>
			) : null}
			{result && phase.kind === "idle" ? (
				<WarningList issues={result.issues} />
			) : null}
		</Step>
	);

	// The two ways out stay pinned under the steps, so however far the result
	// and its warnings scroll, exporting again is where it was.
	const footer = (
		<Row>
			<Fill>
				<Button
					fullWidth
					onClick={() => start("download")}
					disabled={!ready || working}
					loading={working && phase.action === "download"}
				>
					Export .coat
				</Button>
			</Fill>
			<Button
				secondary
				onClick={() => start("open")}
				disabled={!ready || working}
				loading={working && phase.action === "open"}
			>
				<OpenInFreshcoatLabel />
			</Button>
		</Row>
	);

	return (
		<Panel footer={footer}>
			<div style={{ marginTop: "-8px" }}>
				{stepCanvas}
				{stepFrames}
				{stepDetails}
				{stepExport}
			</div>
		</Panel>
	);
}

/** One frame in step 2: its preview, its name and what it is, and when it is
 *  the wrong size, the size it has and needs, with a Resize. */
function FrameRow(props: {
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

function ResultCard(props: {
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
