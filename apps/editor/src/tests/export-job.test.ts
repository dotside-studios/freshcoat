// @vitest-environment node

import { crc32 } from "node:zlib";
import type {
	Dataset,
	ExportPreset,
	PdfPage,
	Workspace,
} from "@freshcoat-js/workspace";
import {
	type AssemblePdf,
	createPartZipSink,
	itemSize,
	type JobPool,
	type JobProgress,
	type JobResult,
	type OutputSink,
	presetBleed,
	REPORT_FILE_NAME,
	type RenderOutput,
	type RenderRequest,
	runExportJob,
} from "@freshcoat-js/workspace/export";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { membershipCard } from "~/samples/membership-card";
import { photoWatermark } from "~/samples/photo-watermark";

function dataset(count: number): Dataset {
	return {
		id: "d_1",
		name: "Members",
		columns: [
			{ key: "display_name", type: "text" },
			{ key: "photo", type: "image" },
		],
		records: Array.from({ length: count }, (_, i) => ({
			id: `r_${i + 1}`,
			values: { display_name: `Member ${i + 1}` },
			status: "pending" as const,
		})),
		assets: [
			{
				sha256: "abc",
				contentType: "image/png",
				name: "a.png",
				size: 1,
				blob: new Blob([new Uint8Array([7])]),
			},
		],
	};
}

function workspace(count: number, bound = true): Workspace {
	return {
		formatVersion: "1.0",
		name: "Club",
		templates: [
			{
				id: "t_1",
				fileName: "Membership card.coat",
				template: membershipCard(),
				...(bound
					? {
							binding: {
								datasetId: "d_1",
								fields: {
									display_name: { kind: "column", column: "display_name" },
								},
							},
						}
					: {}),
			},
		],
		datasets: [dataset(count)],
		presets: [],
	};
}

function preset(overrides: Partial<ExportPreset> = {}): ExportPreset {
	return {
		id: "p_1",
		name: "All members",
		templateId: "t_1",
		records: "all",
		sides: "all",
		format: "png-zip",
		scale: 1,
		dpi: 300,
		fileName: "{{index}}-{{side}}",
		markExported: true,
		...overrides,
	};
}

const encoder = new TextEncoder();

