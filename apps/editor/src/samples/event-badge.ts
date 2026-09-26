import type { Template } from "@freshcoat/coatfile";
import { FORMAT_VERSION } from "@freshcoat/coatfile";
import { VEND_SANS, VEND_SANS_FAMILY } from "./vend-sans";

const FONT = VEND_SANS_FAMILY;
const W = 1200;
const H = 900;
const MARGIN = 72;
const BAND = "#0f766e";
const INK = "#111827";
const TINT = "#ccfbf1";

/**
 * Recolors the band and everything drawn in its color: the event line's
 * tint, the role chip and its text.
 */
function bandColors(band: string, tint: string) {
	return [
		{ id: "band", properties: { fill: band } },
		{ id: "event-detail", properties: { color: tint } },
		{ id: "role-chip", properties: { fill: tint } },
		{ id: "role", properties: { color: band } },
	];
}

/**
 * A 4 × 3 in badge at 300 dpi: an event band across the top, the attendee's
 * name, company and role, and their ticket as a Code 128 to scan at the door.
 * Speaker and Staff recolor the band; staff need no ticket, so Staff also
 * hides the barcode and the rule above it.
 */
export function eventBadge(): Template {
	return {
		format_version: FORMAT_VERSION,
		id: "event-badge",
		name: "Event badge",
		description:
			"A 4 × 3 in name badge: event band, name, company, role and a Code 128 of the ticket, in Speaker and Staff variants.",
		version: "1.0.0",
		width: W,
		height: H,
		fonts: [VEND_SANS],
		fields: {
			type: "object",
			properties: {
				name: {
					type: "string",
					title: "Name",
					default: "Maria Santos",
					maxLength: 40,
				},
				company: {
					type: "string",
					title: "Company",
					default: "Northwind Labs",
					maxLength: 48,
				},
				role: { type: "string", title: "Role", default: "Attendee" },
				ticket_id: {
					type: "string",
					title: "Ticket ID",
					default: "TKT-2026-0042",
				},
			},
			required: ["name", "ticket_id"],
		},
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "band",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: W, height: 208 },
						constraints: { horizontal: "stretch", vertical: "start" },
						properties: { fill: BAND },
					},
					{
						id: "event",
						type: "text",
						pos: { x: MARGIN, y: 56 },
						size: { width: W - 2 * MARGIN, height: 60 },
						properties: {
							value: "SUMMIT 2026",
							font: { family: FONT, size: 52, weight: 700, letterSpacing: 5 },
							color: "#ffffff",
							maxLines: 1,
						},
					},
					{
						id: "event-detail",
						type: "text",
						pos: { x: MARGIN, y: 124 },
						size: { width: W - 2 * MARGIN, height: 34 },
						properties: {
							value: "12 to 14 November · Lisbon",
							font: { family: FONT, size: 28, weight: 500 },
							color: TINT,
							maxLines: 1,
						},
					},
					{
						id: "name",
						type: "text",
						pos: { x: MARGIN, y: 268 },
						size: { width: W - 2 * MARGIN, height: 112 },
						properties: {
							value: "{{name}}",
							font: { family: FONT, size: 96, weight: 700 },
							color: INK,
							fit: "shrink",
							maxLines: 1,
							verticalAlign: "middle",
						},
					},
					{
						id: "company",
						type: "text",
						pos: { x: MARGIN, y: 392 },
						size: { width: W - 2 * MARGIN, height: 56 },
						properties: {
							value: "{{company}}",
							font: { family: FONT, size: 44, weight: 500 },
							color: "#4b5563",
							fit: "shrink",
							maxLines: 1,
						},
					},
					{
						id: "role-chip",
						type: "frame",
						pos: { x: MARGIN, y: 484 },
						size: { width: 220, height: 56 },
						properties: {
							fill: TINT,
							cornerRadius: 28,
							layout: {
								direction: "row",
								primaryAlign: "center",
								crossAlign: "center",
								padding: { left: 28, right: 28 },
							},
							children: [
								{
									id: "role",
									type: "text",
									size: { width: 160, height: 30 },
									layoutChild: { width: "hug", height: "hug" },
									properties: {
										value: "{{role}}",
										font: {
											family: FONT,
											size: 24,
											weight: 700,
											letterSpacing: 3,
										},
										color: BAND,
										case: "upper",
										maxLines: 1,
									},
								},
							],
						},
					},
					{
						id: "divider",
						type: "rect",
						pos: { x: MARGIN, y: 604 },
						size: { width: W - 2 * MARGIN, height: 2 },
						properties: { fill: "#e5e7eb" },
					},
					{
						// Centred: the quiet zone is inside the box, so its bars could
						// not sit on the text's left margin anyway.
						id: "ticket",
						type: "barcode",
						pos: { x: (W - 640) / 2, y: 644 },
						size: { width: 640, height: 192 },
						properties: {
							value: "{{ticket_id}}",
							symbology: "code128",
							foreground: INK,
							showText: true,
							textSize: 26,
						},
					},
				],
			},
		],
		variants: [
			{
				id: "speaker",
				label: "Speaker",
				swatch: "#6d28d9",
				overrides: [
					{ name: "front", elements: bandColors("#6d28d9", "#ede9fe") },
				],
			},
			{
				id: "staff",
				label: "Staff",
				swatch: "#c2410c",
				overrides: [
					{
						name: "front",
						elements: [
							...bandColors("#c2410c", "#ffedd5"),
							{ id: "divider", properties: {}, hidden: true },
							{ id: "ticket", properties: {}, hidden: true },
						],
					},
				],
			},
		],
	};
}
