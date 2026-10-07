import type { Dataset, ExportPreset, Workspace } from "@freshcoat-js/workspace";
import {
	type JobFile,
	type JobProgress,
	runExportJob,
} from "@freshcoat-js/workspace/export";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { createWorkerPool } from "~/export/worker-pool";
import { resolveTemplateFonts } from "~/render/fonts";
import { membershipCard } from "~/samples/membership-card";

const TIERS = ["Gold", "Silver", "Bronze"];

function workspace(count: number): Workspace {
	const template = membershipCard();
	const keys = Object.keys(template.fields?.properties ?? {});
	const dataset: Dataset = {
		id: "d_members",
		name: "Members",
		columns: keys.map((key) => ({ key, type: "text" as const })),
		records: Array.from({ length: count }, (_, i) => ({
			id: `r_${String(i + 1).padStart(4, "0")}`,
			status: "pending" as const,
			values: {
				display_name: `Member ${i + 1}`,
				tier: TIERS[i % TIERS.length],
				profile_url: `https://example.com/u/${i + 1}`,
				member_since: String(2000 + (i % 25)),
				member_id: `LC ${String(i + 1).padStart(4, "0")} 0000`,
				verified: i % 2 === 0 ? "true" : "false",
			},
		})),
		assets: [],
	};
	return {
		formatVersion: "1.0",
		name: "Probe",
		templates: [
			{
				id: "t_card",
				fileName: "membership-card.coat",
				template,
				binding: {
					datasetId: dataset.id,
					fields: Object.fromEntries(
						keys.map((key) => [key, { kind: "column" as const, column: key }]),
					),
				},
			},
		],
		datasets: [dataset],
		presets: [],
	};
}

function preset(overrides: Partial<ExportPreset>): ExportPreset {
	return {
		id: "p_probe",
		name: "Members",
		templateId: "t_card",
		records: "all",
		sides: "all",
		format: "png-zip",
		scale: 1,
		dpi: 300,
		fileName: "{{member_id}}-{{side}}",
		markExported: true,
		...overrides,
	};
}

async function fileBytes(file: JobFile | undefined): Promise<Uint8Array> {
	return file
		? new Uint8Array(await file.blob.arrayBuffer())
		: new Uint8Array();
}

