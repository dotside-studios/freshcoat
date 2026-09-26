import type { Element, Template } from "@freshcoat/coatfile";
import { FORMAT_VERSION } from "@freshcoat/coatfile";
import { ellipsePath, sparklePath } from "./shapes";
import { VEND_SANS, VEND_SANS_FAMILY } from "./vend-sans";

const FONT = VEND_SANS_FAMILY;
const GOLD = "#b08d57";

function hugText(
	id: string,
	value: string,
	font: {
		size: number;
		weight?: 400 | 500 | 600 | 700;
		letterSpacing?: number;
	},
	color: string,
	extra: Record<string, unknown> = {},
): Element {
	return {
		id,
		type: "text",
		size: { width: 400, height: font.size * 1.3 },
		layoutChild: { width: "hug", height: "hug" },
		properties: {
			value,
			font: { family: FONT, ...font },
			color,
			...extra,
		},
	} as Element;
}

function signatureBlock(id: string, value: string, caption: string): Element {
	return {
		id,
		type: "frame",
		size: { width: 210, height: 64 },
		properties: {
			layout: { direction: "column", gap: 6, crossAlign: "center" },
			children: [
				{
					id: `${id}-line`,
					type: "rect",
					size: { width: 210, height: 1 },
					properties: { fill: "#8a8377" },
				},
				hugText(`${id}-value`, value, { size: 15, weight: 600 }, "#1f1a14"),
				hugText(
					`${id}-caption`,
					caption,
					{ size: 11, weight: 500, letterSpacing: 1.6 },
					"#8a8377",
					{ case: "upper" },
				),
			],
		},
	};
}

export function certificate(): Template {
	return {
		format_version: FORMAT_VERSION,
		id: "certificate",
		name: "Certificate",
		description:
			"An A4 landscape certificate laid out with auto layout, with a masked seal.",
		version: "1.0.0",
		width: 842,
		height: 595,
		fields: {
			type: "object",
			properties: {
				recipient: {
					type: "string",
					title: "Recipient",
					default: "Jordan Lee",
				},
				achievement: {
					type: "string",
					title: "Achievement",
					format: "longText",
					default:
						"For outstanding contributions to open design tooling, and for an unwavering commitment to craft.",
				},
				issuer: {
					type: "string",
					title: "Issuer",
					default: "Freshcoat Studio",
				},
				date: { type: "string", title: "Date", default: "24 September 2026" },
			},
			required: ["recipient"],
		},
		fonts: [VEND_SANS],
		template_data: [
			{
				name: "page",
				background: {
					id: "paper",
					type: "rect",
					properties: {
						fill: [
							"#fbf8f1",
							{
								kind: "radial",
								center: [0.5, 0.35],
								radius: 0.7,
								stops: [
									{ offset: 0, color: "#ffffffcc" },
									{ offset: 1, color: "#ffffff00" },
								],
							},
						],
					},
				},
				elements: [
					{
						id: "border",
						type: "frame",
						pos: { x: 20, y: 20 },
						size: { width: 802, height: 555 },
						properties: {
							stroke: { color: GOLD, width: 2 },
							cornerRadius: 6,
							children: [],
						},
					},
					{
						id: "border-inner",
						type: "frame",
						pos: { x: 30, y: 30 },
						size: { width: 782, height: 535 },
						properties: {
							stroke: { color: "#b08d5773", width: 1 },
							cornerRadius: 3,
							children: [],
						},
					},
					{
						id: "content",
						type: "frame",
						pos: { x: 96, y: 58 },
						size: { width: 650, height: 482 },
						properties: {
							layout: { direction: "column", gap: 12, crossAlign: "center" },
							children: [
								{
									id: "seal",
									type: "frame",
									size: { width: 84, height: 84 },
									properties: {
										children: [
											{
												id: "seal-disc",
												type: "vector",
												size: { width: 84, height: 84 },
												shadow: {
													color: "#8a6a3a59",
													dx: 0,
													dy: 6,
													blur: 14,
												},
												properties: {
													d: ellipsePath(84, 84),
													fill: {
														kind: "linear",
														angle: 135,
														stops: [
															{ offset: 0, color: "#ecd08f" },
															{ offset: 0.5, color: GOLD },
															{ offset: 1, color: "#7d5f33" },
														],
													},
												},
											},
											{
												id: "seal-face",
												type: "mask",
												pos: { x: 8, y: 8 },
												size: { width: 68, height: 68 },
												properties: {
													mask: {
														id: "seal-face-shape",
														type: "vector",
														size: { width: 68, height: 68 },
														properties: {
															d: ellipsePath(68, 68),
															fill: "#000000",
														},
													},
													children: [
														{
															id: "seal-sheen",
															type: "rect",
															size: { width: 68, height: 68 },
															properties: {
																fill: {
																	kind: "radial",
																	center: [0.32, 0.26],
																	radius: 0.85,
																	stops: [
																		{ offset: 0, color: "#fff5d6" },
																		{ offset: 0.55, color: "#d8b46e" },
																		{ offset: 1, color: "#9c7a44" },
																	],
																},
															},
														},
														{
															id: "seal-mark",
															type: "vector",
															pos: { x: 16, y: 16 },
															size: { width: 36, height: 36 },
															properties: {
																d: sparklePath(36),
																fill: "#7d5f33",
															},
														},
													],
												},
											},
										],
									},
								},
								hugText(
									"title",
									"Certificate of achievement",
									{ size: 15, weight: 700, letterSpacing: 5 },
									"#8a6a3a",
									{ case: "upper" },
								),
								hugText(
									"intro",
									"This certifies that",
									{ size: 16 },
									"#6b6459",
								),
								{
									id: "recipient",
									type: "text",
									size: { width: 650, height: 64 },
									layoutChild: { width: "fill", height: "hug" },
									properties: {
										value: "{{recipient}}",
										font: {
											family: FONT,
											size: 52,
											weight: 700,
											letterSpacing: -1,
										},
										color: "#1f1a14",
										align: "center",
										maxLines: 1,
									},
								},
								{
									id: "rule",
									type: "rect",
									size: { width: 240, height: 2 },
									properties: {
										fill: {
											kind: "linear",
											angle: 0,
											stops: [
												{ offset: 0, color: "#b08d5700" },
												{ offset: 0.5, color: GOLD },
												{ offset: 1, color: "#b08d5700" },
											],
										},
									},
								},
								{
									id: "achievement",
									type: "text",
									size: { width: 520, height: 50 },
									layoutChild: { width: "fixed", height: "hug" },
									properties: {
										value: "{{achievement}}",
										font: { family: FONT, size: 17, lineHeight: 1.5 },
										color: "#4a443b",
										align: "center",
										maxLines: 4,
									},
								},
								{
									id: "spacer",
									type: "rect",
									size: { width: 1, height: 1 },
									layoutChild: { grow: 1 },
									properties: {},
								},
								{
									id: "signatures",
									type: "frame",
									size: { width: 560, height: 64 },
									properties: {
										layout: {
											direction: "row",
											primaryAlign: "space-between",
											crossAlign: "end",
										},
										children: [
											signatureBlock("issuer-block", "{{issuer}}", "Issued by"),
											signatureBlock("date-block", "{{date}}", "Date"),
										],
									},
								},
							],
						},
					},
				],
			},
		],
	};
}
