// Pure harvest/reconcile engine: turn freshly-inferred field drafts into the
// template-global field-metadata map, and compute marker rewrites for renames.
// No Figma API here: main/bindings.ts supplies real nodes; this stays testable.

import { renameToken } from "@freshcoat-js/coatfile/tokens";
import {
	buildFieldMeta,
	type FieldDraft,
	type FieldFormat,
	type FieldMeta,
	inferNodeBinding,
	parseVisibilityMarker,
	type StoredBinding,
} from "./binding";
import { type FigmaNode, isContainerNode } from "./types";

export type TypeChange = { id: string; from: FieldFormat; to: FieldFormat };

export type ReconcileResult = {
	/** The merged field-metadata map (input is not mutated). */
	meta: Record<string, FieldMeta>;
	/** Overridden fields whose inferred format changed — surface for rename. */
	typeChanges: TypeChange[];
};

/**
 * Merge inferred drafts into the existing field-metadata map:
 *  - new id → create with defaults
 *  - existing, not overridden → refresh non-identity fields (format, default)
 *  - existing, overridden, same format → keep
 *  - existing, overridden, format changed → keep, but flag the change
 * Fields already present but absent from `drafts` are kept (a binding outlives a
 * cleared marker) — deletion is an explicit unbind elsewhere.
 */
export function reconcileFields(
	existing: Record<string, FieldMeta>,
	drafts: FieldDraft[],
): ReconcileResult {
	const meta: Record<string, FieldMeta> = { ...existing };
	const typeChanges: TypeChange[] = [];

	for (const draft of drafts) {
		const cur = meta[draft.id];
		if (!cur) {
			meta[draft.id] = buildFieldMeta(draft);
			continue;
		}
		if (cur.overridden) {
			if (cur.format !== draft.format) {
				typeChanges.push({ id: draft.id, from: cur.format, to: draft.format });
			}
			continue;
		}
		meta[draft.id] = {
			...cur,
			format: draft.format,
			...(draft.widget ? { widget: draft.widget } : {}),
			...(draft.default !== undefined ? { default: draft.default } : {}),
		};
	}

	return { meta, typeChanges };
}

function* walkNodes(node: FigmaNode): Iterable<FigmaNode> {
	yield node;
	if (isContainerNode(node)) {
		for (const child of node.children) yield* walkNodes(child);
	}
}

/** One assigned slot to harvest: its frame tree and the field metadata already
 * stored on that slot frame. */
export type SlotHarvestInput = {
	slotId: string;
	tree: FigmaNode;
	existingMeta: Record<string, FieldMeta>;
};

/** The pluginData writes a harvest implies — applied to live nodes by the glue. */
export type HarvestPlan = {
	/** Binding to write per node (only nodes that currently infer a binding). */
	nodeBindings: Array<{ nodeId: string; record: StoredBinding }>;
	/** Reconciled field metadata per slot frame, with any flagged type changes. */
	slotMeta: Array<{
		slotId: string;
		meta: Record<string, FieldMeta>;
		typeChanges: TypeChange[];
	}>;
};

/**
 * Plan a harvest: infer each node's binding from its marker/content, collect the
 * field drafts per slot, and reconcile them against the slot's existing
 * metadata. Pure — the caller writes the resulting pluginData to live nodes.
 * Only adds/updates: nodes that no longer infer a binding (cleared markers) are
 * left out of the plan, so their stored binding + field metadata persist.
 */
export function planHarvest(slots: SlotHarvestInput[]): HarvestPlan {
	const nodeBindings: HarvestPlan["nodeBindings"] = [];
	const slotMeta: HarvestPlan["slotMeta"] = [];

	for (const slot of slots) {
		const drafts: FieldDraft[] = [];
		const visibilityIds = new Set<string>();
		for (const node of walkNodes(slot.tree)) {
			const cond = parseVisibilityMarker(node.name);
			if (cond) visibilityIds.add(cond.field);
			const binding = inferNodeBinding(node);
			if (!binding) continue;
			nodeBindings.push({ nodeId: node.id, record: { bind: binding.bind } });
			drafts.push(...binding.fields);
		}
		// A field only an `if:` marker names is a toggle. One a layer also
		// renders keeps that layer's format, and hides its layers while blank.
		const drafted = new Set(drafts.map((d) => d.id));
		for (const id of visibilityIds) {
			if (!drafted.has(id) && !slot.existingMeta[id])
				drafts.push({ id, format: "boolean" });
		}
		const { meta, typeChanges } = reconcileFields(slot.existingMeta, drafts);
		slotMeta.push({ slotId: slot.slotId, meta, typeChanges });
	}

	return { nodeBindings, slotMeta };
}

/**
 * Rewrite a layer name so every `{{oldId}}` token becomes `{{newId}}`, keeping
 * the kind prefix, quotes, literals, and qr opts intact. Returns null when the
 * name references no such token — the caller then leaves the (cleared) marker
 * alone and keeps the rename in pluginData only (spec §6).
 */
export function renameInMarker(
	name: string,
	oldId: string,
	newId: string,
): string | null {
	const next = renameToken(name, oldId, newId);
	return next === name ? null : next;
}