function pngSize(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function setup(ws: Workspace) {
	const pool = createWorkerPool();
	const t0 = performance.now();
	const { fonts } = await resolveTemplateFonts(ws.templates[0].template);
	await pool.init(fonts);
	return { pool, initMs: performance.now() - t0 };
}

export async function runZipProbe(count: number, scale = 1) {
	const ws = workspace(count);
	const { pool, initMs } = await setup(ws);
	const progress: JobProgress[] = [];
	try {
		const result = await runExportJob(ws, preset({ scale }), {
			pool,
			onProgress: (p) => progress.push(p),
		});
		const zip = await fileBytes(result.file);
		const files = unzipSync(zip);
		const names = Object.keys(files);
		const pngs = names
			.filter((n) => n.endsWith(".png"))
			.map((name) => ({ name, ...pngSize(files[name]) }));
		return {
			poolSize: pool.size,
			initMs,
			ms: result.ms,
			itemsPerSecond: (result.items.length / result.ms) * 1000,
			fileName: result.file?.name,
			zipBytes: zip.length,
			names,
			pngs,
			report: strFromU8(files["export-report.csv"] ?? new Uint8Array()),
			failed: result.items.filter((i) => !i.ok),
			progressEvents: progress.length,
			lastProgress: progress.at(-1),
			template: {
				width: ws.templates[0].template.width,
				height: ws.templates[0].template.height,
			},
		};
	} finally {
		pool.dispose();
	}
}

export async function runPdfProbe(count: number, dpi: number) {
	const ws = workspace(count);
	const { pool } = await setup(ws);
	try {
		const result = await runExportJob(ws, preset({ format: "pdf", dpi }), {
			pool,
		});
		const doc = await PDFDocument.load(await fileBytes(result.file));
		return {
			fileName: result.file?.name,
			mediaType: result.file?.mediaType,
			pages: doc.getPages().map((p) => p.getSize()),
			title: doc.getTitle(),
			failed: result.items.filter((i) => !i.ok),
		};
	} finally {
		pool.dispose();
	}
}

export async function runCancelProbe(count: number) {
	const ws = workspace(count);
	const { pool } = await setup(ws);
	const controller = new AbortController();
	let progressEvents = 0;
	try {
		const t0 = performance.now();
		let abortedAt = 0;
		const result = await runExportJob(ws, preset({}), {
			pool,
			signal: controller.signal,
			onProgress: () => {
				progressEvents++;
				if (!controller.signal.aborted) {
					abortedAt = performance.now();
					controller.abort();
				}
			},
		});
		const settleMs = performance.now() - abortedAt;
		// the pool is usable after a cancel: terminated workers come back lazily
		const after = await runExportJob(workspace(1), preset({}), { pool });
		return {
			cancelled: result.cancelled,
			hasFile: result.file !== undefined,
			items: result.items.length,
			progressEvents,
			settleMs,
			ms: performance.now() - t0,
			afterOk: after.items.every((i) => i.ok) && after.file !== undefined,
		};
	} finally {
		pool.dispose();
	}
}

/** Two photo records through the pool: each worker gets the photos as Blobs
 *  and reads the bytes of the one it renders. Returns each output's centre
 *  pixel. */
export async function runPhotoProbe() {
	const { FORMAT_VERSION } = await import("@freshcoat-js/coatfile");
	const { photoDataset, prepareAssets } = await import(
		"@freshcoat-js/workspace"
	);
	const photo = async (fill: string) => {
		const c = new OffscreenCanvas(1200, 800);
		const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
		g.fillStyle = fill;
		g.fillRect(0, 0, 1200, 800);
		return c.convertToBlob({ type: "image/jpeg" });
	};
	const prepared = await prepareAssets([
		{ name: "red.jpg", blob: await photo("#ff0000") },
		{ name: "green.jpg", blob: await photo("#00ff00") },
	]);
	const dataset = photoDataset("Photos", prepared, "d_photos");
	const ws: Workspace = {
		formatVersion: "1.0",
		name: "Photos",
		templates: [
			{
				id: "t_card",
				fileName: "photo.coat",
				template: {
					format_version: FORMAT_VERSION,
					id: "photo",
					name: "Photo",
					version: "1.0.0",
					width: 300,
					height: 200,
					fields: {
						type: "object",
						properties: {
							photo: { type: "string", title: "Photo", format: "image" },
						},
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
									id: "img",
									type: "image",
									pos: { x: 0, y: 0 },
									size: { width: 300, height: 200 },
									properties: { src: "{{photo}}", fit: "cover" },
								},
							],
						},
					],
				},
				binding: {
					datasetId: dataset.id,
					fields: { photo: { kind: "column", column: "photo" } },
				},
			},
		],
		datasets: [dataset],
		presets: [],
	};
	const { pool } = await setup(ws);
	try {
		const result = await runExportJob(
			ws,
			preset({ fileName: "{{file_name}}" }),
			{ pool },
		);
		const files = unzipSync(await fileBytes(result.file));
		const out: Record<string, number[]> = {};
		for (const [name, bytes] of Object.entries(files)) {
			if (!name.endsWith(".png")) continue;
			const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
			const c = new OffscreenCanvas(bmp.width, bmp.height);
			const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
			g.drawImage(bmp, 0, 0);
			out[name] = [...g.getImageData(150, 100, 1, 1).data];
		}
		return { pixels: out, failed: result.items.filter((i) => !i.ok) };
	} finally {
		pool.dispose();
	}
}

/** A JPEG or WebP zip of `count` records: each file's name and first bytes. */
export async function runFormatProbe(
	count: number,
	format: "jpeg-zip" | "webp-zip",
) {
	const ws = workspace(count);
	const { pool } = await setup(ws);
	try {
		const result = await runExportJob(ws, preset({ format, quality: 80 }), {
			pool,
		});
		const files = unzipSync(await fileBytes(result.file));
		return {
			failed: result.items.filter((i) => !i.ok),
			files: Object.entries(files).map(([name, bytes]) => ({
				name,
				head: Array.from(bytes.subarray(0, 12)),
			})),
		};
	} finally {
		pool.dispose();
	}
}
