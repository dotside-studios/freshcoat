/**
 * Times the export path with the full CanvasKit build on software surfaces,
 * against the numbers in bench-render.baseline.json.
 *
 *   bun run bench:render                compare; exit 1 past the tolerance
 *   bun run bench:render --update       rewrite the baseline from this machine
 *   bun run bench:render --out <file>   also write the numbers, in the
 *                                       baseline's format, to <file>
 *   bun run bench:render --batch        time, peak memory and GC pauses of
 *                                       batch export readback, per strategy;
 *                                       reports only, no baseline
 *
 * Each time is divided by a calibration loop's, so machines of different
 * speeds compare in the same units. A case fails when that ratio is more than
 * TOLERANCE above the baseline's.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compile, type Element, type Template } from "@freshcoat-js/coatfile";
import {
	type RenderCompiledOptions,
	renderCompiled,
} from "@freshcoat-js/coatfile/render";
import { createRenderer, encodePng, type Node } from "@freshcoat-js/engine";
import { createAnalysisCache } from "@freshcoat-js/for-print";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { IMAGE_CACHE_PIXELS } from "@freshcoat-js/workspace/export";
import { plugin } from "bun";
import type { CanvasKit } from "canvaskit-wasm";

const BASELINE = join(import.meta.dir, "bench-render.baseline.json");
const TOLERANCE = 0.3;
const UPDATE = process.argv.includes("--update");
const OUT_AT = process.argv.indexOf("--out");
const OUT = OUT_AT === -1 ? undefined : process.argv[OUT_AT + 1];

// The samples import their font through Vite's `?inline` and `?url`.
plugin({
	name: "vite-asset-queries",
	setup(build) {
		build.onResolve({ filter: /\?(inline|url)$/ }, (args) => ({
			path: resolve(args.importer, "..", args.path),
		}));
		build.onLoad({ filter: /\?(inline|url)$/ }, (args) => {
			const [file, query] = args.path.split("?") as [string, string];
			const value =
				query === "inline"
					? `data:font/woff2;base64,${readFileSync(file).toString("base64")}`
					: file;
			return {
				contents: `export default ${JSON.stringify(value)};`,
				loader: "js",
			};
		});
	},
});
const { membershipCard } = await import("../src/samples/membership-card");
const { sampleValues } = await import("@freshcoat-js/coatfile");

type Case = { ms: number; relative: number };
type Baseline = { calibrationMs: number; cases: Record<string, Case> };

// The mean of the fastest half: steadier than the median when a shared
// runner is interrupted.
function fastHalf(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b).slice(0, Math.ceil(xs.length / 2));
	return s.reduce((a, b) => a + b, 0) / s.length;
}

// Milliseconds per call of `fn`, after `warmup` untimed calls.
async function time(
	fn: (i: number) => unknown,
	runs: number,
	warmup = 2,
): Promise<number> {
	for (let i = 0; i < warmup; i++) await fn(i);
	const out: number[] = [];
	for (let i = 0; i < runs; i++) {
		const t = performance.now();
		await fn(warmup + i);
		out.push(performance.now() - t);
	}
	return fastHalf(out);
}

// A fixed mix of JavaScript and software rasterizing, the two kinds of work
// the cases do. It allocates nothing in JavaScript, so collection does not
// add to its noise.
function calibrate(ck: CanvasKit): Promise<number> {
	const surface = ck.MakeSurface(512, 512);
	if (!surface) throw new Error("no software surface");
	const paint = new ck.Paint();
	const path = ck.Path.MakeFromSVGString(
		"M 0 10 C 0 0 20 0 20 10 S 0 20 0 10 Z",
	);
	if (!path) throw new Error("no path");
	const words = new Uint32Array(1 << 16);
	const work = () => {
		let x = 2463534242;
		for (let round = 0; round < 120; round++)
			for (let i = 0; i < words.length; i++) {
				x ^= x << 13;
				x ^= x >>> 17;
				x ^= x << 5;
				words[i] = ((words[i] as number) + x) >>> 0;
			}
		const canvas = surface.getCanvas();
		canvas.clear(ck.WHITE);
		for (let i = 0; i < 400; i++) {
			paint.setColor(ck.Color(i % 255, (i * 7) % 255, (i * 13) % 255, 0.6));
			canvas.save();
			canvas.translate((i * 37) % 480, (i * 53) % 480);
			canvas.scale(1 + (i % 5), 1 + (i % 3));
			canvas.drawPath(path, paint);
			canvas.restore();
		}
		surface.flush();
		canvas.readPixels(0, 0, surface.imageInfo());
	};
	return time(work, 8, 2).finally(() => {
		path.delete();
		paint.delete();
		surface.delete();
	});
}

function countLayers(elements: Element[]): number {
	let n = 0;
	for (const e of elements) {
		n++;
		const children = (e.properties as { children?: Element[] }).children;
		if (children) n += countLayers(children);
	}
	return n;
}

function suffixIds<T>(value: T, suffix: string): T {
	return JSON.parse(
		JSON.stringify(value, (key, v) =>
			key === "id" && typeof v === "string" ? `${v}-${suffix}` : v,
		),
	);
}

// The membership card's front repeated 12 times, each copy nudged.
function repeatedFront(card: Template, copies: number): Template {
	const front = card.template_data[0];
	if (!front) throw new Error("no front");
	const elements = Array.from({ length: copies }, (_, k) =>
		suffixIds(front.elements, String(k)).map((e) =>
			e.pos ? { ...e, pos: { x: e.pos.x + k * 4, y: e.pos.y + k * 3 } } : e,
		),
	).flat();
	return {
		...card,
		id: "repeated-front",
		template_data: [{ ...front, elements }],
		variants: [],
	};
}

const RECORDS = [
	["Alex Rivera", "Gold", "LC 0042 7781"],
	["Grace Hopper", "Platinum", "LC 1906 1209"],
	["Ada Lovelace", "Silver", "LC 1815 1210"],
	["Katherine Johnson", "Gold", "LC 1918 0826"],
	["Hedy Lamarr", "Bronze", "LC 1914 1109"],
	["Radia Perlman", "Silver", "LC 1951 1218"],
] as const;

const ck = await loadCanvasKit("full");
const fonts = { "Vend Sans": [testFontBytes("VendSans-Variable-latin.woff2")] };
const compiler = await createRenderer({ ck, fonts, cache: false });

const card = membershipCard();
const synthetic = repeatedFront(card, 12);
const size = { width: card.width, height: card.height };

// Per compile of every side, as the preview recompiles an unchanged scene.
// Timed 100 at a time, as one is too quick to time alone.
async function compileRepeat(template: Template): Promise<number> {
	const compiled = compile(template, sampleValues(template), size);
	const batch = 100;
	const ms = await time(() => {
		for (let i = 0; i < batch; i++)
			for (const frame of compiled.frames)
				compiler.compile(frame.root as Node, {
					...size,
					fonts: frame.assets.fonts,
					images: frame.assets.images,
				});
	}, 15);
	return ms / batch;
}

// Per record, both sides to PNG through one renderer and its paint cache, as an
// export worker renders a job.
async function renderRecords(
	print: RenderCompiledOptions["print"],
): Promise<number> {
	const renderer = await createRenderer({
		ck,
		fonts,
		cache: { maxImagePixels: IMAGE_CACHE_PIXELS },
	});
	const analysisCache = createAnalysisCache(256);
	try {
		return await time(
			async (i) => {
				const [display_name, tier, member_id] = RECORDS[
					i % RECORDS.length
				] as (typeof RECORDS)[number];
				const values = { ...sampleValues(card), display_name, tier, member_id };
				const compiled = compile(card, values, size);
				const frames = await renderCompiled(renderer, compiled, {
					...(print ? { print } : {}),
					analysisCache,
				});
				if (frames.length !== 2) throw new Error("expected both sides");
			},
			RECORDS.length * 3,
			RECORDS.length,
		);
	} finally {
		renderer.dispose();
	}
}

const BATCH = process.argv.includes("--batch");
const BATCH_CHILD_AT = process.argv.indexOf("--batch-child");
const BATCH_RECORDS = 50;
const BATCH_EXPORT_RECORDS = 10;
const BATCH_WIDTH = 4000;
const BATCH_HEIGHT = 3000;

type Readback = "alloc" | "malloc" | "reuse" | "engine";
type Consumer = "touch" | "png" | "export";
type BatchRun = {
	readback: Readback;
	consumer: Consumer;
	msPerRecord: number;
	totalMs: number;
	maxRssMiB: number;
	wasmHeapMiB: number;
	gcCount: number;
	gcPauseMs: number;
	gcMaxPauseMs: number;
};

// Renders BATCH_RECORDS frames at export size, reads each back and hands the
// pixels to `consumer`, as an export worker does per record.
async function batchChild(readback: Readback, consumer: Consumer) {
	if (consumer === "export") return batchExport();
	const info = {
		width: BATCH_WIDTH,
		height: BATCH_HEIGHT,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	};
	const surface = ck.MakeSurface(BATCH_WIDTH, BATCH_HEIGHT);
	if (!surface) throw new Error("no software surface");
	const paint = new ck.Paint();
	const dest =
		readback === "reuse"
			? ck.Malloc(Uint8Array, BATCH_WIDTH * BATCH_HEIGHT * 4)
			: null;
	let sink = 0;
	const times: number[] = [];
	try {
		for (let r = 0; r < BATCH_RECORDS; r++) {
			const t = performance.now();
			const canvas = surface.getCanvas();
			canvas.clear(ck.WHITE);
			for (let i = 0; i < 40; i++) {
				paint.setColor(ck.Color((r * 31 + i * 7) % 255, (i * 13) % 255, 90, 1));
				canvas.drawRect(
					ck.XYWHRect((i * 97) % 3600, (i * 71 + r) % 2700, 400, 300),
					paint,
				);
			}
			surface.flush();
			const snap = surface.makeImageSnapshot();
			const own =
				readback === "malloc"
					? ck.Malloc(Uint8Array, BATCH_WIDTH * BATCH_HEIGHT * 4)
					: null;
			try {
				let pixels: Uint8Array | null;
				try {
					const into = dest ?? own;
					pixels = into
						? (snap.readPixels(0, 0, info, into) as Uint8Array | null)
						: (snap.readPixels(0, 0, info) as Uint8Array | null);
				} finally {
					snap.delete();
				}
				if (!pixels) throw new Error("no pixels");
				if (consumer === "png")
					sink += (await encodePng(pixels, BATCH_WIDTH, BATCH_HEIGHT)).length;
				else
					for (let i = 0; i < pixels.length; i += 4096)
						sink += pixels[i] as number;
			} finally {
				if (own) ck.Free(own);
			}
			times.push(performance.now() - t);
		}
	} finally {
		if (dest) ck.Free(dest);
		paint.delete();
		surface.dispose();
	}
	printBatch(sink, times);
}

// Both sides of each record exported BATCH_WIDTH wide through one paint cache
// and encoded to PNG by the engine, with whatever readback it uses.
async function batchExport() {
	const renderer = await createRenderer({
		ck,
		fonts,
		cache: { maxImagePixels: IMAGE_CACHE_PIXELS },
	});
	const exports = [
		{ constraint: { kind: "width" as const, value: BATCH_WIDTH } },
	];
	let sink = 0;
	const times: number[] = [];
	try {
		for (let r = 0; r < BATCH_EXPORT_RECORDS; r++) {
			const t = performance.now();
			const [display_name, tier, member_id] = RECORDS[
				r % RECORDS.length
			] as (typeof RECORDS)[number];
			const values = { ...sampleValues(card), display_name, tier, member_id };
			const frames = await renderCompiled(
				renderer,
				compile(card, values, size),
				{ exports },
			);
			for (const frame of frames) sink += frame.bytes.length;
			times.push(performance.now() - t);
		}
	} finally {
		renderer.dispose();
	}
	printBatch(sink, times);
}

function printBatch(sink: number, times: number[]) {
	const heap = (ck as unknown as { HEAPU8: Uint8Array }).HEAPU8.byteLength;
	console.log(
		JSON.stringify({
			sink,
			totalMs: times.reduce((a, b) => a + b, 0),
			msPerRecord: fastHalf(times),
			maxRssMiB: process.resourceUsage().maxRSS / 1024,
			wasmHeapMiB: heap / 2 ** 20,
		}),
	);
}

// Each run gets its own process, so one strategy's heap and peak RSS do not
// carry into the next. JSC logs every collection and its pause to stderr.
function batchRun(readback: Readback, consumer: Consumer): BatchRun {
	const child = spawnSync(
		process.execPath,
		[import.meta.path, "--batch-child", readback, consumer],
		{
			encoding: "utf8",
			env: { ...process.env, BUN_JSC_logGC: "1" },
			maxBuffer: 1 << 28,
		},
	);
	if (child.status !== 0) throw new Error(child.stderr);
	const line = child.stdout.trim().split("\n").at(-1) as string;
	const out = JSON.parse(line);
	const pauses = [...child.stderr.matchAll(/ p=([\d.]+)ms/g)].map((m) =>
		Number(m[1]),
	);
	return {
		readback,
		consumer,
		msPerRecord: round(out.msPerRecord),
		totalMs: round(out.totalMs, 0),
		maxRssMiB: round(out.maxRssMiB, 0),
		wasmHeapMiB: round(out.wasmHeapMiB, 0),
		gcCount: pauses.length,
		gcPauseMs: round(pauses.reduce((a, b) => a + b, 0)),
		gcMaxPauseMs: round(Math.max(0, ...pauses)),
	};
}

if (BATCH_CHILD_AT !== -1) {
	await batchChild(
		process.argv[BATCH_CHILD_AT + 1] as Readback,
		process.argv[BATCH_CHILD_AT + 2] as Consumer,
	);
	process.exit(0);
}
if (BATCH) {
	const ROUNDS = 3;
	const PAIRS: [Readback, Consumer][] = [
		...(["alloc", "malloc", "reuse"] as const).flatMap((r) =>
			(["touch", "png"] as const).map((c): [Readback, Consumer] => [r, c]),
		),
		["engine", "export"],
	];
	const runs: BatchRun[] = [];
	for (let i = 0; i < ROUNDS; i++)
		for (const [readback, consumer] of PAIRS)
			runs.push(batchRun(readback, consumer));
	const rows = [
		`${BATCH_RECORDS} records at ${BATCH_WIDTH}x${BATCH_HEIGHT} (export: ${BATCH_EXPORT_RECORDS} records of both sides, ${BATCH_WIDTH} wide), median of ${ROUNDS} runs.`,
		"",
		"| Readback | Consumer | ms/record | Total ms | Peak RSS MiB | WASM heap MiB | GCs | GC pause ms | Max GC pause ms |",
		"|---|---|---:|---:|---:|---:|---:|---:|---:|",
	];
	for (const [readback, consumer] of PAIRS) {
		const set = runs.filter(
			(r) => r.readback === readback && r.consumer === consumer,
		);
		const median = (k: keyof BatchRun) =>
			set.map((r) => r[k] as number).sort((a, b) => a - b)[
				Math.floor(set.length / 2)
			] as number;
		rows.push(
			`| ${readback} | ${consumer} | ${median("msPerRecord")} | ${median("totalMs")} | ${median("maxRssMiB")} | ${median("wasmHeapMiB")} | ${median("gcCount")} | ${median("gcPauseMs")} | ${median("gcMaxPauseMs")} |`,
		);
	}
	console.log(rows.join("\n"));
	process.exit(0);
}
const layers = countLayers(synthetic.template_data[0]?.elements ?? []);
const CASES: Record<string, () => Promise<number>> = {
	"compileScene membership card": () => compileRepeat(card),
	[`compileScene front x12 (${layers} layers)`]: () => compileRepeat(synthetic),
	"renderCompiled per record, print off": () => renderRecords(false),
	"renderCompiled per record, print on": () => renderRecords({ analyze: true }),
};

function round(n: number, digits = 2): number {
	const f = 10 ** digits;
	return Math.round(n * f) / f;
}

// A case's time over a calibration taken on either side of it, so a runner
// that changes speed partway through skews no case for long.
async function measure(
	run: () => Promise<number>,
): Promise<Case & { calibration: number }> {
	const before = await calibrate(ck);
	const ms = await run();
	const calibration = (before + (await calibrate(ck))) / 2;
	return {
		ms: round(ms, 3),
		relative: round(ms / calibration, 5),
		calibration,
	};
}

const baseline: Baseline | null = UPDATE
	? null
	: JSON.parse(readFileSync(BASELINE, "utf8"));
const over = (name: string, c: Case) => {
	const base = baseline?.cases[name];
	return !base || c.relative / base.relative - 1 > TOLERANCE;
};

// An update takes each case's median of three rounds. A check measures a case
// over budget up to twice more and keeps its best, so one interrupted round
// does not fail the job.
const cases: Record<string, Case> = {};
const calibrations: number[] = [];
for (const [name, run] of Object.entries(CASES)) {
	const rounds: Case[] = [];
	for (let i = 0; i < 3; i++) {
		const { calibration, ...c } = await measure(run);
		calibrations.push(calibration);
		rounds.push(c);
		if (!UPDATE && !over(name, c)) break;
	}
	rounds.sort((a, b) => a.relative - b.relative);
	cases[name] = rounds[UPDATE ? 1 : 0] as Case;
}
const calibrationMs = round(
	calibrations.reduce((a, b) => a + b, 0) / calibrations.length,
);

const measured = `${JSON.stringify({ calibrationMs, cases } satisfies Baseline, null, "\t")}\n`;
if (OUT) writeFileSync(OUT, measured);
if (UPDATE) {
	writeFileSync(BASELINE, measured);
	console.log(`Wrote ${BASELINE}`);
	console.table(cases);
	process.exit(0);
}

const rows = [
	"| Case | ms | Relative | Baseline | Change |",
	"|---|---:|---:|---:|---:|",
];
const failures: string[] = [];
for (const [name, c] of Object.entries(cases)) {
	const base = baseline?.cases[name];
	const change = base ? c.relative / base.relative - 1 : null;
	if (change === null) failures.push(`${name}: no baseline`);
	else if (change > TOLERANCE)
		failures.push(`${name}: ${(change * 100).toFixed(0)}% slower`);
	const shown =
		change === null
			? ""
			: `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`;
	rows.push(
		`| ${name} | ${c.ms} | ${c.relative} | ${base?.relative ?? "none"} | ${shown} |`,
	);
}
const report = [
	`Calibration: ${calibrationMs} ms (baseline ${baseline?.calibrationMs} ms). Tolerance: +${TOLERANCE * 100}%.`,
	"",
	...rows,
	...(failures.length
		? ["", "Over budget:", ...failures.map((f) => `- ${f}`)]
		: []),
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY)
	writeFileSync(
		process.env.GITHUB_STEP_SUMMARY,
		`## Render benchmark\n\n${report}\n`,
		{ flag: "a" },
	);
if (failures.length) process.exit(1);
