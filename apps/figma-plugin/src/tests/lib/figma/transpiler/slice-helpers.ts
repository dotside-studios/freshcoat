import { FORMAT_VERSION, type Template } from "@freshcoat-js/coatfile";
import { vi } from "vitest";
import { transpile } from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";

export type Box = { x: number; y: number; width: number; height: number };
export type El = {
	id: string;
	type: string;
	pos: { x: number; y: number };
	size: { width: number; height: number };
	rotation?: number;
	properties: Record<string, unknown> & {
		slice?: Record<string, unknown>;
		children?: El[];
	};
};

const base = { visible: true, opacity: 1, blendMode: "NORMAL" as const };

export const at = (b: Box) =>
	[
		[1, 0, b.x],
		[0, 1, b.y],
	] as [[number, number, number], [number, number, number]];

export function node(
	type: string,
	id: string,
	name: string,
	box: Box,
	extra: Record<string, unknown> = {},
): FigmaNode {
	return {
		...base,
		id,
		name,
		type,
		absoluteBoundingBox: box,
		width: box.width,
		height: box.height,
		relativeTransform: at(box),
		absoluteTransform: at(box),
		...extra,
	} as unknown as FigmaNode;
}

export const red = [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }];
export const slice = (id: string, name: string, box: Box, extra = {}) =>
	node("SLICE", id, name, box, extra);
export const rect = (id: string, name: string, box: Box, extra = {}) =>
	node("RECTANGLE", id, name, box, { fills: red, ...extra });
export const line = (id: string, name: string, box: Box) =>
	node("LINE", id, name, box, {
		fills: [],
		strokes: red,
		strokeWeight: 2,
		fillGeometry: [{ path: `M 0 0 L ${box.width} 0` }],
	});
export const ellipse = (id: string, name: string, box: Box) =>
	node("ELLIPSE", id, name, box, {
		fills: red,
		fillGeometry: [
			{
				path: "M 50 0 C 78 0 100 22 100 50 C 100 78 78 100 50 100 C 22 100 0 78 0 50 C 0 22 22 0 50 0 Z",
			},
		],
	});
export const group = (
	id: string,
	name: string,
	box: Box,
	children: FigmaNode[],
) => node("GROUP", id, name, box, { children });
export const frameNode = (
	id: string,
	name: string,
	box: Box,
	children: FigmaNode[],
) => node("FRAME", id, name, box, { children, fills: [], clipsContent: false });

export const FRAME_BOX: Box = { x: 0, y: 0, width: 1000, height: 600 };

export async function run(children: FigmaNode[], frameBox: Box = FRAME_BOX) {
	const frame = frameNode("f:1", "Front", frameBox, children);
	const result = await transpile({
		product: {
			sku: "custom",
			displayName: "Custom",
			width: frameBox.width,
			height: frameBox.height,
			frames: [{ name: "front", label: "Front", required: true }],
		},
		sizeMode: "from-design",
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "f:1",
				nodeName: "Front",
				width: frameBox.width,
				height: frameBox.height,
			},
		},
		metadata: {
			id: "t",
			name: "T",
			version: "1.0.0",
			formatVersion: FORMAT_VERSION,
		},
		fetchNodeTree: vi.fn(async () => frame as FigmaContainerNode),
		renderImage: vi.fn(),
	});
	const template = result.template as Template;
	const elements = (template.template_data[0] as unknown as { elements: El[] })
		.elements;
	return { ...result, elements, frame };
}

export const codes = (r: { warnings: Array<{ code: string }> }) =>
	r.warnings.map((w) => w.code);
