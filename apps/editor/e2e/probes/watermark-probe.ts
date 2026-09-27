import type { Dataset, ExportPreset, Workspace } from "@freshcoat-js/workspace";
import { photoDataset, prepareAssets } from "@freshcoat-js/workspace";
import { largestImagePixels, runExportJob } from "~/export/job";
import { createPartZipSink } from "~/export/sinks";
import { createWorkerPool, defaultPoolSize } from "~/export/worker-pool";
import { resolveTemplateFonts } from "~/render/fonts";
import { photoWatermark } from "~/samples/photo-watermark";

export type PhotoSpec = {
	name: string;
	/** stored pixels */
	width: number;
	height: number;
	/** EXIF orientation written into the file, 1 when absent */
	orientation?: number;
	/** the top half's colour; the bottom half is BOTTOM */
	top: [number, number, number];
	/** fine noise, which makes a JPEG as large as a camera's */
	noise?: boolean;
};

export const BOTTOM: [number, number, number] = [32, 32, 32];

/** An APP1 Exif segment carrying only an Orientation tag. */
function exifOrientation(orientation: number): Uint8Array {
	const tiff = [
		0x49,
		0x49,
		0x2a,
		0x00,
		0x08,
		0x00,
		0x00,
		0x00,
		0x01,
		0x00,
		0x12,
		0x01,
		0x03,
		0x00,
		0x01,
		0x00,
		0x00,
		0x00,
		orientation,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
	];
	const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
	const length = body.length + 2;
	return Uint8Array.from([0xff, 0xe1, length >> 8, length & 0xff, ...body]);
}

/** Puts an Exif segment after the JFIF one the encoder wrote. */
function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
	let at = 2;
	if (jpeg[2] === 0xff && jpeg[3] === 0xe0)
		at = 4 + (((jpeg[4] as number) << 8) | (jpeg[5] as number));
	const exif = exifOrientation(orientation);
	const out = new Uint8Array(jpeg.length + exif.length);
	out.set(jpeg.subarray(0, at));
	out.set(exif, at);
	out.set(jpeg.subarray(at), at + exif.length);
	return out;
}

let noiseTile: ImageBitmap | null = null;
async function noise(): Promise<ImageBitmap> {
	if (noiseTile) return noiseTile;
	const size = 256;
	const data = new ImageData(size, size);
	for (let i = 0; i < data.data.length; i += 4) {
		const v = Math.random() * 255;
		data.data[i] = v;
		data.data[i + 1] = v;
		data.data[i + 2] = v;
		data.data[i + 3] = 40;
	}
	noiseTile = await createImageBitmap(data);
	return noiseTile;
}

/** A JPEG File: the top half in `top`, the bottom half dark, as stored. */
export async function makePhoto(spec: PhotoSpec): Promise<File> {
	const c = new OffscreenCanvas(spec.width, spec.height);
	const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
	g.fillStyle = `rgb(${spec.top.join(",")})`;
	g.fillRect(0, 0, spec.width, spec.height / 2);
	g.fillStyle = `rgb(${BOTTOM.join(",")})`;
	g.fillRect(0, spec.height / 2, spec.width, spec.height - spec.height / 2);
	if (spec.noise) {
		const tile = await noise();
		g.fillStyle = g.createPattern(tile, "repeat") as CanvasPattern;
		g.fillRect(0, 0, spec.width, spec.height);
	}
	const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
	let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
	if (spec.orientation && spec.orientation !== 1)
		bytes = withOrientation(bytes, spec.orientation);
	return new File([bytes as BlobPart], spec.name, { type: "image/jpeg" });
}

export async function makePhotos(specs: PhotoSpec[]): Promise<File[]> {
	const out: File[] = [];
	for (const spec of specs) out.push(await makePhoto(spec));
	return out;
}

/** RGBA of points given as fractions of each image, decoded upright. */
export async function samplePixels(
	bytes: Uint8Array,
	points: [number, number][],
): Promise<{ width: number; height: number; pixels: number[][] }> {
	const bmp = await createImageBitmap(new Blob([bytes as BlobPart]), {
		imageOrientation: "from-image",
	});
	const c = new OffscreenCanvas(bmp.width, bmp.height);
	const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
	g.drawImage(bmp, 0, 0);
	const pixels = points.map(([fx, fy]) => [
		...g.getImageData(
			Math.min(bmp.width - 1, Math.floor(fx * bmp.width)),
			Math.min(bmp.height - 1, Math.floor(fy * bmp.height)),
			1,
			1,
		).data,
	]);
	return { width: bmp.width, height: bmp.height, pixels };
}

/** How many pixels inside a box, in fractions of the image, are brighter
 *  than `floor` on every channel: the white mark on a dark or coloured
 *  photo. */
