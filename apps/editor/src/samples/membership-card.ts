import type { Element, Template } from "@freshcoat/coatfile";
import { FORMAT_VERSION } from "@freshcoat/coatfile";
import { ellipsePath, sparklePath } from "./shapes";
import { VEND_SANS, VEND_SANS_FAMILY } from "./vend-sans";

const FONT = VEND_SANS_FAMILY;
const INK = "#1e1b4b";

function ring(id: string, x: number, y: number, d: number, alpha: string) {
	return {
		id,
		type: "vector",
		pos: { x, y },
		size: { width: d, height: d },
		properties: {
			d: ellipsePath(d, d),
			stroke: { color: `#ffffff${alpha}`, width: 1.5 },
		},
	} satisfies Element;
}

function label(id: string, value: string): Element {
	return {
		id,
		type: "text",
		size: { width: 200, height: 16 },
		layoutChild: { width: "fill", height: "hug" },
		properties: {
			value,
			font: { family: FONT, size: 13, weight: 600, letterSpacing: 1.6 },
			color: "#7c7a93",
			case: "upper",
		},
	};
}

function detail(id: string, caption: string, value: string): Element {
	return {
		id,
		type: "frame",
		size: { width: 560, height: 56 },
		layoutChild: { width: "fill", height: "hug" },
		properties: {
			layout: { direction: "column", gap: 4 },
			children: [
				label(`${id}-label`, caption),
				{
					id: `${id}-value`,
					type: "text",
					size: { width: 560, height: 30 },
					layoutChild: { width: "fill", height: "hug" },
					properties: {
						value,
						font: { family: FONT, size: 24, weight: 600 },
						color: INK,
						maxLines: 1,
					},
				},
			],
		},
	};
}

