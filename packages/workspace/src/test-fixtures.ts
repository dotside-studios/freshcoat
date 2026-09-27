import { createHash } from "node:crypto";
import type { Template } from "@freshcoat-js/coatfile";
import { bytesToBase64 } from "@freshcoat-js/coatfile";
import { zlibSync } from "fflate";
import type { Dataset, ExportPreset, Workspace } from "./types";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** A solid RGB PNG of this size. */
export function makePng(width: number, height: number, rgb = [200, 40, 40]) {
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 2, 0, 0, 0], 8);
	const raw = new Uint8Array(height * (1 + width * 3));
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			raw.set(rgb, y * (1 + width * 3) + 1 + x * 3);
		}
	}
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", zlibSync(raw)),
		chunk("IEND", new Uint8Array()),
	];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

export function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export const backPng = makePng(4, 4, [10, 20, 30]);
export const backSha = sha256(backPng);
export const photoPng = makePng(2, 2);
export const photoSha = sha256(photoPng);

export const memberCard: Template = {
	format_version: "1.1",
	id: "member-card",
	name: "Member card",
	width: 1012,
	height: 638,
	fields: {
		type: "object",
		properties: {
			name: { type: "string", title: "Name", default: "Member" },
			number: { type: "string", default: "0000" },
			photo: { type: "string", format: "image" },
			vip: { type: "string", format: "boolean", default: "false" },
		},
		required: ["name"],
	},
	template_data: [
		{
			name: "front",
			background: {
				id: "front_bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 1012, height: 638 },
				properties: { fill: "#ffffff" },
			},
			elements: [
				{
					id: "name",
					type: "text",
					pos: { x: 40, y: 40 },
					size: { width: 600, height: 60 },
					properties: {
						value: "{{name}} {{number}}",
						font: { family: "Inter", size: 40, weight: 700 },
						color: "#111111",
						align: "left",
					},
				},
				{
					id: "photo",
					type: "image",
					pos: { x: 700, y: 40 },
					size: { width: 240, height: 300 },
					properties: { src: "{{photo}}", fit: "cover" },
				},
			],
		},
		{
			name: "back",
			background: {
				id: "back_bg",
				type: "image",
				pos: { x: 0, y: 0 },
				size: { width: 1012, height: 638 },
				properties: { src: `asset:${backSha}`, fit: "cover" },
			},
			elements: [],
		},
	],
	variants: [
		{ id: "gold", label: "Gold Tier", overrides: [] },
		{ id: "silver", label: "Silver", overrides: [] },
	],
	assets: [
		{
			sha256: backSha,
			base64: bytesToBase64(backPng),
			contentType: "image/png",
		},
	],
} as Template;

export const members: Dataset = {
	id: "d_members",
	name: "Members",
	columns: [
		{ key: "name", title: "Full name", type: "text", required: true },
		{ key: "number", type: "text", pattern: "^[0-9]+$" },
		{ key: "tier", type: "text", enum: ["gold", "silver", "Gold Tier"] },
		{ key: "photo", type: "image" },
		{ key: "vip", type: "boolean", default: false },
		{ key: "joined", type: "date" },
		{ key: "points", type: "integer", minimum: 0 },
	],
	records: [
		{
			id: "r_00000001",
			values: {
				name: "Ana Cruz",
				number: "007",
				tier: "gold",
				photo: `ws:${photoSha}`,
				vip: true,
				joined: "2024-02-29",
				points: 1200,
			},
			status: "pending",
		},
		{
			id: "r_00000002",
			values: { name: "Ben Uy", tier: "Gold Tier", vip: false },
			status: "exported",
			exportedAt: "2026-09-01T10:00:00.000Z",
		},
		{
			id: "r_00000003",
			values: { name: "Cy Ong", tier: "bronze" },
			status: "failed",
			error: "render failed",
		},
		{ id: "r_00000004", values: { name: "Di Sy" }, status: "skipped" },
		{ id: "r_00000005", values: { name: "Ed Go" }, status: "pending" },
	],
	assets: [
		{
			sha256: photoSha,
			contentType: "image/png",
			name: "ana.png",
			size: photoPng.length,
			width: 2,
			height: 2,
			blob: new Blob([photoPng], { type: "image/png" }),
		},
	],
};

export const preset: ExportPreset = {
	id: "p_1",
	name: "All",
	templateId: "t_member",
	records: "all",
	sides: "all",
	format: "png-zip",
	scale: 1,
	dpi: 300,
	fileName: "{{template}}-{{index}}-{{side}}",
	markExported: true,
};

export const workspace: Workspace = {
	formatVersion: "1.0",
	name: "Club",
	templates: [
		{
			id: "t_member",
			fileName: "Member card.coat",
			template: memberCard,
			binding: {
				datasetId: "d_members",
				fields: {
					name: { kind: "column", column: "name" },
					number: {
						kind: "serial",
						start: 1,
						step: 1,
						pad: 4,
						prefix: "M-",
					},
					photo: { kind: "column", column: "photo" },
				},
				variant: { kind: "column", column: "tier" },
			},
		},
		{
			id: "t_plain",
			fileName: "Plain",
			template: { ...memberCard, id: "plain" },
		},
	],
	datasets: [members],
	presets: [preset],
};

/** Freeze a value and everything under it, so a test fails if a function
 *  under test writes to its input. Typed arrays cannot be frozen and are
 *  left alone. */
export function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null) return value;
	if (ArrayBuffer.isView(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