async function unzipped(result: JobResult) {
	const blob = result.file?.blob;
	if (!blob) throw new Error("no file");
	return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

/** A pool that answers every render after `delay(request)` ms, with bytes
 *  naming what was asked, or fails the ones `fail` names. */
function fakePool(
	opts: {
		size?: number;
		fail?: (req: RenderRequest) => string | undefined;
		delay?: (req: RenderRequest) => number;
	} = {},
) {
	const requests: RenderRequest[] = [];
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const pending = new Set<(e: Error) => void>();
	let inFlight = 0;
	let maxInFlight = 0;
	const pool: JobPool & {
		requests: RenderRequest[];
		cancelled: number;
		maxInFlight(): number;
	} = {
		size: opts.size ?? 2,
		requests,
		cancelled: 0,
		maxInFlight: () => maxInFlight,
		render(req) {
			requests.push(req);
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			return new Promise<RenderOutput>((resolve, reject) => {
				pending.add(reject);
				const timer = setTimeout(() => {
					timers.delete(timer);
					pending.delete(reject);
					inFlight--;
					const error = opts.fail?.(req);
					if (error) reject(new Error(error));
					else
						resolve({
							bytes: encoder.encode(`${req.values.display_name}|${req.side}`),
							format: req.format,
							width: Math.round(1012 * req.scale),
							height: Math.round(638 * req.scale),
							ms: 1,
						});
				}, opts.delay?.(req) ?? 0);
				timers.add(timer);
			});
		},
		cancel() {
			pool.cancelled++;
			for (const t of timers) clearTimeout(t);
			timers.clear();
			for (const reject of pending) reject(new Error("cancelled"));
			pending.clear();
			inFlight = 0;
		},
	};
	return pool;
}

describe("runExportJob", () => {
	it("reports progress after every item and keeps concurrency at the pool size", async () => {
		const pool = fakePool({ size: 2 });
		const progress: JobProgress[] = [];
		let clock = 0;
		const result = await runExportJob(workspace(3), preset(), {
			pool,
			onProgress: (p) => progress.push(p),
			now: () => (clock += 10),
		});
		expect(result.cancelled).toBe(false);
		expect(progress.map((p) => [p.done, p.failed, p.total])).toEqual([
			[1, 0, 6],
			[2, 0, 6],
			[3, 0, 6],
			[4, 0, 6],
			[5, 0, 6],
			[6, 0, 6],
		]);
		expect(progress.at(-1)?.etaMs).toBe(0);
		expect(progress[0].etaMs).toBeGreaterThan(0);
		expect(pool.maxInFlight()).toBe(2);
		expect(pool.requests.map((r) => [r.values.display_name, r.side])).toEqual([
			["Member 1", "front"],
			["Member 1", "back"],
			["Member 2", "front"],
			["Member 2", "back"],
			["Member 3", "front"],
			["Member 3", "back"],
		]);
		expect(result.ms).toBeGreaterThan(0);
	});

	it("under All variants, renders and writes one file per variant", async () => {
		const pool = fakePool();
		const ws = workspace(2);
		const entry = ws.templates[0] as Workspace["templates"][number];
		entry.binding = {
			datasetId: "d_1",
			fields: { display_name: { kind: "column", column: "display_name" } },
			variant: { kind: "all" },
		};
		const result = await runExportJob(ws, preset(), { pool });
		expect(
			pool.requests.map((r) => [r.values.display_name, r.side, r.variantId]),
		).toEqual([
			["Member 1", "front", undefined],
			["Member 1", "back", undefined],
			["Member 1", "front", "midnight"],
			["Member 1", "back", "midnight"],
			["Member 2", "front", undefined],
			["Member 2", "back", undefined],
			["Member 2", "front", "midnight"],
			["Member 2", "back", "midnight"],
		]);
		const files = await unzipped(result);
		expect(Object.keys(files)).toEqual([
			"1-front-default.png",
			"1-back-default.png",
			"1-front-midnight.png",
			"1-back-midnight.png",
			"2-front-default.png",
			"2-back-default.png",
			"2-front-midnight.png",
			"2-back-midnight.png",
			REPORT_FILE_NAME,
		]);
		expect(new Set(result.items.map((i) => i.key)).size).toBe(8);
	});

	it("a template with no dataset exports each variant its binding asks for", async () => {
		const pool = fakePool();
		const ws = workspace(3, false);
		const entry = ws.templates[0] as Workspace["templates"][number];
		entry.binding = { datasetId: "", fields: {}, variant: { kind: "all" } };
		const result = await runExportJob(
			ws,
			preset({ fileName: "{{variant}}-{{side}}", sides: ["front"] }),
			{ pool },
		);
		expect(pool.requests.map((r) => r.variantId)).toEqual([
			undefined,
			"midnight",
		]);
		const files = await unzipped(result);
		expect(Object.keys(files)).toEqual([
			"default-front.png",
			"midnight-front.png",
			REPORT_FILE_NAME,
		]);

		entry.binding = {
			datasetId: "",
			fields: {},
			variant: { kind: "fixed", id: "midnight" },
		};
		const fixedPool = fakePool();
		const fixed = await runExportJob(ws, preset({ sides: ["front"] }), {
			pool: fixedPool,
		});
		expect(fixedPool.requests.map((r) => r.variantId)).toEqual(["midnight"]);
		expect(Object.keys(await unzipped(fixed))).toEqual([
			"1-front.png",
			REPORT_FILE_NAME,
		]);
	});

	it("sends each render only the photos its values name", async () => {
		const pool = fakePool();
		const ws = workspace(2);
		const [dataset] = ws.datasets as [Dataset];
		dataset.records[0].values.photo = "ws:abc";
		const entry = ws.templates[0] as Workspace["templates"][number];
		entry.binding = {
			datasetId: "d_1",
			fields: {
				display_name: { kind: "column", column: "display_name" },
				tier: { kind: "column", column: "photo" },
			},
		};
		await runExportJob(ws, preset(), { pool });
		const blob = dataset.assets[0]?.blob;
		expect(pool.requests.map((r) => r.images)).toEqual([
			[["ws:abc", blob]],
			[["ws:abc", blob]],
			[],
			[],
		]);
		expect(pool.requests[0]?.images[0]?.[1]).toBe(blob);
	});

	it("builds a zip of the PNGs in plan order plus the report", async () => {
		// later items finish first, and the zip is still in plan order
		const pool = fakePool({
			size: 4,
			delay: (r) => (r.side === "front" ? 6 : 1),
		});
		const result = await runExportJob(workspace(3), preset(), { pool });
		expect(result.file?.name).toBe("all_members.zip");
		expect(result.file?.mediaType).toBe("application/zip");
		const files = await unzipped(result);
		expect(Object.keys(files)).toEqual([
			"1-front.png",
			"1-back.png",
			"2-front.png",
			"2-back.png",
			"3-front.png",
			"3-back.png",
			REPORT_FILE_NAME,
		]);
		expect(strFromU8(files["2-back.png"])).toBe("Member 2|back");
		expect(strFromU8(files[REPORT_FILE_NAME]).split("\r\n")).toEqual([
			"file,record,side,status,error,print,gamut,unfilled,warnings",
			"1-front.png,r_1,front,ok,,off,,,",
			"1-back.png,r_1,back,ok,,off,,,",
			"2-front.png,r_2,front,ok,,off,,,",
			"2-back.png,r_2,back,ok,,off,,,",
			"3-front.png,r_3,front,ok,,off,,,",
			"3-back.png,r_3,back,ok,,off,,,",
			"",
		]);
		expect(result.items).toHaveLength(6);
		expect(result.items.every((i) => i.ok)).toBe(true);
	});

	it("records failed items without stopping the job", async () => {
		const pool = fakePool({
			fail: (r) =>
				r.values.display_name === "Member 2" && r.side === "back"
					? 'font "X", missing'
					: undefined,
		});
		const progress: JobProgress[] = [];
		const result = await runExportJob(workspace(3), preset(), {
			pool,
			onProgress: (p) => progress.push(p),
		});
		expect(progress.at(-1)).toMatchObject({ done: 6, failed: 1, total: 6 });
		expect(result.items.filter((i) => !i.ok)).toEqual([
			{
				key: "r_2:back",
				recordId: "r_2",
				side: "back",
				fileName: "2-back.png",
				ok: false,
				error: 'font "X", missing',
			},
		]);
		const files = await unzipped(result);
		expect(Object.keys(files)).toHaveLength(6);
		expect(files["2-back.png"]).toBeUndefined();
		expect(strFromU8(files[REPORT_FILE_NAME])).toContain(
			'2-back.png,r_2,back,failed,"font ""X"", missing"',
		);
	});

	it("stops within one item on cancel and gives no file", async () => {
		const pool = fakePool({ size: 2, delay: () => 2 });
		const controller = new AbortController();
		const progress: JobProgress[] = [];
		const result = await runExportJob(workspace(50), preset(), {
			pool,
			signal: controller.signal,
			onProgress: (p) => {
				progress.push(p);
				controller.abort();
			},
		});
		expect(result.cancelled).toBe(true);
		expect(result.file).toBeUndefined();
		expect(pool.cancelled).toBe(1);
		expect(progress).toHaveLength(1);
		expect(result.items).toHaveLength(1);
		expect(pool.requests.length).toBeLessThanOrEqual(3);
		await new Promise((r) => setTimeout(r, 10));
		expect(progress).toHaveLength(1);
	});

	it("resolves cancelled at once for an already aborted signal", async () => {
		const pool = fakePool();
		const controller = new AbortController();
		controller.abort();
		const result = await runExportJob(workspace(3), preset(), {
			pool,
			signal: controller.signal,
		});
		expect(result).toMatchObject({ cancelled: true, items: [] });
		expect(pool.requests).toHaveLength(0);
	});

	it("assembles a PDF from the pages in plan order at the design size", async () => {
		const pool = fakePool({
			size: 3,
			delay: (r) => (r.values.display_name === "Member 1" ? 8 : 1),
		});
		const assemblePdf = vi.fn(
			async (pages: PdfPage[], _o: { dpi: number; title?: string }) =>
				new Uint8Array([pages.length]),
		);
		const result = await runExportJob(
			workspace(3),
			preset({ format: "pdf", dpi: 300, name: "Cards PDF" }),
			{ pool, assemblePdf },
		);
		expect(pool.requests.every((r) => r.scale === 1)).toBe(true);
		expect(assemblePdf).toHaveBeenCalledTimes(1);
		const [pages, options] = assemblePdf.mock.calls[0];
		expect(options).toEqual({ dpi: 300, title: "Cards PDF" });
		expect(pages.map((p) => strFromU8(p.bytes))).toEqual([
			"Member 1|front",
			"Member 1|back",
			"Member 2|front",
			"Member 2|back",
			"Member 3|front",
			"Member 3|back",
		]);
		// Template pixels are dots at the DPI, so the page is the design size.
		expect(pages[0]).toMatchObject({ widthPx: 1012, heightPx: 638 });
		expect(result.file).toMatchObject({
			name: "cards_pdf.pdf",
			mediaType: "application/pdf",
		});
		expect(
			new Uint8Array(await (result.file?.blob as Blob).arrayBuffer()),
		).toEqual(new Uint8Array([6]));
	});

	it("oversamples a PDF by the preset's scale", async () => {
		const pool = fakePool();
		const assemblePdf = vi.fn(
			async (_p: PdfPage[], _o: { dpi: number; title?: string }) =>
				new Uint8Array(),
		);
		await runExportJob(
			workspace(1),
			preset({ format: "pdf", dpi: 300, scale: 2 }),
			{ pool, assemblePdf },
		);
		expect(pool.requests.map((r) => r.scale)).toEqual([2, 2]);
		expect(assemblePdf.mock.calls[0]?.[0][0]).toMatchObject({
			widthPx: 1012,
			heightPx: 638,
		});
	});

	it("renders only the chosen sides, at the preset's scale", async () => {
		const pool = fakePool();
		const result = await runExportJob(
			workspace(2),
			preset({ sides: ["back"], scale: 2, name: "" }),
			{ pool },
		);
		expect(pool.requests.map((r) => [r.side, r.scale])).toEqual([
			["back", 2],
			["back", 2],
		]);
		expect(result.file?.name).toBe("membership_card.zip");
		const names = Object.keys(await unzipped(result));
		expect(names).toEqual(["1-back@2x.png", "2-back@2x.png", REPORT_FILE_NAME]);
	});

	it("an unbound template exports one item per side with its defaults", async () => {
		const pool = fakePool();
		const result = await runExportJob(workspace(3, false), preset(), { pool });
		expect(pool.requests.map((r) => r.values.display_name)).toEqual([
			"Alex Rivera",
			"Alex Rivera",
		]);
		expect(result.items).toHaveLength(2);
		expect(pool.requests.every((r) => r.images.length === 0)).toBe(true);
	});

	it("a PDF with no page that rendered has no file", async () => {
		const pool = fakePool({ fail: () => "boom" });
		const assemblePdf = vi.fn(async () => new Uint8Array());
		const result = await runExportJob(workspace(1), preset({ format: "pdf" }), {
			pool,
			assemblePdf,
		});
		expect(result.file).toBeUndefined();
		expect(result.items.map((i) => i.ok)).toEqual([false, false]);
		expect(assemblePdf).not.toHaveBeenCalled();
	});

	it("hands each output's CRC to the sink, and the zip carries it", async () => {
		const outputs: RenderOutput[] = [];
		const pool: JobPool = {
			size: 2,
			async render(req) {
				const bytes = encoder.encode(`${req.values.display_name}|${req.side}`);
				const out = {
					bytes,
					crc: crc32(bytes),
					format: req.format,
					width: 1,
					height: 1,
					ms: 1,
				};
				outputs.push(out);
				return out;
			},
			cancel() {},
		};
		const crcs: (number | undefined)[] = [];
		const inner = createPartZipSink({ name: "x" });
		const sink: OutputSink = {
			...inner,
			get ready() {
				return inner.ready;
			},
			get files() {
				return inner.files;
			},
			get bytes() {
				return inner.bytes;
			},
			add(name, bytes, crc) {
				crcs.push(crc);
				return inner.add(name, bytes, crc);
			},
		};
		const result = await runExportJob(workspace(2), preset(), { pool, sink });
		expect(crcs.slice(0, 4)).toEqual(
			result.items.map((item) =>
				crc32(encoder.encode(`Member ${item.recordId.slice(2)}|${item.side}`)),
			),
		);
		expect(crcs[4]).toBeUndefined();
		const files = unzipSync(
			new Uint8Array(await (result.file?.blob as Blob).arrayBuffer()),
		);
		expect(Object.keys(files)).toHaveLength(5);
	});

	it("reports PDF assembly progress and cancels assembly with the job", async () => {
		const pool = fakePool();
		let signal: AbortSignal | undefined;
		const assemblePdf: AssemblePdf = (pages, _options, extras) => {
			signal = extras?.signal;
			extras?.onProgress?.(1, pages.length);
			return new Promise<Uint8Array>(() => {});
		};
		const controller = new AbortController();
		const progress: JobProgress[] = [];
		const running = runExportJob(workspace(1), preset({ format: "pdf" }), {
			pool,
			assemblePdf,
			signal: controller.signal,
			onProgress: (p) => {
				progress.push(p);
				if (p.assembling) controller.abort();
			},
		});
		const result = await running;
		expect(result.cancelled).toBe(true);
		expect(progress.at(-1)).toMatchObject({
			done: 2,
			total: 2,
			assembling: { done: 1, total: 2 },
		});
		expect(signal?.aborted).toBe(true);
	});
});

/** A sink whose `ready` stays pending after each file until released. */
function gatedSink() {
	const added: string[] = [];
	const bytes: Uint8Array[] = [];
	let open = () => {};
	let gate = Promise.resolve();
	let aborted = false;
	const sink: OutputSink & {
		added: string[];
		bytes: Uint8Array[];
		release(): void;
		closed: boolean;
		aborted: boolean;
	} = {
		kind: "zip-file",
		added,
		bytes,
		closed: false,
		get aborted() {
			return aborted;
		},
		get ready() {
			return gate;
		},
		get files() {
			return added.length;
		},
		release() {
			sink.closed = false;
			open();
		},
		async add(name: string, data: Uint8Array) {
			added.push(name);
			bytes.push(data);
			sink.closed = true;
			gate = new Promise<void>((resolve) => {
				open = resolve;
			});
		},
		async finish() {
			return { kind: "zip-file", files: added.length, bytes: 0 };
		},
		async abort() {
			aborted = true;
		},
	} as never;
	Object.defineProperty(sink, "bytes", { value: bytes });
	return sink;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("back-pressure", () => {
	it("holds no more than 2 x pool size outputs behind a slow sink", async () => {
		const pool = fakePool({ size: 2 });
		const sink = gatedSink();
		const running = runExportJob(workspace(15), preset(), { pool, sink });
		let settled = false;
		void running.then(() => {
			settled = true;
		});
		while (!settled) {
			// let everything that can run run, then check the window
			for (let i = 0; i < 5; i++) await tick();
			const dispatched = pool.requests.length;
			expect(dispatched - sink.added.length).toBeLessThanOrEqual(4);
			// while the sink is not ready, nothing more is dispatched
			if (sink.closed) {
				for (let i = 0; i < 5; i++) await tick();
				expect(pool.requests.length).toBe(dispatched);
			}
			sink.release();
		}
		const result = await running;
		expect(result.stats).toMatchObject({ poolSize: 2, window: 4 });
		expect(result.stats?.maxHeld).toBeGreaterThan(1);
		expect(result.stats?.maxHeld).toBeLessThanOrEqual(4);
		expect(sink.added).toHaveLength(31);
		expect(sink.added.slice(0, 3)).toEqual([
			"01-front.png",
			"01-back.png",
			"02-front.png",
		]);
		expect(sink.added.at(-1)).toBe(REPORT_FILE_NAME);
		expect(result.sink).toEqual({ kind: "zip-file", files: 31, bytes: 0 });
		expect(result.file).toBeUndefined();
	});

	it("writes in plan order however the items finish", async () => {
		const pool = fakePool({
			size: 3,
			delay: (r) => (r.side === "front" ? 5 : 0),
		});
		const sink = gatedSink();
		const running = runExportJob(workspace(4), preset(), { pool, sink });
		const timer = setInterval(() => sink.release(), 1);
		await running;
		clearInterval(timer);
		expect(sink.added).toEqual([
			"1-front.png",
			"1-back.png",
			"2-front.png",
			"2-back.png",
			"3-front.png",
			"3-back.png",
			"4-front.png",
			"4-back.png",
			REPORT_FILE_NAME,
		]);
	});

	it("aborts the sink on cancel and says how many files it took", async () => {
		const pool = fakePool({ size: 1, delay: () => 1 });
		const sink = gatedSink();
		const controller = new AbortController();
		const timer = setInterval(() => {
			sink.release();
			if (sink.added.length === 3) controller.abort();
		}, 1);
		const result = await runExportJob(workspace(20), preset(), {
			pool,
			sink,
			signal: controller.signal,
		});
		clearInterval(timer);
		expect(result.cancelled).toBe(true);
		expect(sink.aborted).toBe(true);
		expect(result.sink?.files).toBe(3);
		expect(pool.cancelled).toBe(1);
	});

	it("fails the job when the sink cannot write", async () => {
		const pool = fakePool();
		const sink = gatedSink();
		sink.add = async (_name: string, _data: Uint8Array) => {
			throw new Error("disk full");
		};
		await expect(
			runExportJob(workspace(3), preset(), { pool, sink }),
		).rejects.toThrow("disk full");
		expect(sink.aborted).toBe(true);
	});
});

function photoWorkspace(): Workspace {
	const photo = (
		sha: string,
		width: number,
		height: number,
		orientation?: number,
	) => ({
		sha256: sha,
		contentType: "image/jpeg",
		name: `${sha}.jpg`,
		size: 1,
		width,
		height,
		...(orientation ? { orientation } : {}),
		blob: new Blob([sha]),
	});
	return {
		formatVersion: "1.0",
		name: "Photos",
		templates: [
			{
				id: "t_1",
				fileName: "watermark.coat",
				template: photoWatermark(),
				binding: {
					datasetId: "d_1",
					fields: { photo: { kind: "column", column: "photo" } },
				},
			},
		],
		datasets: [
			{
				id: "d_1",
				name: "Photos",
				columns: [
					{ key: "photo", type: "image" },
					{ key: "file_name", type: "text" },
				],
				records: [
					["r_1", "ws:land", "land"],
					["r_2", "ws:turned", "turned"],
					["r_3", null, "none"],
					["r_4", "ws:big", "big"],
				].map(([id, photo, file_name]) => ({
					id: id as string,
					status: "pending" as const,
					values: { photo, file_name },
				})),
				assets: [
					photo("land", 4000, 3000),
					// stored landscape, shown portrait
					photo("turned", 4000, 3000, 6),
					photo("big", 9000, 6000),
					photo("unused", 10, 10),
				],
			},
		],
		presets: [],
	};
}

describe("size from an image", () => {
	const photoPreset = preset({
		format: "jpeg-zip",
		quality: 80,
		scale: 2,
		fileName: "{{file_name}}",
		size: { kind: "image", field: "photo", maxEdge: 6000 },
	});

	it("renders each photo at its own oriented size, as JPEG", async () => {
		const pool = fakePool();
		const result = await runExportJob(photoWorkspace(), photoPreset, { pool });
		const byName = Object.fromEntries(
			pool.requests.map((r) => [r.values.photo, r]),
		);
		const land = byName["ws:land"] as RenderRequest;
		expect(land.resize).toEqual({ width: 1600, height: 1200 });
		expect(land.scale).toBe(2.5);
		expect(land.format).toBe("jpeg");
		expect(land.quality).toBe(80);
		expect(land.images.map(([ref]) => ref)).toEqual(["ws:land"]);
		const turned = byName["ws:turned"] as RenderRequest;
		expect(turned.resize).toEqual({ width: 1200, height: 1600 });
		expect(turned.resize && turned.resize.width * turned.scale).toBe(3000);
		// capped to a 6000 px long edge: 6000 x 4000
		const big = byName["ws:big"] as RenderRequest;
		expect(big.resize && big.resize.width * big.scale).toBeCloseTo(6000, 6);
		expect(big.resize && big.resize.height * big.scale).toBeCloseTo(4000, 6);

		expect(result.items.map((i) => [i.fileName, i.ok, i.error])).toEqual([
			["land.jpg", true, undefined],
			["turned.jpg", true, undefined],
			["none.jpg", false, "No image in photo"],
			["big.jpg", true, undefined],
		]);
		expect(pool.requests).toHaveLength(3);
		const names = Object.keys(await unzipped(result));
		expect(names).toEqual([
			"land.jpg",
			"turned.jpg",
			"big.jpg",
			REPORT_FILE_NAME,
		]);
	});

	it("sizes each PDF page by its photo and embeds JPEG pages", async () => {
		const pool = fakePool();
		const assemblePdf = vi.fn(
			async (_p: PdfPage[], _o: { dpi: number; title?: string }) =>
				new Uint8Array([1]),
		);
		await runExportJob(
			photoWorkspace(),
			{ ...photoPreset, format: "pdf", pdfPageImage: "jpeg" },
			{ pool, assemblePdf },
		);
		const pages = assemblePdf.mock.calls[0]?.[0] ?? [];
		expect(pages.map((p) => [p.format, p.widthPx, p.heightPx])).toEqual([
			["jpeg", 4000, 3000],
			["jpeg", 3000, 4000],
			["jpeg", 6000, 4000],
		]);
		expect(pool.requests.every((r) => r.format === "jpeg")).toBe(true);
	});

	it("asks before a PDF estimated past 1 GB, and a no cancels it", async () => {
		const pool = fakePool();
		const big = new Uint8Array(200 * 1024 * 1024);
		pool.render = async (req) => {
			pool.requests.push(req);
			return { bytes: big, format: "png", width: 1, height: 1, ms: 1 };
		};
		const confirm = vi.fn(async (_estimate: number) => false);
		const assemblePdf = vi.fn(async () => new Uint8Array());
		const result = await runExportJob(workspace(4), preset({ format: "pdf" }), {
			pool,
			assemblePdf,
			confirmLargePdf: confirm,
		});
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0]?.[0]).toBe(8 * 200 * 1024 * 1024);
		expect(result.cancelled).toBe(true);
		expect(assemblePdf).not.toHaveBeenCalled();
	});
});

