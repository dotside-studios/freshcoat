import type { ExportPreset, Workspace } from "@freshcoat-js/workspace";
import type { RenderOutput } from "@freshcoat-js/workspace/export";
import { describe, expect, it, vi } from "vitest";
import {
	createExportRunner,
	type ExportRunnerDeps,
} from "~/export/use-export-runner";
import { minimal } from "~/samples/minimal";

const ws: Workspace = {
	formatVersion: "1.0",
	name: "W",
	templates: [{ id: "t_1", fileName: "minimal.coat", template: minimal() }],
	datasets: [],
	presets: [],
};

const preset: ExportPreset = {
	id: "p_1",
	name: "Run",
	templateId: "t_1",
	records: "all",
	sides: "all",
	format: "png-zip",
	scale: 1,
	dpi: 300,
	fileName: "",
	markExported: true,
};

function fakePool(size: number, opts: { hold?: boolean }) {
	const releases: (() => void)[] = [];
	return {
		size,
		releases,
		init: vi.fn(async () => {}),
		dispose: vi.fn(),
		endJob: vi.fn(),
		cancel: vi.fn(),
		render: vi.fn(
			() =>
				new Promise<RenderOutput>((resolve) => {
					const out: RenderOutput = {
						bytes: new Uint8Array([1]),
						format: "png",
						width: 1,
						height: 1,
						ms: 1,
					};
					if (opts.hold) releases.push(() => resolve(out));
					else resolve(out);
				}),
		),
	};
}

function deps(
	opts: { hold?: boolean; poolSize?: (px: number) => number } = {},
) {
	const fonts = new Map([["Vend Sans", [new Uint8Array([1])]]]);
	const pools: ReturnType<typeof fakePool>[] = [];
	const createPool = vi.fn((size: number) => {
		const pool = fakePool(size, opts);
		pools.push(pool);
		return pool;
	});
	const d: ExportRunnerDeps = {
		createPool,
		poolSize: opts.poolSize ?? (() => 1),
		resolveFonts: vi.fn(async () => fonts),
	};
	return { d, pools, createPool };
}

