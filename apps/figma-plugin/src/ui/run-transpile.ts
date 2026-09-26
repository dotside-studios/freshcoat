import {
	FORMAT_VERSION,
	type Template,
	type TemplateWarning,
	type ValidationError,
	validate,
} from "@freshcoat/coatfile";
import { attachAssets } from "@freshcoat/coatfile/assets";
import type { FigmaPick, NodeTrace } from "~/lib/figma/transpiler";
import { transpile } from "~/lib/figma/transpiler";
import {
	BARCODE_INVALID_VALUE,
	BARCODE_UNKNOWN_SYMBOLOGY,
} from "~/lib/figma/transpiler/barcode";
import type { RenderImageFn } from "~/lib/figma/transpiler/rasterize";
import { pngSize } from "~/lib/png";
import type { ReadDocumentMessage } from "~/shared/protocol";
import { type FigmaSource, figmaSource } from "~/shared/source";

export type Sha256Fn = (bytes: Uint8Array) => Promise<string>;

/** Author-supplied template metadata captured from the UI form. */
export type ExportMetadata = {
	name: string;
	description?: string;
	mood?: string;
};

export function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** A template that has been exported but not yet had its rasters uploaded: the
 *  image srcs are `asset:` hashes and the bytes ride along in `assets`. */
export type ExportedTemplate = Template & {
	source: FigmaSource;
};

/** An export plus the transpiler's own account of it. The trace is deliberately
 *  NOT folded into the template — it describes nodes that produced nothing as
 *  well as those that did, which is a debugging record, not part of the product
 *  artifact. */
export type TranspileResult = {
	template: ExportedTemplate;
	trace: NodeTrace[];
};

/** One reason an export was stopped, shaped as a warning so the UI lists it
 *  with them: `severity` is always "error", `nodeId` names the layer to select
 *  where one is known, and `slot` the side. A validation error also carries
 *  the JSON pointer coatfile reported it at. */
export type ExportIssue = TemplateWarning & { path?: string };

/** The export produced something that must not be saved as it stands. Nothing
 *  was downloaded.
 *
 *  `canProceed` is true when every issue is one the author may accept, a
 *  barcode that will export as a placeholder: running the export again with
 *  `{ proceed: true }` then goes ahead, and the issues ride along in the
 *  template's warnings. A template coatfile does not validate can never
 *  proceed. */
export class ExportBlockedError extends Error {
	readonly issues: ExportIssue[];
	readonly canProceed: boolean;

	constructor(issues: ExportIssue[], canProceed: boolean) {
		super(
			canProceed
				? `${issues.length} layer${issues.length === 1 ? "" : "s"} will export as a placeholder`
				: `The template is not valid: ${issues[0]?.message ?? "unknown error"}`,
		);
		this.name = "ExportBlockedError";
		this.issues = issues;
		this.canProceed = canProceed;
	}
}

export type TranspileOptions = {
	/** Export despite issues the author may accept (see ExportBlockedError). */
	proceed?: boolean;
};

// Warnings that stop an export until the author agrees to its placeholder.
const PROCEEDABLE = new Set([BARCODE_UNKNOWN_SYMBOLOGY, BARCODE_INVALID_VALUE]);

// The layer a validation error's path points into: the deepest element on the
// path, looked up by the id it was emitted under, or the side's own frame for
// its background.
function locate(
	template: Template,
	path: string,
	nodeIdOf: (slot: string, elementId: string) => string | undefined,
	slotNodeId: (slot: string) => string | undefined,
): { nodeId?: string; slot?: string } {
	const parts = path.split("/").slice(1);
	if (parts[0] !== "template_data" || parts[1] === undefined) return {};
	const frame = template.template_data[Number(parts[1])];
	if (!frame) return {};
	const slot = frame.name;
	if (parts[2] === "background") {
		const nodeId = slotNodeId(slot);
		return nodeId ? { slot, nodeId } : { slot };
	}
	let node: unknown = frame;
	let found: string | undefined;
	for (const part of parts.slice(2)) {
		if (node === null || typeof node !== "object") break;
		node = (node as Record<string, unknown>)[part];
		const el = node as { id?: unknown; type?: unknown } | undefined;
		if (el && typeof el.id === "string" && typeof el.type === "string") {
			found = nodeIdOf(slot, el.id) ?? found;
		}
	}
	return found ? { slot, nodeId: found } : { slot };
}

