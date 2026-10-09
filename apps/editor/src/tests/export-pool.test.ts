import type { RenderRequest } from "@freshcoat-js/workspace/export";
import { describe, expect, it } from "vitest";
import type { WorkerReply, WorkerRequest } from "~/export/protocol";
import { createWorkerPool, type PoolWorker } from "~/export/worker-pool";

class FakeWorker implements PoolWorker {
	static all: FakeWorker[] = [];
	readonly index: number;
	received: WorkerRequest[] = [];
	terminated = false;
	onmessage: ((event: MessageEvent<WorkerReply>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;

	constructor() {
		this.index = FakeWorker.all.length;
		FakeWorker.all.push(this);
	}

	postMessage(message: WorkerRequest) {
		this.received.push(message);
	}

	terminate() {
		this.terminated = true;
	}

	emit(reply: WorkerReply) {
		this.onmessage?.({ data: reply } as MessageEvent<WorkerReply>);
	}

	renders() {
		return this.received.filter(
			(m): m is Extract<WorkerRequest, { type: "render" }> =>
				m.type === "render",
		);
	}

	/** Answers the last render it was sent. */
	finish(ok = true) {
		const last = this.renders().at(-1);
		if (!last) throw new Error("nothing to finish");
		this.emit(
			ok
				? {
						type: "render",
						id: last.id,
						ok: true,
						bytes: new Uint8Array([this.index]),
						format: "png",
						width: 10,
						height: 5,
						ms: 1,
					}
				: { type: "render", id: last.id, ok: false, error: "boom" },
		);
	}
}

function fakePool(size: number) {
	FakeWorker.all = [];
	const pool = createWorkerPool(size, () => new FakeWorker());
	return { pool, workers: FakeWorker.all };
}

const request = (side: string): RenderRequest => ({
	template: {} as RenderRequest["template"],
	values: {},
	side,
	scale: 1,
	images: [],
	format: "png",
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("worker pool", () => {
	it("dispatches round-robin to idle workers and queues the rest FIFO", async () => {
		const { pool, workers } = fakePool(2);
		const results = ["a", "b", "c", "d"].map((s) => pool.render(request(s)));
		expect(workers).toHaveLength(2);
		expect(workers.map((w) => w.renders().map((r) => r.side))).toEqual([
			["a"],
			["b"],
		]);
		workers[1].finish();
		expect(workers[1].renders().map((r) => r.side)).toEqual(["b", "c"]);
		workers[0].finish();
		expect(workers[0].renders().map((r) => r.side)).toEqual(["a", "d"]);
		workers[0].finish();
		workers[1].finish();
		const out = await Promise.all(results);
		expect(out.map((o) => o.bytes[0])).toEqual([0, 1, 1, 0]);
		expect(out[0]).toMatchObject({ width: 10, height: 5 });
	});

	it("rotates the starting worker even when all are idle", async () => {
		const { pool, workers } = fakePool(3);
		const first = pool.render(request("a"));
		workers[0].finish();
		await first;
		const second = pool.render(request("b"));
		expect(workers[1].renders().map((r) => r.side)).toEqual(["b"]);
		workers[1].finish();
		await second;
	});

	it("hands back what the print path reported with the bytes", async () => {
		const { pool, workers } = fakePool(1);
		const out = pool.render({ ...request("front"), print: { analyze: true } });
		const sent = workers[0]?.renders()[0];
		expect(sent?.print).toEqual({ analyze: true });
		workers[0]?.emit({
			type: "render",
			id: sent?.id ?? 0,
			ok: true,
			bytes: new Uint8Array([1]),
			format: "png",
			width: 10,
			height: 5,
			ms: 1,
			print: "fallback",
			printError: "no SkSL",
			gamut: [{ clipped: 0.1, pullback: 1 }],
		});
		expect(await out).toMatchObject({
			print: "fallback",
			printError: "no SkSL",
			gamut: [{ clipped: 0.1, pullback: 1 }],
		});
	});

	it("rejects a render the worker reports as failed", async () => {
		const { pool, workers } = fakePool(1);
		const p = pool.render(request("a"));
		workers[0].finish(false);
		await expect(p).rejects.toThrow("boom");
	});

	it("init sends fonts to every worker and waits until each is ready", async () => {
		const { pool, workers } = fakePool(2);
		const fonts = new Map([["Inter", [new Uint8Array([1])]]]);
		let ready = false;
		const init = pool.init(fonts).then(() => {
			ready = true;
		});
		expect(workers).toHaveLength(2);
		for (const w of workers)
			expect(w.received[0]).toEqual({
				type: "init",
				fonts: [["Inter", [new Uint8Array([1])]]],
			});
		workers[0].emit({ type: "ready", ok: true, ms: 1 });
		await flush();
		expect(ready).toBe(false);
		workers[1].emit({ type: "ready", ok: true, ms: 1 });
		await init;
		expect(ready).toBe(true);
	});

	it("init rejects when a worker cannot load CanvasKit", async () => {
		const { pool, workers } = fakePool(1);
		const init = pool.init(new Map());
		workers[0].emit({ type: "ready", ok: false, error: "no wasm" });
		await expect(init).rejects.toThrow("no wasm");
	});

	it("endJob tells every live worker the job is over, after its renders", async () => {
		const { pool, workers } = fakePool(2);
		const busy = pool.render(request("a"));
		pool.endJob();
		expect(workers).toHaveLength(1);
		expect(workers[0].received.map((m) => m.type)).toEqual([
			"render",
			"jobEnd",
		]);
		workers[0].finish();
		await busy;
	});

	it("cancel rejects queued work, terminates busy workers and replaces them lazily", async () => {
		const { pool, workers } = fakePool(2);
		const fonts = new Map([["Inter", [new Uint8Array([1])]]]);
		void pool.init(fonts);
		for (const w of workers) w.emit({ type: "ready", ok: true, ms: 1 });
		const all = Promise.allSettled(
			["a", "b", "c", "d"].map((side) => pool.render(request(side))),
		);
		pool.cancel();
		const settled = await all;
		expect(settled.every((s) => s.status === "rejected")).toBe(true);
		expect((settled[2] as PromiseRejectedResult).reason.name).toBe(
			"AbortError",
		);
		expect(workers[0].terminated).toBe(true);
		expect(workers[1].terminated).toBe(true);
		expect(workers).toHaveLength(2);

		const after = pool.render(request("d"));
		expect(workers).toHaveLength(3);
		const fresh = workers[2];
		expect(fresh.received.map((m) => m.type)).toEqual(["init", "render"]);
		fresh.finish();
		await expect(after).resolves.toMatchObject({ width: 10 });
	});

	it("keeps idle workers across a cancel", async () => {
		const { pool, workers } = fakePool(2);
		const busy = pool.render(request("a"));
		pool.cancel();
		await expect(busy).rejects.toThrow("cancelled");
		expect(workers[0].terminated).toBe(true);
		const next = pool.render(request("b"));
		expect(workers).toHaveLength(2);
		expect(workers[1].renders().map((r) => r.side)).toEqual(["b"]);
		workers[1].finish();
		await next;
	});

	it("a worker that crashes fails its render and is replaced", async () => {
		const { pool, workers } = fakePool(1);
		const p = pool.render(request("a"));
		workers[0].onerror?.({ message: "oom" } as ErrorEvent);
		await expect(p).rejects.toThrow("oom");
		expect(workers[0].terminated).toBe(true);
		const q = pool.render(request("b"));
		expect(workers).toHaveLength(2);
		workers[1].finish();
		await q;
	});

	it("dispose terminates everything and refuses new work", async () => {
		const { pool, workers } = fakePool(2);
		const init = pool.init(new Map()).catch((e: Error) => e.name);
		const p = pool.render(request("a"));
		pool.dispose();
		await expect(p).rejects.toThrow();
		expect(workers.every((w) => w.terminated)).toBe(true);
		await expect(init).resolves.toBe("AbortError");
		await expect(pool.render(request("b"))).rejects.toThrow("disposed");
	});

	it("sends each render only the photos it names, as Blobs", () => {
		const { pool, workers } = fakePool(1);
		const photo = new Blob([new Uint8Array([1])]);
		void pool.render({ ...request("a"), images: [["ws:a", photo]] });
		const sent = workers[0].renders()[0];
		expect(sent?.images).toEqual([["ws:a", photo]]);
		expect(sent?.images[0]?.[1]).toBe(photo);
	});

	it("sends a worker the template only when it changes", async () => {
		const { pool, workers } = fakePool(1);
		const template = {} as RenderRequest["template"];
		const other = {} as RenderRequest["template"];
		for (const t of [template, template, other]) {
			const p = pool.render({ ...request("a"), template: t });
			workers[0].finish();
			await p;
		}
		const sent = workers[0].renders().map((r) => r.template);
		expect(sent[0]).toBe(template);
		expect("template" in workers[0].renders()[1]).toBe(false);
		expect(sent[2]).toBe(other);
	});

	it("a replacement worker is sent the template again", async () => {
		const { pool, workers } = fakePool(1);
		const template = {} as RenderRequest["template"];
		const p = pool.render({ ...request("a"), template });
		workers[0].onerror?.({ message: "oom" } as ErrorEvent);
		await expect(p).rejects.toThrow("oom");
		void pool.render({ ...request("b"), template });
		expect(workers[1].renders()[0]?.template).toBe(template);
	});
});
