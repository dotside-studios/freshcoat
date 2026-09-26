import { colorwayLabel } from "~/lib/figma/transpiler/variants";

export type DiscoChild = { id: string; name: string; type: string };
export type DiscoNode = {
	id: string;
	name: string;
	type: string;
	children?: DiscoChild[];
};
export type DiscoInstance = {
	id: string;
	name: string;
	mainComponentId: string | null;
};

export type SideMapping = {
	sides: Record<string, string | null>;
	missingRequired: string[];
};

export type DiscoveredCard = {
	id: string;
	name: string;
	type: "FRAME" | "COMPONENT";
	sides: Record<string, string | null>;
	missingRequired: string[];
	colorways: Array<{ instanceId: string; label: string }>;
	unmatchedInstances: number;
};

const FRAME_LIKE = new Set(["FRAME", "COMPONENT"]);

export function mapSides(
	node: DiscoNode,
	sideNames: string[],
	required: string[],
): SideMapping {
	const children = node.children ?? [];
	const sides: Record<string, string | null> = {};
	for (const side of sideNames) {
		const match = children.find(
			(c) => c.name.trim().toLowerCase() === side.toLowerCase(),
		);
		sides[side] = match?.id ?? null;
	}
	const missingRequired = required.filter((s) => sides[s] == null);
	return { sides, missingRequired };
}

export function isCard(node: DiscoNode, requiredSides: string[]): boolean {
	if (!FRAME_LIKE.has(node.type)) return false;
	const { missingRequired } = mapSides(node, requiredSides, requiredSides);
	return missingRequired.length === 0;
}

export function collectColorways(
	card: { id: string; name: string },
	instances: DiscoInstance[],
): {
	colorways: Array<{ instanceId: string; label: string }>;
	unmatchedInstances: number;
} {
	const colorways: Array<{ instanceId: string; label: string }> = [];
	let unmatchedInstances = 0;
	for (const inst of instances) {
		if (inst.mainComponentId !== card.id) continue;
		const label = colorwayLabel(inst.name, card.name);
		if (label === null) unmatchedInstances++;
		else colorways.push({ instanceId: inst.id, label });
	}
	return { colorways, unmatchedInstances };
}

export function detectCards(
	nodes: DiscoNode[],
	instances: DiscoInstance[],
	sideNames: string[],
	requiredSides: string[],
): DiscoveredCard[] {
	const cards: DiscoveredCard[] = [];
	for (const node of nodes) {
		if (!isCard(node, requiredSides)) continue;
		const { sides, missingRequired } = mapSides(node, sideNames, requiredSides);
		const { colorways, unmatchedInstances } = collectColorways(
			{ id: node.id, name: node.name },
			instances,
		);
		cards.push({
			id: node.id,
			name: node.name,
			type: node.type as "FRAME" | "COMPONENT",
			sides,
			missingRequired,
			colorways,
			unmatchedInstances,
		});
	}
	return cards;
}
