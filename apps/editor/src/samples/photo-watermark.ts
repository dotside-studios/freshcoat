import type { Template } from "@freshcoat/coatfile";
import { FORMAT_VERSION } from "@freshcoat/coatfile";
import { VEND_SANS, VEND_SANS_FAMILY } from "./vend-sans";

const W = 1600;
const H = 1200;
const MARGIN = 48;
const MARK = { width: 720, height: 56 };
const LOGO = { width: 200, height: 96 };

/**
 * A photo with a mark in its bottom-right corner. The photo stretches with the
 * design and the mark and logo keep their offset from the bottom-right, so the
 * same template follows every photo's size and orientation.
 */
export function photoWatermark(): Template {
	const markY = H - MARGIN - MARK.height;
	return {
		format_version: FORMAT_VERSION,
		id: "photo-watermark",
		name: "Photo watermark",
		description:
			"A full-bleed photo with a text mark and an optional logo pinned to the bottom-right corner.",
		version: "1.0.0",
		width: W,
		height: H,
		fonts: [VEND_SANS],
		fields: {
			type: "object",
			properties: {
				photo: { type: "string", title: "Photo", format: "image" },
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
						properties: { src: "{{photo}}", fit: "cover" },
					},
					{
						id: "logo",
						type: "image",
						pos: {
							x: W - MARGIN - LOGO.width,
							y: markY - 16 - LOGO.height,
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
	};
}