function validationIssues(
	template: Template,
	errors: ValidationError[],
	trace: NodeTrace[],
	picks: Record<string, FigmaPick>,
): ExportIssue[] {
	const byElement = new Map<string, string>();
	for (const t of trace) {
		if (t.elementId) byElement.set(`${t.slot}\u0000${t.elementId}`, t.nodeId);
	}
	return errors.map((e) => ({
		severity: "error" as const,
		code: e.code,
		message: e.path ? `${e.message} (at ${e.path})` : e.message,
		...(e.path ? { path: e.path } : {}),
		...locate(
			template,
			e.path,
			(slot, id) => byElement.get(`${slot}\u0000${id}`),
			(slot) => picks[slot]?.nodeId,
		),
	}));
}

/** Build the template for an export and check it.
 *
 *  Throws SizeMismatchError for frames off the canvas, and ExportBlockedError
 *  for a template that must not be saved as it stands: one coatfile does not
 *  validate, or, unless `opts.proceed`, one holding barcode placeholders. */
export async function runTranspileToTemplate(
	msg: ReadDocumentMessage,
	sha256: Sha256Fn,
	metadata: ExportMetadata,
	opts: TranspileOptions = {},
): Promise<TranspileResult> {
	const { product } = msg;

	const bytesById = new Map(
		msg.rasters.map((r) => [r.nodeId, new Uint8Array(r.bytes)]),
	);
	const treeById = new Map(msg.slots.map((s) => [s.nodeId, s.tree]));

	const picks: Record<string, FigmaPick> = {};
	for (const s of msg.slots) {
		picks[s.slot] = {
			fileKey: "figma",
			nodeId: s.nodeId,
			nodeName: s.nodeName,
			width: s.width,
			height: s.height,
		};
	}

	const variants = msg.colorways.map((cw) => ({
		instanceId: cw.instanceId,
		label: cw.label,
		perSide: cw.perSide,
	}));

	const renderImage: RenderImageFn = async (req) => {
		const bytes = bytesById.get(req.nodeIds[0]);
		if (!bytes) throw new Error(`no exported bytes for ${req.nodeIds[0]}`);
		// Read off the PNG header we already hold, so the transpiler can tell an
		// export with content from Figma's 1×1 answer for a node that renders
		// nothing — without decoding the image.
		const size = pngSize(bytes);
		return {
			blob: new Blob([bytes], { type: "image/png" }),
			sha256: await sha256(bytes),
			...(size ?? {}),
		};
	};

	const result = await transpile({
		product,
		// A custom export has no product pinning a print size, so the design's
		// own measurement is the canvas.
		sizeMode: msg.mode === "custom" ? "from-design" : "exact",
		picks,
		variants,
		metadata: {
			id: slugify(metadata.name) || "untitled",
			name: metadata.name,
			version: "1.0.0",
			formatVersion: FORMAT_VERSION,
			...(metadata.description !== undefined
				? { description: metadata.description }
				: {}),
			...(metadata.mood !== undefined ? { mood: metadata.mood } : {}),
		},
		fetchNodeTree: async (_fileKey, nodeId) => {
			const tree = treeById.get(nodeId);
			if (!tree) throw new Error(`no tree for ${nodeId}`);
			return tree;
		},
		renderImage,
	});

	const template = {
		...(result.template as Template),
		source: figmaSource({
			picks,
			variants: result.variantPicks,
			report: result.report,
		}),
		...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
	};

	const exported = (await attachAssets(
		template,
		result.pendingAssets,
	)) as ExportedTemplate;

	const checked = validate(exported);
	if (!checked.ok) {
		throw new ExportBlockedError(
			validationIssues(exported, checked.errors, result.trace, picks),
			false,
		);
	}

	const placeholders = result.warnings.filter((w) => PROCEEDABLE.has(w.code));
	if (placeholders.length > 0 && !opts.proceed) {
		throw new ExportBlockedError(placeholders, true);
	}

	return { template: exported, trace: result.trace };
}