describe("bleed", () => {
	const bleed = { top: 10, right: 20, bottom: 30, left: 40 };
	function bled(count: number): Workspace {
		const ws = workspace(count);
		const entry = ws.templates[0];
		if (entry) entry.template = { ...entry.template, bleed };
		return ws;
	}

	it("is left out unless the preset includes it", async () => {
		const pool = fakePool();
		await runExportJob(bled(1), preset(), { pool });
		expect(pool.requests.some((r) => "bleed" in r)).toBe(false);
	});

	it("renders every item with it, at the preset's scale", async () => {
		const pool = fakePool();
		await runExportJob(bled(1), preset({ bleed: true, scale: 2 }), { pool });
		expect(pool.requests.map((r) => r.bleed)).toEqual([true, true]);
		const t = bled(1).templates[0]?.template;
		if (!t) throw new Error("no template");
		expect(
			itemSize(t, preset({ bleed: true, scale: 2 }), {} as never, new Map()),
		).toEqual({ width: 2144, height: 1356, scale: 2, bleed: true });
	});

	it("hands a PDF the bleed in millimetres and pages at the bleed size", async () => {
		const pool = fakePool();
		const assemblePdf = vi.fn(
			async (_p: PdfPage[], _o: { dpi: number; title?: string }) =>
				new Uint8Array(),
		);
		await runExportJob(
			bled(1),
			preset({ format: "pdf", dpi: 254, bleed: true }),
			{ pool, assemblePdf },
		);
		const [pages, options] = assemblePdf.mock.calls[0] ?? [];
		expect(pages?.[0]).toMatchObject({ widthPx: 1072, heightPx: 678 });
		expect(options).toEqual({
			dpi: 254,
			title: "All members",
			bleedMm: {
				top: expect.closeTo(1, 9),
				right: expect.closeTo(2, 9),
				bottom: expect.closeTo(3, 9),
				left: expect.closeTo(4, 9),
			},
		});
	});

	it("does nothing for a template without bleed or a size from an image", () => {
		const t = workspace(1).templates[0]?.template;
		if (!t) throw new Error("no template");
		expect(presetBleed(t, { bleed: true })).toEqual({
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		});
		expect(
			presetBleed(
				{ bleed: 5 },
				{ bleed: true, size: { kind: "image", field: "photo" } },
			),
		).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
		expect(presetBleed({ bleed: 5 }, { bleed: true }).left).toBe(5);
	});
});

