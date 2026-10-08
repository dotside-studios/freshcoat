import type { Template } from "@freshcoat-js/coatfile";
import { FORMAT_VERSION } from "@freshcoat-js/coatfile";
import { VEND_SANS, VEND_SANS_FAMILY } from "./vend-sans";

const W = 1800;
const H = 1200;
const MARGIN = 48;
const MARK = { width: 720, height: 56 };
const LOGO = { width: 200, height: 96 };
const GAP = 16;

/**
 * A photo with a mark in its bottom-right corner, in a landscape, portrait
 * and square variant. Each record takes the variant closest to its photo's
 * shape, and its photo is cropped around the point in `photo_focus`.
 */
export function photoWatermark(): Template {
	const markY = H - MARGIN - MARK.height;
	return {
		format_version: FORMAT_VERSION,
		id: "photo-watermark",
		name: "Photo watermark",
		description:
			"A full-bleed photo with a text mark and an optional logo, in landscape, portrait and square.",
		version: "2.0.0",
		width: W,
		height: H,
		fonts: [VEND_SANS],
		fields: {
			type: "object",
			properties: {
				photo: { type: "string", title: "Photo", format: "image" },
				photo_focus: {
					type: "string",
					title: "Photo focus",
					description: "The point kept in view when the photo is cropped",
					default: "",
				},
				watermark: {
					type: "string",
					title: "Watermark",
					default: "© Your Studio",
					maxLength: 64,
				},
				// Empty by default, and the logo layer shows only once it is set.
				logo: { type: "string", title: "Logo", format: "image", default: "" },
			},
			required: ["photo"],
		},
		template_data: [
			{
				name: "photo",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#1f2328" },
				},
				elements: [
					{
						id: "photo",
						type: "image",
						pos: { x: 0, y: 0 },
						size: { width: W, height: H },
						constraints: { horizontal: "stretch", vertical: "stretch" },
						properties: {
							src: "{{photo}}",
							fit: "cover",
							focus: "{{photo_focus}}",
						},
					},
					{
						id: "logo",
						type: "image",
						pos: {
							x: W - MARGIN - LOGO.width,
							y: markY - GAP - LOGO.height,
						},
						size: LOGO,
						opacity: 0.6,
						visibleWhen: { field: "logo" },
						constraints: { horizontal: "end", vertical: "end" },
						properties: { src: "{{logo}}", fit: "contain" },
					},
					{
						id: "watermark",
						type: "text",
						pos: { x: W - MARGIN - MARK.width, y: markY },
						size: MARK,
						opacity: 0.6,
						constraints: { horizontal: "end", vertical: "end" },
						shadow: { color: "#00000059", dx: 0, dy: 2, blur: 8 },
						properties: {
							value: "{{watermark}}",
							font: { family: VEND_SANS_FAMILY, size: 40, weight: 600 },
							color: "#ffffff",
							align: "right",
							verticalAlign: "bottom",
							fit: "shrink",
							maxLines: 1,
						},
					},
				],
			},
		],
		variants: [
			{
				id: "portrait",
				label: "Portrait",
				size: { width: H, height: W },
				overrides: [
					{
						name: "photo",
						elements: [
							{
								id: "watermark",
								properties: { align: "center" },
								pos: { x: MARGIN, y: W - MARGIN - MARK.height },
								size: { width: H - 2 * MARGIN, height: MARK.height },
							},
							{
								id: "logo",
								properties: {},
								pos: {
									x: (H - LOGO.width) / 2,
									y: W - MARGIN - MARK.height - GAP - LOGO.height,
								},
							},
						],
					},
				],
			},
			{
				id: "square",
				label: "Square",
				size: { width: H, height: H },
				overrides: [],
			},
		],
	};
}
