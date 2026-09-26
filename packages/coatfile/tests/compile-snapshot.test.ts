// Every committed fixture, and a template that reaches every element kind,
// compiles to exactly the render tree recorded in __snapshots__. Options a
// template does not use must not move a single number of what it draws.
import { afterEach, describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import { bwipBarcodeEncoder } from "../src/barcode";
import { setBarcodeEncoder } from "../src/barcode-encoder";
import { compile } from "../src/compile";
import type { CompiledTemplate, Template } from "../src/types";

// Bitmaps (the QR matrix) serialise as a short digest rather than thousands of
// snapshot lines; any change to a byte still changes the digest.
function digest(bytes: Uint8Array): string {
	let h = 0x811c9dc5;
	for (const b of bytes) {
		h ^= b;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return `bytes:${bytes.length}:${h.toString(16)}`;
}

function plain(compiled: CompiledTemplate): unknown {
	return JSON.parse(
		JSON.stringify(compiled, (_key, value) =>
			value instanceof Uint8Array ? digest(value) : value,
		),
	);
}

const kitchenSink: Template = {
	format_version: "1.1",
	id: "kitchen-sink",
	name: "Kitchen sink",
	width: 400,
	height: 250,
	fields: {
		type: "object",
		properties: {
			name: { type: "string", default: "Ada Lovelace" },
			url: { type: "string", default: "https://davi.social/ada" },
		},
	},
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				properties: {
					fill: {
						kind: "linear",
						angle: 30,
						stops: [
							{ offset: 0, color: "#112233" },
							{ offset: 1, color: "#445566" },
						],
					},
				},
			},
			elements: [
				{
					id: "photo",
					type: "image",
					pos: { x: 10, y: 10 },
					size: { width: 120, height: 80 },
					rotation: 12,
					properties: { src: "https://example.com/p.png", fit: "contain" },
				},
				{
					id: "title",
					type: "text",
					pos: { x: 150, y: 20 },
					size: { width: 220, height: 40 },
					properties: {
						value: "{{name}}",
						font: { family: "Inter", size: 18, weight: 600 },
						color: "#fff",
						fill: {
							kind: "radial",
							center: [0.3, 0.4],
							radius: 0.6,
							stops: [
								{ offset: 0, color: "#fff" },
								{ offset: 1, color: "#aaa" },
							],
						},
					},
				},
				{
					id: "stack",
					type: "frame",
					pos: { x: 150, y: 80 },
					size: { width: 200, height: 100 },
					properties: {
						fill: "#ffffff22",
						cornerRadius: 8,
						clipsContent: true,
						layout: {
							direction: "column",
							gap: 4,
							padding: { top: 6, right: 6, bottom: 6, left: 6 },
						},
						children: [
							{
								id: "stack-a",
								type: "rect",
								size: { width: 50, height: 20 },
								layoutChild: { width: "fill" },
								properties: { fill: "#f00" },
							},
							{
								id: "stack-b",
								type: "text",
								size: { width: 100, height: 20 },
								properties: {
									value: "Line",
									font: { family: "Inter", size: 12 },
								},
							},
						],
					},
				},
				{
					id: "group",
					type: "frame",
					pos: { x: 20, y: 120 },
					size: { width: 110, height: 110 },
					properties: {
						children: [
							{
								id: "star",
								type: "vector",
								pos: { x: 5, y: 5 },
								size: { width: 40, height: 40 },
								properties: {
									d: "M0 0 L40 0 L20 40 Z",
									fill: {
										kind: "angular",
										center: [0.5, 0.5],
										rotation: 45,
										stops: [
											{ offset: 0, color: "#0f0" },
											{ offset: 1, color: "#00f" },
										],
									},
								},
							},
							{
								id: "masked",
								type: "mask",
								pos: { x: 50, y: 50 },
								size: { width: 50, height: 50 },
								properties: {
									mask: {
										id: "mask-shape",
										type: "rect",
										size: { width: 50, height: 50 },
										properties: { fill: "#000", cornerRadius: 25 },
									},
									children: [
										{
											id: "masked-fill",
											type: "rect",
											size: { width: 50, height: 50 },
											properties: { fill: "#fa0" },
										},
									],
								},
							},
						],
					},
				},
				{
					id: "qr",
					type: "qr_code",
					pos: { x: 330, y: 190 },
					size: { width: 50, height: 50 },
					properties: { value: "{{url}}", margin: 2, background: "#fff" },
				},
			],
		},
	],
};

// Barcodes compile through the registered encoder, so their case registers it.
const barcodes: Template = {
	format_version: "1.3",
	id: "barcodes",
	name: "Barcodes",
	width: 400,
	height: 250,
	fonts: [
		{
			kind: "google",
			family: "Inter",
			url: "https://fonts.googleapis.com/css2?family=Inter",
		},
	],
	fields: {
		type: "object",
		properties: {
			ticket: { type: "string", default: "TKT-00042" },
			gtin: { type: "string", default: "590123412345" },
		},
	},
	template_data: [
		{
			name: "front",
			background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
			elements: [
				{
					id: "ticket",
					type: "barcode",
					pos: { x: 20, y: 20 },
					size: { width: 240, height: 80 },
					properties: {
						value: "{{ticket}}",
						symbology: "code128",
						background: "#ffffff",
					},
				},
				{
					id: "gtin",
					type: "barcode",
					pos: { x: 20, y: 120 },
					size: { width: 240, height: 100 },
					properties: {
						value: "{{gtin}}",
						symbology: "ean13",
						foreground: "#112233",
						textSize: 12,
						quietZone: 4,
					},
				},
				{
					id: "matrix",
					type: "barcode",
					pos: { x: 290, y: 20 },
					size: { width: 90, height: 90 },
					rotation: 15,
					properties: { value: "{{ticket}}", symbology: "datamatrix" },
				},
				{
					id: "stacked",
					type: "barcode",
					pos: { x: 290, y: 130 },
					size: { width: 90, height: 40 },
					properties: {
						value: "{{ticket}}",
						symbology: "pdf417",
						errorCorrection: 3,
					},
				},
			],
		},
	],
};

const cases: [string, Template, { variantId?: string }][] = [
	["minimal-card", fixtures.minimalCard, {}],
	["full-feature-card", fixtures.fullFeatureCard, {}],
	["full-feature-card amber", fixtures.fullFeatureCard, { variantId: "amber" }],
	["kitchen-sink", kitchenSink, {}],
	["barcodes", barcodes, {}],
];

afterEach(() => {
	setBarcodeEncoder(null);
});

describe("compile output is stable", () => {
	for (const [name, template, extra] of cases) {
		for (const scale of [1, 0.5]) {
			test(`${name} at ${scale}x`, () => {
				if (template === barcodes) setBarcodeEncoder(bwipBarcodeEncoder);
				const compiled = compile(
					template,
					{},
					{
						width: template.width * scale,
						height: template.height * scale,
						...extra,
					},
				);
				expect(plain(compiled)).toMatchSnapshot();
			});
		}
	}
});
