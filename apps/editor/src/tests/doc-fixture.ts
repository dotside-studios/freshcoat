import { createHash } from "node:crypto";
import type { Template } from "@freshcoat-js/coatfile";
import { approxEngine, bytesToBase64, compile } from "@freshcoat-js/coatfile";
import { resolveLayout } from "@freshcoat-js/engine";
import { collectGeometry, type LayerGeometry } from "../doc/geometry";
import { buildPreview } from "../doc/preview";
import { sampleValues } from "../doc/values";

export const PNG_BYTES = new Uint8Array([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
	0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
	218, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0,
	0, 73, 69, 78, 68, 174, 66, 96, 130,
]);
export const PNG_SHA = createHash("sha256").update(PNG_BYTES).digest("hex");

/**
 * front: 0 rect a · 1 frame f [f1, t1, inner [deep]] · 2 mask m (source ms)
 * [img] · 3 auto-layout row [r1, r2, abs] · 4 text title (visibleWhen show) ·
 * 5 rect rot (30°) · 6 frame spin (15°) [spun]
 * back: 0 rect a
 */
export function doc(): Template {
	return {
		format_version: "1.1",
		id: "doc",
		name: "Doc",
		width: 1000,
		height: 600,
		fields: {
			type: "object",
			properties: {
				name: { type: "string", title: "Name", default: "Ada" },
				title: { type: "string" },
				show: { type: "string", format: "boolean", default: "true" },
			},
			required: ["name", "title"],
		},
		fonts: [
			{
				kind: "google",
				family: "Inter",
				url: "https://fonts.googleapis.com/css2?family=Inter",
			},
		],
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					size: { width: 1000, height: 600 },
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "a",
						type: "rect",
						pos: { x: 10, y: 20 },
						size: { width: 100, height: 50 },
						properties: { fill: "#111111" },
					},
					{
						id: "f",
						type: "frame",
						pos: { x: 200, y: 100 },
						size: { width: 300, height: 200 },
						properties: {
							fill: "#eeeeee",
							children: [
								{
									id: "f1",
									type: "rect",
									pos: { x: 10, y: 10 },
									size: { width: 50, height: 50 },
									properties: { fill: "#222222" },
								},
								{
									id: "t1",
									type: "text",
									pos: { x: 70, y: 10 },
									size: { width: 100, height: 30 },
									properties: {
										value: "Hi {{ name }}",
										font: { family: "Inter", size: 16 },
									},
								},
								{
									id: "inner",
									type: "frame",
									pos: { x: 100, y: 100 },
									size: { width: 80, height: 80 },
									properties: {
										children: [
											{
												id: "deep",
												type: "rect",
												pos: { x: 5, y: 6 },
												size: { width: 10, height: 10 },
												properties: {},
											},
										],
									},
								},
							],
						},
					},
					{
						id: "m",
						type: "mask",
						pos: { x: 50, y: 300 },
						size: { width: 200, height: 100 },
						properties: {
							mask: {
								id: "ms",
								type: "vector",
								size: { width: 200, height: 100 },
								properties: {
									d: "M0 50A100 50 0 1 0 200 50A100 50 0 1 0 0 50Z",
									fill: "#000000",
								},
							},
							children: [
								{
									id: "img",
									type: "image",
									pos: { x: 0, y: 0 },
									size: { width: 200, height: 100 },
									properties: { src: `asset:${PNG_SHA}`, fit: "cover" },
								},
							],
						},
					},
					{
						id: "row",
						type: "frame",
						pos: { x: 600, y: 50 },
						size: { width: 300, height: 80 },
						properties: {
							fill: "#dddddd",
							layout: {
								direction: "row",
								gap: 10,
								padding: { top: 10, right: 10, bottom: 10, left: 10 },
							},
							children: [
								{
									id: "r1",
									type: "rect",
									size: { width: 50, height: 60 },
									properties: {},
								},
								{
									id: "r2",
									type: "rect",
									size: { width: 40, height: 60 },
									properties: {},
								},
								{
									id: "abs",
									type: "rect",
									pos: { x: 5, y: 5 },
									size: { width: 10, height: 10 },
									layoutChild: { absolute: true },
									properties: {},
								},
							],
						},
					},
					{
						id: "title",
						type: "text",
						pos: { x: 20, y: 500 },
						size: { width: 400, height: 40 },
						visibleWhen: { field: "show" },
						properties: {
							value: "{{title}}",
							font: { family: "Inter", size: 24 },
						},
					},
					{
						id: "rot",
						type: "rect",
						pos: { x: 700, y: 300 },
						size: { width: 100, height: 40 },
						rotation: 30,
						properties: {},
					},
					{
						id: "spin",
						type: "frame",
						pos: { x: 600, y: 400 },
						size: { width: 200, height: 100 },
						rotation: 15,
						properties: {
							children: [
								{
									id: "spun",
									type: "rect",
									pos: { x: 20, y: 30 },
									size: { width: 40, height: 20 },
									rotation: 10,
									properties: {},
								},
							],
						},
					},
				],
			},
			{
				name: "back",
				background: { id: "bg", type: "rect", properties: { fill: "#000000" } },
				elements: [
					{
						id: "a",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: 10, height: 10 },
						properties: {},
					},
				],
			},
		],
		variants: [
			{
				id: "dark",
				label: "Dark",
				overrides: [
					{
						name: "front",
						background: {
							id: "bg",
							type: "rect",
							properties: { fill: "#000000" },
						},
						elements: [
							{ id: "a", properties: { fill: "#ff0000" } },
							{ id: "f1", properties: { fill: "#00ff00" } },
						],
					},
					{
						name: "back",
						elements: [{ id: "a", properties: { fill: "#0000ff" } }],
					},
				],
			},
		],
		assets: [
			{
				sha256: PNG_SHA,
				base64: bytesToBase64(PNG_BYTES),
				contentType: "image/png",
			},
		],
	};
}

/** Freezes every object reachable from `v`, so a mutation throws. */
export function deepFreeze<T>(v: T): T {
	if (v && typeof v === "object" && !Object.isFrozen(v)) {
		Object.freeze(v);
		for (const k of Object.keys(v))
			deepFreeze((v as Record<string, unknown>)[k]);
	}
	return v;
}

export function frozenDoc(): Template {
	return deepFreeze(doc());
}

/** Geometry as the editor gets it: preview, compile, resolve layout, collect. */
export function geometryOf(
	t: Template,
	side = 0,
	values: Record<string, string> = sampleValues(t),
): LayerGeometry {
	const preview = buildPreview(t, { side });
	const frame = compile(preview.template, values, {
		width: t.width,
		height: t.height,
	}).frames[0];
	const root = resolveLayout(frame.root, { measure: approxEngine.measureText });
	return collectGeometry(root, preview.pathIds, t, side);
}
