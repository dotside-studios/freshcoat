import type { Element, Template } from "@freshcoat-js/coatfile";
import { bytesToBase64, FORMAT_VERSION } from "@freshcoat-js/coatfile";
import { VEND_SANS, VEND_SANS_FAMILY } from "./vend-sans";

const W = 2400;
const H = 1600;
const PHOTO = { width: 3000, height: 2000 };
const COLUMNS = 6;
const ROWS = 6;

/**
 * A bench-only worst case for the live preview: a 6 MP photo drawn four
 * times with colour adjustments, rounded corners and stacked shadows, a
 * blurred overlay, and 36 shadowed text layers. The photo is noise over a
 * gradient, so it neither compresses nor decodes cheaply, and is made in the
 * page from a fixed seed, so every run paints the same pixels.
 */
export async function stress(): Promise<Template> {
	const photo = await noisePhoto(PHOTO.width, PHOTO.height);
	const src = `asset:${photo.sha256}`;
	const shadow = [
		{ color: "#0000004d", dx: 0, dy: 24, blur: 48 },
		{ color: "#00000033", dx: 0, dy: 4, blur: 12 },
	];
	const cards: Element[] = [0, 1, 2].map((i) => ({
		id: `card-${i}`,
		type: "image",
		pos: { x: 160 + i * 720, y: 180 },
		size: { width: 600, height: 420 },
		rotation: (i - 1) * 4,
		shadow,
		adjust: { saturation: 0.4 + i * 0.5, contrast: 1.2, sharpen: 0.6 },
		properties: {
			src,
			fit: "cover",
			focus: [0.2 + i * 0.3, 0.5],
			cornerRadius: 32,
		},
	}));
	const labels: Element[] = Array.from({ length: COLUMNS * ROWS }, (_, i) => {
		const col = i % COLUMNS;
		const row = Math.floor(i / COLUMNS);
		return {
			id: `label-${i}`,
			type: "text",
			pos: { x: 120 + col * 370, y: 720 + row * 140 },
			size: { width: 340, height: 120 },
			shadow: { color: "#000000aa", dx: 0, dy: 3, blur: 10 },
			properties: {
				value: `Label ${i + 1}: the quick brown fox jumps over the lazy dog`,
				font: {
					family: VEND_SANS_FAMILY,
					size: 28 + (i % 3) * 6,
					weight: i % 2 ? 700 : 400,
				},
				color: "#ffffff",
				maxLines: 3,
			},
		};
	});
	return {
		format_version: FORMAT_VERSION,
		id: "stress",
		name: "Stress",
		description: "A bench-only worst case for the live preview.",
		version: "1.0.0",
		width: W,
		height: H,
		fonts: [VEND_SANS],
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#101418" },
				},
				elements: [
					{
						id: "hero",
						type: "image",
						pos: { x: 0, y: 0 },
						size: { width: W, height: H },
						adjust: { saturation: 1.4, contrast: 1.15, sharpen: 0.5 },
						properties: { src, fit: "cover" },
					},
					{
						id: "veil",
						type: "rect",
						pos: { x: 80, y: 660 },
						size: { width: W - 160, height: 880 },
						blur: 16,
						opacity: 0.55,
						properties: { fill: "#0b1020", cornerRadius: 40 },
					},
					...cards,
					...labels,
				],
			},
		],
		assets: [photo],
	};
}

/** A JPEG of seeded noise over a gradient, as an inline asset. */
async function noisePhoto(width: number, height: number) {
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2D canvas to draw the stress photo");
	const image = ctx.createImageData(width, height);
	const px = image.data;
	let seed = 0x9e3779b9;
	const random = () => {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		return (seed >>> 0) / 0x100000000;
	};
	for (let y = 0; y < height; y++) {
		const t = y / height;
		for (let x = 0; x < width; x++) {
			const s = x / width;
			const n = (random() - 0.5) * 90;
			const i = (y * width + x) * 4;
			px[i] = 200 * (1 - t) + 40 * s + n;
			px[i + 1] = 120 + 80 * Math.sin(s * 9 + t * 5) + n;
			px[i + 2] = 60 + 160 * t + n;
			px[i + 3] = 255;
		}
	}
	ctx.putImageData(image, 0, 0);
	const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return {
		sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
		base64: bytesToBase64(bytes),
		contentType: "image/jpeg",
	};
}
