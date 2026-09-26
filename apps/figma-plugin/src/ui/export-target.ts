import { useMemo, useState } from "preact/hooks";
import type { ProductRegistryEntry } from "~/lib/figma/transpiler";
import { makeCustomProduct } from "~/main/product";
import type {
	CardView,
	FieldOverviewItem,
	NodeCandidate,
} from "~/shared/protocol";
import { useMainMessage } from "~/ui/messages";
import { slugify } from "~/ui/run-transpile";

/** What an export, and a field detection, is about: the canvas, the frame or
 *  card picked for it, and the product that fixes its sides. Held above the
 *  tabs because both Fields (Detect fields) and Export act on the same pick. */
export type ExportTarget = {
	daviMode: boolean;
	cards: CardView[];
	nodes: NodeCandidate[];
	pageName: string;
	cardId: string;
	nodeId: string;
	setCardId: (id: string) => void;
	setNodeId: (id: string) => void;
	selectedCardId: string | null;
	selectedNodeId: string | null;
	card: CardView | null;
	node: NodeCandidate | null;
	/** The single frame name a custom export produces, slugged so consumers
	 *  address it as a stable key rather than by the layer's current name. */
	customFrameName: string;
	product: ProductRegistryEntry | undefined;
	/** The node field metadata is stored on, and the root of the colorway
	 *  search. Empty until something is picked. */
	targetId: string;
	colorwaySource: CardView | NodeCandidate | null;
	sideAssignment: Record<string, string>;
	/** Every side of the product has a frame. */
	complete: boolean;
};

export function useExportTarget(input: {
	daviMode: boolean;
	products: ProductRegistryEntry[];
	productSku: string;
}): ExportTarget {
	const { daviMode, products, productSku } = input;
	const [cards, setCards] = useState<CardView[]>([]);
	const [nodes, setNodes] = useState<NodeCandidate[]>([]);
	const [cardId, setCardId] = useState("");
	const [nodeId, setNodeId] = useState("");
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [pageName, setPageName] = useState("");

	useMainMessage((msg) => {
		if (msg.type !== "cards") return;
		setCards(msg.cards);
		setNodes(msg.nodes);
		setPageName(msg.pageName);
		setSelectedCardId(msg.selectedCardId);
		setSelectedNodeId(msg.selectedNodeId);
		// Initial pick only, when nothing is chosen yet: what's highlighted on
		// the canvas, else the sole candidate on the page. A pick that has gone
		// from the page is dropped rather than kept pointing at nothing.
		setCardId((prev) => {
			if (prev && msg.cards.some((c) => c.id === prev)) return prev;
			if (msg.selectedCardId) return msg.selectedCardId;
			if (msg.cards.length === 1) return msg.cards[0].id;
			return "";
		});
		setNodeId((prev) => {
			if (prev && msg.nodes.some((n) => n.id === prev)) return prev;
			if (msg.selectedNodeId) return msg.selectedNodeId;
			if (msg.nodes.length === 1) return msg.nodes[0].id;
			return "";
		});
	});

	const card = cards.find((c) => c.id === cardId) ?? null;
	const node = nodes.find((n) => n.id === nodeId) ?? null;
	const customFrameName = node ? slugify(node.name) || "main" : "";

	// In Davi mode the product comes from the catalog; in custom mode it is
	// synthesized per export from the picked frame and never hits the registry.
	const product = useMemo(() => {
		if (daviMode)
			return products.find((p) => p.sku === productSku) ?? products[0];
		return node
			? makeCustomProduct(customFrameName, node.width, node.height)
			: undefined;
	}, [daviMode, products, productSku, node, customFrameName]);

	const sideAssignment = useMemo<Record<string, string>>(() => {
		if (!daviMode) return node ? { [customFrameName]: node.id } : {};
		const out: Record<string, string> = {};
		for (const s of card?.sides ?? []) {
			if (s.nodeId) out[s.side] = s.nodeId;
		}
		return out;
	}, [daviMode, card, node, customFrameName]);

	const complete = daviMode
		? !!card &&
			!!product &&
			product.frames.every((f) => !!sideAssignment[f.name])
		: !!node;

	return {
		daviMode,
		cards,
		nodes,
		pageName,
		cardId,
		nodeId,
		setCardId,
		setNodeId,
		selectedCardId,
		selectedNodeId,
		card,
		node,
		customFrameName,
		product,
		targetId: daviMode ? (card?.id ?? "") : (node?.id ?? ""),
		colorwaySource: daviMode ? card : node,
		sideAssignment,
		complete,
	};
}

/** The fields stored on the picked frame or card. The overview covers every
 *  top-level frame on the page and names each by its frame, so this is the
 *  slice an export of the current pick would carry. */
export function fieldsForTarget(
	fields: FieldOverviewItem[],
	target: ExportTarget,
): FieldOverviewItem[] {
	const name = target.daviMode ? target.card?.name : target.node?.name;
	if (!name) return [];
	return fields.filter((f) => f.slot === name);
}
