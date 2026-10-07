import type { Element } from "@freshcoat-js/coatfile";
import { useRouteContext, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { translateLayers } from "~/doc/geometry";
import { updateElement } from "~/doc/ops";
import type { RenderTimings } from "~/render/session";
import { useController } from "./context";
import { Editor } from "./Editor";

type StageStats = { p50: number; p95: number; max: number };

export type BenchResult = {
	sample: string;
	size: { width: number; height: number };
	/** One render per step, each awaited: the latency of a single edit. */
	latency: {
		renders: number;
		total: StageStats;
		perStage: Record<keyof Omit<RenderTimings, "total">, StageStats>;
	};
	/** A drag at the display's frame rate: how many renders keep up. */
	throughput: { frames: number; renders: number; perSecond: number };
	/** How the main thread held up during that drag. */
	jank: {
		/** Gaps between animation frames, in ms. */
		frameGap: StageStats;
		/** Frames that came 50 ms or more after the one before. */
		slowFrames: number;
		/** Main-thread tasks of 50 ms or more, where the browser reports them. */
		longTasks: { count: number; totalMs: number; maxMs: number } | null;
	};
	/** Where the Edit canvas was painted. */
	previewMode: string;
	typing: { renders: number; total: StageStats };
	cache: unknown;
};

declare global {
	interface Window {
		__freshcoatBench?: BenchResult | { error: string };
	}
}

/** `/bench[?sample=<id>][&frames=<n>]`: the editor, with scripted interaction
 *  timings over it. */
export function BenchPage() {
	const { controller } = useRouteContext({ from: "/bench" });
	const search = useSearch({ from: "/bench" });
	// Read when the Edit canvas mounts, which is after this.
	if (search.preview === "main")
		(
			window as { __freshcoatPreviewWorker?: boolean }
		).__freshcoatPreviewWorker = false;
	return (
		<Editor controller={controller} urlSync={false}>
			<BenchRunner
				sample={search.sample ?? "membership-card"}
				frames={Number(search.frames ?? 120)}
			/>
		</Editor>
	);
}

function BenchRunner({ sample, frames }: { sample: string; frames: number }) {
	const controller = useController();
	const [result, setResult] = useState<BenchResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		run(sample, frames)
			.then((r) => {
				if (cancelled) return;
				window.__freshcoatBench = r;
				setResult(r);
			})
			.catch((e) => {
				window.__freshcoatBench = { error: String(e) };
				setError(String(e));
			});
		return () => {
			cancelled = true;
		};

		async function run(sample: string, frames: number): Promise<BenchResult> {
			await controller.openSample(sample);
			const f = await waitFor(() => testHooks());
			await idle(f);
			await idle(f);
			const t = controller.template;
			if (!t) throw new Error("sample did not open");
			const side = controller.state.side;
			const geometry = controller.state.geometry;

			// The largest top-level layer that is not the background.
			const key = [...geometry.entries()]
				.filter(([k]) => /^\d+\/\d+$/.test(k))
				.sort(
					([, a], [, b]) =>
						b.rect.width * b.rect.height - a.rect.width * a.rect.height,
				)[0]?.[0];
			if (!key) throw new Error("no layer to move");
			controller.select([key]);

			const timings: RenderTimings[] = [];
			const base = controller.template as typeof t;
			controller.beginTx();
			for (let i = 1; i <= frames; i++) {
				const a = (i / frames) * Math.PI * 2;
				controller.previewTx(
					translateLayers(
						base,
						[key],
						Math.cos(a) * 40,
						Math.sin(a) * 40,
						geometry,
					),
				);
				await idle(f);
				const r = controller.state.render.timings;
				if (r) timings.push(r);
			}
			controller.cancelTx();
			await idle(f);

			// Throughput: request every frame, never wait; count what lands.
			const before = (f.renderStats() as { completed: number }).completed;
			const longTasks = observeLongTasks();
			const frameAt: number[] = [];
			const started = performance.now();
			controller.beginTx();
			for (let i = 1; i <= frames; i++) {
				const a = (i / frames) * Math.PI * 2;
				controller.previewTx(
					translateLayers(
						base,
						[key],
						Math.cos(a) * 40,
						Math.sin(a) * 40,
						geometry,
					),
				);
				await nextFrame();
				frameAt.push(performance.now());
			}
			await idle(f);
			const elapsed = performance.now() - started;
			const gaps = frameAt.slice(1).map((t, i) => t - (frameAt[i] as number));
			const long = longTasks.stop();
			controller.cancelTx();
			const renders =
				(f.renderStats() as { completed: number }).completed - before;

			// Typing into the first text layer, one character per render.
			const text = firstTextKey(controller.template as typeof t, side);
			const typed: number[] = [];
			if (text) {
				for (let i = 0; i < Math.min(20, frames); i++) {
					controller.edit(
						(doc) =>
							updateElement(doc, text, (el: Element) =>
								el.type === "text"
									? {
											...el,
											properties: {
												...el.properties,
												value: `${el.properties.value ?? ""}${"abcdefghij"[i % 10]}`,
												spans: undefined,
											},
										}
									: el,
							),
						{ mergeKey: "bench:type" },
					);
					await idle(f);
					const r = controller.state.render.timings;
					if (r) typed.push(r.total);
				}
				controller.undo();
			}

			const stage = (k: keyof RenderTimings) => stats(timings.map((x) => x[k]));
			return {
				sample,
				size: { width: t.width, height: t.height },
				latency: {
					renders: timings.length,
					total: stage("total"),
					perStage: {
						compile: stage("compile"),
						layout: stage("layout"),
						lower: stage("lower"),
						paint: stage("paint"),
					},
				},
				throughput: {
					frames,
					renders,
					perSecond: Math.round((renders / elapsed) * 1000 * 10) / 10,
				},
				jank: {
					frameGap: stats(gaps),
					slowFrames: gaps.filter((g) => g >= 50).length,
					longTasks: long,
				},
				previewMode: f.previewMode ?? "main",
				typing: { renders: typed.length, total: stats(typed) },
				cache: f.cacheStats(),
			};
		}
	}, [controller, sample, frames]);

	return (
		<div
			data-testid="bench-panel"
			className="pointer-events-auto absolute right-4 bottom-10 z-50 w-80 rounded-md border border-fc-border-strong bg-fc-panel p-3 font-fc-mono text-fc-sm shadow-lg"
		>
			<h2 className="mb-2 font-fc font-semibold text-fc-base">Benchmark</h2>
			{error ? (
				<p className="text-fc-danger">{error}</p>
			) : result ? (
				<pre className="whitespace-pre-wrap" data-testid="bench-result">
					{summary(result)}
				</pre>
			) : (
				<p className="text-fc-muted">Running…</p>
			)}
		</div>
	);
}

