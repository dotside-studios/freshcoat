import {
	bindableProperties,
	buildFieldMeta,
	type FieldMeta,
	inferNodeBinding,
	storedToNodeBinding,
} from "~/lib/figma/binding";
import {
	planHarvest,
	renameInMarker,
	type SlotHarvestInput,
} from "~/lib/figma/harvest";
import type { ProductRegistryEntry } from "~/lib/figma/transpiler";
import { extractTokens } from "~/lib/figma/transpiler/fields";
import {
	FIELD_KEY,
	FIELDS_KEY,
	readBinding,
	readFieldMeta,
} from "~/main/plugin-data";
import { readFrameTree, readNode } from "~/main/read-scene-graph";
import type {
	ClearBindingMessage,
	FieldOverviewItem,
	FieldsOverviewMessage,
	SelectionDetail,
	SelectionDetailMessage,
	SetBindingMessage,
} from "~/shared/protocol";

// The slot frame a node lives in = its top-level ancestor on the current page,
// where template-global field metadata (FIELDS_KEY) is stored.
export function slotFrameOf(node: BaseNode): BaseNode | null {
	let n: BaseNode | null = node;
	while (n?.parent && n.parent.type !== "PAGE") n = n.parent;
	return n?.parent?.type === "PAGE" ? n : null;
}

let selectionTimer: ReturnType<typeof setTimeout> | null = null;
let selectionSeq = 0;

/** Coalesce selection bursts into one post. A direct post supersedes it. */
export function scheduleSelectionDetail(delayMs = 50): void {
	if (selectionTimer !== null) clearTimeout(selectionTimer);
	const mine = ++selectionSeq;
	selectionTimer = setTimeout(() => {
		selectionTimer = null;
		if (mine === selectionSeq) postSelectionDetail();
	}, delayMs);
}

// main → ui: the binding state of the single selected node (drives the Layer tab).
export function postSelectionDetail(): void {
	if (selectionTimer !== null) clearTimeout(selectionTimer);
	selectionTimer = null;
	selectionSeq++;
	const sel = figma.currentPage.selection;
	let detail: SelectionDetail | null = null;
	if (sel.length === 1) {
		const node = readNode(sel[0] as never, { depth: 0 });
		if (node) {
			const binding = node.binding
				? storedToNodeBinding(node.binding)
				: inferNodeBinding(node);
			const slot = slotFrameOf(sel[0]);
			const metas = slot ? (readFieldMeta(slot) ?? {}) : {};
			detail = {
				nodeId: node.id,
				name: node.name,
				nodeType: node.type,
				capabilities: bindableProperties(node),
				bind: binding?.bind ?? {},
				fields: (binding?.fields ?? []).map((d) => ({
					id: d.id,
					format: d.format,
					meta: metas[d.id] ?? buildFieldMeta(d),
				})),
			};
		}
	}
	const msg: SelectionDetailMessage = { type: "selection-detail", detail };
	figma.ui.postMessage(msg);
}

// Aggregate every field stored across the page's top-level frames, mapping each
// to the nodes that reference it (for jump-to-canvas). Decoupled from slot
// assignment — any harvested frame carries its own field metadata.
function gatherFieldsOverview(): FieldOverviewItem[] {
	const items: FieldOverviewItem[] = [];
	for (const frame of figma.currentPage.children) {
		if (
			frame.type !== "FRAME" &&
			frame.type !== "COMPONENT" &&
			frame.type !== "COMPONENT_SET"
		) {
			continue;
		}
		const metas = readFieldMeta(frame) ?? {};
		const ids = Object.keys(metas);
		if (ids.length === 0) continue;

		const refs = new Map<string, string[]>();
		const names = new Map<string, string>();
		for (const node of frame.findAllWithCriteria({
			pluginData: { keys: [FIELD_KEY] },
		})) {
			const binding = readBinding(node);
			if (!binding) continue;
			for (const template of Object.values(binding.bind)) {
				for (const id of extractTokens(template)) {
					const list = refs.get(id);
					if (list) list.push(node.id);
					else refs.set(id, [node.id]);
					names.set(node.id, node.name);
				}
			}
		}
		for (const id of ids) {
			items.push({
				id,
				meta: metas[id],
				slot: frame.name,
				nodeIds: refs.get(id) ?? [],
				layerNames: (refs.get(id) ?? []).map((n) => names.get(n) ?? ""),
			});
		}
	}
	return items;
}

