import {
	COAT_EXTENSION,
	COAT_MEDIA_TYPE,
	packTemplate,
} from "@freshcoat-js/coatfile/coat";
import { sha256 } from "js-sha256";
import { useRef, useState } from "preact/hooks";
import type { NodeTrace } from "~/lib/figma/transpiler";
import {
	type SizeIssue,
	SizeMismatchError,
} from "~/lib/figma/transpiler/exact-size";
import { type FigmaNode, isContainerNode } from "~/lib/figma/types";
import { checkFreshcoatAddress, openInFreshcoat } from "~/lib/handoff";
import type { ReadDocumentMessage, TemplateMode } from "~/shared/protocol";
import { plural } from "~/ui/copy";
import { buildDiagnostics, type Diagnostics } from "~/ui/diagnostics";
import { download } from "~/ui/download";
import type { ExportTarget } from "~/ui/export-target";
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
import type { Issue } from "~/ui/warnings";

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
export type Action = "download" | "open";

export type Phase =
	| { kind: "idle" }
	| { kind: "working"; action: Action; text: string; progress?: number }
	| { kind: "failed"; text: string }
	/** The export stopped before saving. `canProceed`: every issue is a
	 *  placeholder the author may accept by exporting anyway. */
	| { kind: "blocked"; issues: Issue[]; canProceed: boolean };

export type Result = {
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

export type ExportOptions = {
	target: ExportTarget;
	freshcoatUrl: string;
	showDiagnostics: boolean;
	onOpenSettings: () => void;
	/** Open one step, or `null` to collapse them all. */
	onOpenStep: (n: number | null) => void;
};

/** The export's state machine: reads the frames, builds and packs the
 *  template, and downloads it or hands it to Freshcoat. */
export function useExport(opts: ExportOptions) {
	const announce = useAnnounce();
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [result, setResult] = useState<Result | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [sizeIssues, setSizeIssues] = useState<SizeIssue[]>([]);

	// Snapshots taken at the click and consumed when the read returns.
	const pendingMetaRef = useRef<ExportMetadata | null>(null);
	const actionRef = useRef<Action>("download");
	// The read a blocked export came from, so "Export anyway" needs no new one.
	const lastReadRef = useRef<ReadDocumentMessage | null>(null);
	// The latest options for the read handler, which outlives many renders.
	const liveRef = useRef(opts);
	liveRef.current = opts;

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
			liveRef.current.onOpenStep(null);
			if (action === "download")
				announce(`Exported ${fileName}`, "success", QUIET);
			else await handOff(next);
		} catch (err) {
			if (err instanceof SizeMismatchError) {
				setSizeIssues(err.issues);
				setPhase({ kind: "idle" });
				liveRef.current.onOpenStep(2);
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

	function start(action: Action, metadata: ExportMetadata): void {
		const { target } = opts;
		const { product, daviMode } = target;
		if (!product || !target.targetId) return;
		if (action === "open") {
			const address = opts.freshcoatUrl.trim();
			if (!address) {
				opts.onOpenSettings();
				announce("Set the Freshcoat address first", "info");
				return;
			}
			const check = checkFreshcoatAddress(address);
			if (!check.ok) {
				opts.onOpenSettings();
				announce(check.reason, "error");
				return;
			}
		}
		pendingMetaRef.current = metadata;
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

	function exportAnyway(): void {
		if (lastReadRef.current) void handleRead(lastReadRef.current, true);
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

	return {
		phase,
		result,
		sizeIssues,
		detailsOpen,
		toggleDetails: () => setDetailsOpen((o) => !o),
		start,
		exportAnyway,
		handOff,
		downloadResult,
		downloadDiagnostics,
		resize,
	};
}