type Hooks = {
	previewMode?: string;
	renderIdle(): Promise<void>;
	renderStats(): unknown;
	cacheStats(): unknown;
};

function testHooks(): Hooks | undefined {
	const f = (window as unknown as { __freshcoat?: Partial<Hooks> }).__freshcoat;
	return f?.renderIdle ? (f as Hooks) : undefined;
}

async function waitFor<T>(get: () => T | undefined, ms = 20000): Promise<T> {
	const until = performance.now() + ms;
	for (;;) {
		const v = get();
		if (v) return v;
		if (performance.now() > until) throw new Error("timed out");
		await new Promise((r) => setTimeout(r, 50));
	}
}

function nextFrame(): Promise<void> {
	return new Promise((r) => requestAnimationFrame(() => r()));
}

async function idle(f: Hooks) {
	await nextFrame();
	await f.renderIdle();
}

/** Main-thread tasks of 50 ms or more from now until `stop`; null where the
 *  browser does not report them. */
function observeLongTasks() {
	const durations: number[] = [];
	let observer: PerformanceObserver | null = null;
	if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
		observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) durations.push(entry.duration);
		});
		observer.observe({ type: "longtask" });
	}
	return {
		stop() {
			if (!observer) return null;
			for (const entry of observer.takeRecords())
				durations.push(entry.duration);
			observer.disconnect();
			const r = (n: number) => Math.round(n * 10) / 10;
			return {
				count: durations.length,
				totalMs: r(durations.reduce((a, b) => a + b, 0)),
				maxMs: r(Math.max(0, ...durations)),
			};
		},
	};
}

function stats(xs: number[]): StageStats {
	const s = [...xs].sort((a, b) => a - b);
	const at = (q: number) =>
		s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
	const r = (n: number) => Math.round(n * 100) / 100;
	return { p50: r(at(0.5)), p95: r(at(0.95)), max: r(s.at(-1) ?? 0) };
}

function firstTextKey(
	t: { template_data: { elements: Element[] }[] },
	side: number,
): string | null {
	const i = t.template_data[side]?.elements.findIndex((e) => e.type === "text");
	return i === undefined || i < 0 ? null : `${side}/${i}`;
}

function summary(r: BenchResult): string {
	const l = r.latency;
	const s = (x: StageStats) => `${x.p50} / ${x.p95} / ${x.max}`;
	return [
		`${r.sample} ${r.size.width}×${r.size.height}, preview: ${r.previewMode}`,
		"ms        p50 / p95 / max",
		`total     ${s(l.total)}`,
		`compile   ${s(l.perStage.compile)}`,
		`layout    ${s(l.perStage.layout)}`,
		`lower     ${s(l.perStage.lower)}`,
		`paint     ${s(l.perStage.paint)}`,
		`typing    ${s(r.typing.total)}`,
		`drag      ${r.throughput.renders} renders / ${r.throughput.frames} frames, ${r.throughput.perSecond}/s`,
		`frame gap ${s(r.jank.frameGap)}, ${r.jank.slowFrames} ≥ 50 ms`,
		r.jank.longTasks
			? `long tasks ${r.jank.longTasks.count}, ${r.jank.longTasks.totalMs} ms, max ${r.jank.longTasks.maxMs}`
			: "long tasks not reported",
	].join("\n");
}