export async function brightPixels(
	bytes: Uint8Array,
	box: { x0: number; y0: number; x1: number; y1: number },
	floor = 150,
): Promise<number> {
	const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
	const c = new OffscreenCanvas(bmp.width, bmp.height);
	const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
	g.drawImage(bmp, 0, 0);
	const x = Math.floor(box.x0);
	const y = Math.floor(box.y0);
	const w = Math.max(1, Math.floor(box.x1 - box.x0));
	const h = Math.max(1, Math.floor(box.y1 - box.y0));
	const data = g.getImageData(x, y, w, h).data;
	let n = 0;
	for (let i = 0; i < data.length; i += 4)
		if (
			(data[i] as number) > floor &&
			(data[i + 1] as number) > floor &&
			(data[i + 2] as number) > floor
		)
			n++;
	return n;
}

function photoWorkspace(dataset: Dataset): Workspace {
	return {
		formatVersion: "1.0",
		name: "Photos",
		templates: [
			{
				id: "t_mark",
				fileName: "photo-watermark.coat",
				template: photoWatermark(),
				binding: {
					datasetId: dataset.id,
					fields: { photo: { kind: "column", column: "photo" } },
				},
			},
		],
		datasets: [dataset],
		presets: [],
	};
}

const PRESET: ExportPreset = {
	id: "p_mark",
	name: "Marked",
	templateId: "t_mark",
	records: "all",
	sides: "all",
	format: "jpeg-zip",
	size: { kind: "image", field: "photo" },
	quality: 85,
	scale: 1,
	dpi: 300,
	fileName: "{{index}}",
	markExported: true,
};

type HeapSample = { at: number; used: number };

function usedHeap(): number {
	return (
		(performance as Performance & { memory?: { usedJSHeapSize: number } })
			.memory?.usedJSHeapSize ?? 0
	);
}

async function settleGc() {
	const gc = (globalThis as { gc?: () => void }).gc;
	gc?.();
	await new Promise((r) => setTimeout(r, 50));
}

/** A generated photo's bytes, base64, for a test to write to disk. */
export async function photoBase64(spec: PhotoSpec): Promise<string> {
	const bytes = new Uint8Array(await (await makePhoto(spec)).arrayBuffer());
	let text = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

/**
 * The photos picked in the file input `selector`, imported as a photo
 * dataset through the workspace API, then watermarked at their own size as
 * JPEG into zip parts of `partBytes`. Picked files are read from disk as
 * they are used, as a user's photos are. Samples the main thread's heap while
 * it runs.
 */
export async function runWatermarkExport(opts: {
	selector: string;
	partBytes: number;
}) {
	const t0 = performance.now();
	const input = document.querySelector(opts.selector) as HTMLInputElement;
	const files = [...(input.files ?? [])];
	const prepared = await prepareAssets(
		files.map((f) => ({ name: f.name, blob: f })),
	);
	const importMs = performance.now() - t0;
	const dataset = photoDataset("Photos", prepared, "d_photos");
	const ws = photoWorkspace(dataset);
	const sourceBytes = dataset.assets.reduce((n, a) => n + a.size, 0);

	const largest = largestImagePixels(ws, PRESET);
	const pool = createWorkerPool(defaultPoolSize(largest));
	const { fonts } = await resolveTemplateFonts(photoWatermark());
	await pool.init(fonts);

	const parts: { name: string; bytes: number }[] = [];
	await settleGc();
	const baseline = usedHeap();
	const samples: HeapSample[] = [];
	const started = performance.now();
	const timer = setInterval(
		() => samples.push({ at: performance.now() - started, used: usedHeap() }),
		100,
	);
	try {
		const sink = createPartZipSink({
			name: "marked",
			partBytes: opts.partBytes,
			// a real download would hand the Blob to the browser; keep its size
			onPart: (file) => parts.push({ name: file.name, bytes: file.blob.size }),
		});
		const result = await runExportJob(ws, PRESET, { pool, sink });
		const ms = performance.now() - started;
		if (result.file)
			parts.push({ name: result.file.name, bytes: result.file.blob.size });
		samples.push({ at: ms, used: usedHeap() });
		const peak = Math.max(...samples.map((s) => s.used));
		return {
			count: files.length,
			importMs,
			sourceBytes,
			ms,
			itemsPerSecond: (result.items.length / ms) * 1000,
			ok: result.items.filter((i) => i.ok).length,
			failed: result.items.filter((i) => !i.ok),
			parts,
			stats: result.stats,
			poolSize: pool.size,
			largestImagePixels: largest,
			heap: {
				baseline,
				peak,
				growth: peak - baseline,
				available: usedHeap() > 0,
			},
		};
	} finally {
		clearInterval(timer);
		pool.dispose();
	}
}