describe("a variant with its own size", () => {
	const sized = () => {
		const t = membershipCard();
		return {
			...t,
			variants: [
				...(t.variants ?? []),
				{
					id: "tall",
					label: "Tall",
					size: { width: 638, height: 1012 },
					overrides: [],
				},
			],
		};
	};

	it("sizes its items at the variant's size", () => {
		const t = sized();
		const at = (variantId?: string) =>
			itemSize(
				t,
				preset({ scale: 2 }),
				{ values: {}, ...(variantId ? { variantId } : {}) },
				new Map(),
			);
		expect(at()).toEqual({ width: 2024, height: 1276, scale: 2 });
		expect(at("tall")).toEqual({ width: 1276, height: 2024, scale: 2 });
	});

	it("pages a PDF at the variant's size", async () => {
		const ws = workspace(1);
		const entry = ws.templates[0] as Workspace["templates"][number];
		entry.template = sized();
		entry.binding = {
			...(entry.binding as NonNullable<typeof entry.binding>),
			variant: { kind: "fixed", id: "tall" },
		};
		const assemblePdf = vi.fn(
			async (_p: PdfPage[], _o: { dpi: number; title?: string }) =>
				new Uint8Array(),
		);
		await runExportJob(ws, preset({ format: "pdf" }), {
			pool: fakePool(),
			assemblePdf,
		});
		const pages = assemblePdf.mock.calls[0]?.[0] ?? [];
		expect(pages[0]).toMatchObject({ widthPx: 638, heightPx: 1012 });
	});
});