describe("export runner", () => {
	it("runs a job, reporting progress, and reuses one pool", async () => {
		const { d, pools, createPool } = deps();
		const runner = createExportRunner(d);
		const states: string[] = [];
		runner.subscribe(() => states.push(runner.getSnapshot().state));
		const result = await runner.start(ws, preset);
		expect(result?.file?.name).toBe("run.zip");
		expect(runner.getSnapshot()).toMatchObject({
			state: "done",
			progress: { done: 1, total: 1, failed: 0 },
		});
		expect(states[0]).toBe("running");
		expect(states.at(-1)).toBe("done");
		await runner.start(ws, preset);
		expect(createPool).toHaveBeenCalledTimes(1);
		expect(pools[0]?.init).toHaveBeenCalledTimes(1);
		runner.dispose();
		expect(pools[0]?.dispose).toHaveBeenCalled();
	});

	it("cancel resolves the job as cancelled", async () => {
		const { d, pools } = deps({ hold: true });
		const runner = createExportRunner(d);
		const running = runner.start(ws, preset);
		await vi.waitFor(() => expect(pools[0]?.render).toHaveBeenCalled());
		runner.cancel();
		const result = await running;
		expect(result?.cancelled).toBe(true);
		expect(result?.file).toBeUndefined();
		expect(runner.getSnapshot().state).toBe("cancelled");
		expect(pools[0]?.cancel).toHaveBeenCalled();
		expect(pools[0]?.endJob).toHaveBeenCalledTimes(1);
	});

	it("ends the job on the pool once it has rendered", async () => {
		const { d, pools } = deps({ hold: true });
		const runner = createExportRunner(d);
		const running = runner.start(ws, preset);
		await vi.waitFor(() => expect(pools[0]?.render).toHaveBeenCalled());
		expect(pools[0]?.endJob).not.toHaveBeenCalled();
		for (const release of pools[0]?.releases ?? []) release();
		await running;
		expect(pools[0]?.endJob).toHaveBeenCalledTimes(1);
	});

	it("a job a newer one replaced leaves the pool's caches to it", async () => {
		const { d, pools } = deps({ hold: true });
		const runner = createExportRunner(d);
		const first = runner.start(ws, preset);
		await vi.waitFor(() => expect(pools[0]?.render).toHaveBeenCalled());
		const second = runner.start(ws, preset);
		await first;
		expect(pools[0]?.endJob).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(pools[0]?.render).toHaveBeenCalledTimes(2));
		for (const release of pools[0]?.releases ?? []) release();
		await second;
		expect(pools[0]?.endJob).toHaveBeenCalledTimes(1);
	});

	it("a replacement that fails before rendering still ends the job", async () => {
		const { d, pools } = deps({ hold: true });
		const runner = createExportRunner(d);
		const first = runner.start(ws, preset);
		await vi.waitFor(() => expect(pools[0]?.render).toHaveBeenCalled());
		const second = runner.start(ws, { ...preset, templateId: "nope" });
		await first;
		expect(await second).toBe(null);
		expect(runner.getSnapshot().state).toBe("error");
		expect(pools[0]?.endJob).toHaveBeenCalledTimes(1);
	});

	it("a replacement cancelled while resolving fonts still ends the job", async () => {
		const { d, pools } = deps({ hold: true });
		let fontsResolved: (() => void) | undefined;
		d.resolveFonts = vi
			.fn(async () => new Map<string, Uint8Array[]>())
			.mockImplementationOnce(async () => new Map())
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						fontsResolved = () => resolve(new Map());
					}),
			);
		const runner = createExportRunner(d);
		const first = runner.start(ws, preset);
		await vi.waitFor(() => expect(pools[0]?.render).toHaveBeenCalled());
		const second = runner.start(ws, preset);
		await first;
		runner.cancel();
		fontsResolved?.();
		expect(await second).toBe(null);
		expect(runner.getSnapshot().state).toBe("cancelled");
		expect(pools[0]?.endJob).toHaveBeenCalledTimes(1);
	});

	it("rebuilds the pool when a job's photos want another size", async () => {
		const photos = (pixels: number): Workspace => ({
			...ws,
			templates: [
				{
					...ws.templates[0],
					binding: {
						datasetId: "d_1",
						fields: { displayName: { kind: "column", column: "photo" } },
					},
				},
			] as Workspace["templates"],
			datasets: [
				{
					id: "d_1",
					name: "Photos",
					columns: [{ key: "photo", type: "image" }],
					records: [
						{ id: "r_1", status: "pending", values: { photo: "ws:a" } },
					],
					assets: [
						{
							sha256: "a",
							contentType: "image/jpeg",
							name: "a.jpg",
							size: 1,
							width: pixels / 1000,
							height: 1000,
							blob: new Blob([]),
						},
					],
				},
			],
		});
		const { d, pools, createPool } = deps({
			poolSize: (px) => (px > 24_000_000 ? 2 : 3),
		});
		const runner = createExportRunner(d);
		await runner.start(photos(12_000_000), preset);
		await runner.start(photos(12_000_000), preset);
		await runner.start(photos(50_000_000), preset);
		expect(createPool.mock.calls.map((c) => c[0])).toEqual([3, 2]);
		expect(pools[0]?.dispose).toHaveBeenCalled();
		expect(pools[1]?.init).toHaveBeenCalledTimes(1);
	});

	it("an unknown template is an error state", async () => {
		const { d } = deps();
		const runner = createExportRunner(d);
		expect(await runner.start(ws, { ...preset, templateId: "nope" })).toBe(
			null,
		);
		expect(runner.getSnapshot().state).toBe("error");
		expect(runner.getSnapshot().error).toMatch(/template/);
	});
});