export function membershipCard(): Template {
	return {
		format_version: FORMAT_VERSION,
		id: "membership-card",
		name: "Membership card",
		description:
			"A CR80 club card: gradient front with the member's name, tier and QR, and a details back.",
		version: "1.0.0",
		width: 1012,
		height: 638,
		fields: {
			type: "object",
			properties: {
				display_name: {
					type: "string",
					title: "Display name",
					default: "Alex Rivera",
					maxLength: 28,
				},
				tier: { type: "string", title: "Tier", default: "Gold" },
				profile_url: {
					type: "string",
					title: "Profile URL",
					format: "url",
					default: "https://example.com/u/alex",
				},
				member_since: {
					type: "string",
					title: "Member since",
					default: "2024",
				},
				member_id: {
					type: "string",
					title: "Member ID",
					default: "LC 0042 7781",
				},
				verified: {
					type: "string",
					title: "Verified",
					format: "boolean",
					default: "true",
				},
			},
			required: ["display_name"],
		},
		fonts: [VEND_SANS],
		template_data: [
			{
				name: "front",
				background: {
					id: "front-bg",
					type: "rect",
					properties: {
						fill: [
							{
								kind: "linear",
								angle: 125,
								stops: [
									{ offset: 0, color: "#1e1b4b" },
									{ offset: 0.55, color: "#4c1d95" },
									{ offset: 1, color: "#7c3aed" },
								],
							},
							{
								kind: "radial",
								center: [0.9, 0.05],
								radius: 0.6,
								stops: [
									{ offset: 0, color: "#f472b699" },
									{ offset: 1, color: "#f472b600" },
								],
							},
							{
								kind: "radial",
								center: [0.02, 1],
								radius: 0.55,
								stops: [
									{ offset: 0, color: "#22d3ee4d" },
									{ offset: 1, color: "#22d3ee00" },
								],
							},
						],
					},
				},
				elements: [
					ring("ring-outer", 560, -260, 640, "1f"),
					ring("ring-inner", 680, -140, 400, "14"),
					{
						id: "logo",
						type: "vector",
						pos: { x: 64, y: 60 },
						size: { width: 40, height: 40 },
						properties: { d: sparklePath(40), fill: "#ffffff" },
					},
					{
						id: "wordmark",
						type: "text",
						pos: { x: 118, y: 66 },
						size: { width: 320, height: 30 },
						properties: {
							value: "LUMEN CLUB",
							font: {
								family: FONT,
								size: 24,
								weight: 700,
								letterSpacing: 4,
							},
							color: "#ffffff",
							verticalAlign: "middle",
						},
					},
					{
						id: "tier-chip",
						type: "frame",
						pos: { x: 796, y: 60 },
						size: { width: 152, height: 40 },
						properties: {
							fill: "#ffffff1f",
							stroke: { color: "#ffffff47", width: 1 },
							cornerRadius: 20,
							layout: {
								direction: "row",
								primaryAlign: "center",
								crossAlign: "center",
							},
							children: [
								{
									id: "tier",
									type: "text",
									size: { width: 120, height: 20 },
									layoutChild: { width: "hug", height: "hug" },
									properties: {
										value: "{{tier}}",
										font: {
											family: FONT,
											size: 15,
											weight: 600,
											letterSpacing: 2.4,
										},
										color: "#ffffff",
										case: "upper",
									},
								},
							],
						},
					},
					{
						id: "verified-badge",
						type: "frame",
						pos: { x: 64, y: 352 },
						size: { width: 124, height: 30 },
						visibleWhen: { field: "verified" },
						properties: {
							fill: "#22c55e2e",
							stroke: { color: "#4ade8059", width: 1 },
							cornerRadius: 15,
							layout: {
								direction: "row",
								gap: 7,
								crossAlign: "center",
								padding: { left: 8, right: 12 },
							},
							children: [
								{
									id: "check",
									type: "frame",
									size: { width: 18, height: 18 },
									properties: {
										children: [
											{
												id: "check-disc",
												type: "vector",
												size: { width: 18, height: 18 },
												properties: {
													d: ellipsePath(18, 18),
													fill: "#4ade80",
												},
											},
											{
												id: "check-tick",
												type: "vector",
												size: { width: 18, height: 18 },
												properties: {
													d: "M5 9.4L7.9 12.2L13.2 6.6",
													stroke: {
														color: "#14532d",
														width: 2,
														cap: "round",
														join: "round",
													},
												},
											},
										],
									},
								},
								{
									id: "verified-label",
									type: "text",
									size: { width: 80, height: 16 },
									layoutChild: { width: "hug", height: "hug" },
									properties: {
										value: "VERIFIED",
										font: {
											family: FONT,
											size: 12,
											weight: 700,
											letterSpacing: 1.6,
										},
										color: "#bbf7d0",
									},
								},
							],
						},
					},
					{
						id: "name",
						type: "text",
						pos: { x: 64, y: 396 },
						size: { width: 660, height: 70 },
						properties: {
							value: "{{display_name}}",
							font: {
								family: FONT,
								size: 58,
								weight: 700,
								letterSpacing: -1,
							},
							color: "#ffffff",
							fit: "shrink",
							verticalAlign: "bottom",
						},
					},
					{
						id: "since",
						type: "text",
						pos: { x: 64, y: 474 },
						size: { width: 500, height: 28 },
						properties: {
							value: "Member since {{member_since}}",
							font: { family: FONT, size: 20, weight: 400 },
							color: "#ddd6fe",
						},
					},
					{
						id: "member-id",
						type: "text",
						pos: { x: 64, y: 548 },
						size: { width: 500, height: 26 },
						properties: {
							value: "{{member_id}}",
							font: {
								family: FONT,
								size: 18,
								weight: 500,
								letterSpacing: 3,
							},
							color: "#ffffffa6",
						},
					},
					{
						id: "qr-panel",
						type: "frame",
						pos: { x: 772, y: 398 },
						size: { width: 176, height: 176 },
						shadow: { color: "#0f0a2e73", dx: 0, dy: 14, blur: 32 },
						properties: {
							fill: "#ffffff",
							cornerRadius: 24,
							children: [
								{
									id: "qr",
									type: "qr_code",
									pos: { x: 16, y: 16 },
									size: { width: 144, height: 144 },
									properties: {
										value: "{{profile_url}}",
										errorCorrection: "M",
										foreground: INK,
									},
								},
							],
						},
					},
				],
			},
			{
				name: "back",
				background: {
					id: "back-bg",
					type: "rect",
					properties: { fill: "#f8f7fc" },
				},
				elements: [
					{
						id: "stripe",
						type: "rect",
						pos: { x: 0, y: 52 },
						size: { width: 1012, height: 92 },
						properties: { fill: "#1f1b3a" },
					},
					{
						id: "watermark",
						type: "vector",
						pos: { x: 724, y: 392 },
						size: { width: 300, height: 300 },
						properties: { d: sparklePath(300), fill: "#6d28d90d" },
					},
					{
						id: "back-logo",
						type: "vector",
						pos: { x: 64, y: 212 },
						size: { width: 30, height: 30 },
						properties: { d: sparklePath(30), fill: "#6d28d9" },
					},
					{
						id: "back-wordmark",
						type: "text",
						pos: { x: 106, y: 214 },
						size: { width: 300, height: 26 },
						properties: {
							value: "LUMEN CLUB",
							font: {
								family: FONT,
								size: 19,
								weight: 700,
								letterSpacing: 3.5,
							},
							color: INK,
							verticalAlign: "middle",
						},
					},
					{
						id: "details",
						type: "frame",
						pos: { x: 64, y: 280 },
						size: { width: 500, height: 240 },
						properties: {
							layout: { direction: "column", gap: 20 },
							children: [
								detail("member", "Member", "{{display_name}}"),
								detail("level", "Tier", "{{tier}}"),
								detail("number", "Member ID", "{{member_id}}"),
							],
						},
					},
					{
						id: "signature",
						type: "rect",
						pos: { x: 596, y: 290 },
						size: { width: 352, height: 60 },
						properties: {
							fill: "#ffffff",
							stroke: { color: "#dcd8ea", width: 1 },
							cornerRadius: 8,
						},
					},
					{
						id: "signature-label",
						type: "text",
						pos: { x: 596, y: 360 },
						size: { width: 352, height: 18 },
						properties: {
							value: "Authorized signature",
							font: { family: FONT, size: 13, weight: 500 },
							color: "#7c7a93",
						},
					},
					{
						id: "fine-print",
						type: "text",
						pos: { x: 64, y: 548 },
						size: { width: 884, height: 40 },
						properties: {
							value:
								"If found, please return to Lumen Club · lumen.example. This card is not transferable and remains the property of the club.",
							font: { family: FONT, size: 13, lineHeight: 1.4 },
							color: "#8b89a3",
							maxLines: 2,
						},
					},
					{
						// 352 wide: two pixels a module at 1x for a 12-character member
						// ID such as "LC 0042 7781", quiet zones included.
						id: "member-barcode",
						type: "barcode",
						pos: { x: 596, y: 404 },
						size: { width: 352, height: 112 },
						properties: {
							value: "{{member_id}}",
							symbology: "code128",
							foreground: INK,
							textSize: 15,
						},
					},
				],
			},
		],
		variants: [
			{
				id: "midnight",
				label: "Midnight",
				swatch: "#18181b",
				overrides: [
					{
						name: "front",
						background: {
							id: "front-bg",
							type: "rect",
							properties: {
								fill: [
									{
										kind: "linear",
										angle: 125,
										stops: [
											{ offset: 0, color: "#09090b" },
											{ offset: 0.6, color: "#18181b" },
											{ offset: 1, color: "#292524" },
										],
									},
									{
										kind: "radial",
										center: [0.9, 0.05],
										radius: 0.6,
										stops: [
											{ offset: 0, color: "#fbbf2459" },
											{ offset: 1, color: "#fbbf2400" },
										],
									},
								],
							},
						},
						elements: [
							{ id: "name", properties: { color: "#fde68a" } },
							// The tier sits on the QR panel rather than in the corner.
							{ id: "tier-chip", properties: {}, pos: { x: 796, y: 334 } },
						],
					},
				],
			},
		],
	};
}