export function postFieldsOverview(): void {
	const msg: FieldsOverviewMessage = {
		type: "fields-overview",
		fields: gatherFieldsOverview(),
	};
	figma.ui.postMessage(msg);
}

export async function handleHarvest(
	product: ProductRegistryEntry,
	sideAssignment: Record<string, string>,
	cardId: string,
): Promise<void> {
	const card = await figma.getNodeByIdAsync(cardId);
	if (!card) {
		figma.notify(
			"Could not resolve the card to sync fields to. Re-pick your card.",
		);
		return;
	}
	const cardMeta = readFieldMeta(card) ?? {};
	const slots: SlotHarvestInput[] = [];
	const frameNodes = await Promise.all(
		product.frames.map((frame) => {
			const nodeId = sideAssignment[frame.name];
			return nodeId ? figma.getNodeByIdAsync(nodeId) : null;
		}),
	);
	for (const node of frameNodes) {
		if (
			!node ||
			(node.type !== "FRAME" &&
				node.type !== "COMPONENT" &&
				node.type !== "COMPONENT_SET")
		) {
			continue;
		}
		slots.push({
			slotId: node.id,
			tree: readFrameTree(node as never),
			existingMeta: cardMeta,
		});
	}
	const plan = planHarvest(slots);
	const bound = await Promise.all(
		plan.nodeBindings.map((nb) => figma.getNodeByIdAsync(nb.nodeId)),
	);
	for (const [i, nb] of plan.nodeBindings.entries()) {
		bound[i]?.setPluginData(FIELD_KEY, JSON.stringify(nb.record));
	}
	if (card) {
		const mergedMeta: Record<string, FieldMeta> = {};
		for (const sm of plan.slotMeta) Object.assign(mergedMeta, sm.meta);
		card.setPluginData(FIELDS_KEY, JSON.stringify(mergedMeta));
	}
	const count = plan.nodeBindings.length;
	figma.notify(`Synced ${count} field${count === 1 ? "" : "s"} to layers.`);
	postSelectionDetail();
	postFieldsOverview();
}

export async function handleSetBinding(msg: SetBindingMessage): Promise<void> {
	const node = await figma.getNodeByIdAsync(msg.nodeId);
	if (!node) return;
	if (msg.setName !== undefined) {
		(node as SceneNode).name = msg.setName;
	} else {
		for (const r of msg.renames ?? []) {
			const renamed = renameInMarker(node.name, r.from, r.to);
			if (renamed !== null) (node as SceneNode).name = renamed;
		}
	}
	node.setPluginData(FIELD_KEY, JSON.stringify({ bind: msg.bind }));
	const slot = slotFrameOf(node);
	if (slot) {
		const metas = readFieldMeta(slot) ?? {};
		for (const id of msg.removedIds ?? []) delete metas[id];
		for (const m of msg.fields) metas[m.id] = m;
		slot.setPluginData(FIELDS_KEY, JSON.stringify(metas));
	}
	postSelectionDetail();
	postFieldsOverview();
}

export async function handleClearBinding(
	msg: ClearBindingMessage,
): Promise<void> {
	const node = await figma.getNodeByIdAsync(msg.nodeId);
	if (!node) return;
	node.setPluginData(FIELD_KEY, "");
	const slot = slotFrameOf(node);
	if (slot) {
		const metas = readFieldMeta(slot) ?? {};
		for (const id of msg.removedIds) delete metas[id];
		slot.setPluginData(FIELDS_KEY, JSON.stringify(metas));
	}
	postSelectionDetail();
	postFieldsOverview();
}
