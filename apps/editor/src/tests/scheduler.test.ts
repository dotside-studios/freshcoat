import { describe, expect, test } from "vitest";
import { createRenderScheduler } from "~/render/scheduler";

function harness() {
	const frames: (() => void)[] = [];
	const runs: number[] = [];
	const results: number[] = [];
	const resolvers: (() => void)[] = [];
	let clock = 0;
	const scheduler = createRenderScheduler<number, number>(
		(input) =>
			new Promise<number>((resolve) => {
				runs.push(input);
				resolvers.push(() => {
					clock += 10;
					resolve(input * 2);
				});
			}),
		{
			onResult: (output) => results.push(output),
			onError: () => {},
		},
		{ raf: (cb) => frames.push(cb), now: () => clock },
	);
	const flushFrame = () => frames.shift()?.();
	const finish = async () => {
		resolvers.shift()?.();
		await new Promise((r) => setTimeout(r, 0));
	};
	return { scheduler, runs, results, flushFrame, finish, frames };
}

describe("render scheduler", () => {
	test("starts on the next frame and renders the latest input", async () => {
		const h = harness();
		h.scheduler.request(1);
		h.scheduler.request(2);
		expect(h.runs).toEqual([]);
		h.flushFrame();
		expect(h.runs).toEqual([2]);
		await h.finish();
		expect(h.results).toEqual([4]);
		expect(h.scheduler.stats().coalesced).toBe(1);
	});

	test("keeps one render in flight and coalesces requests made meanwhile", async () => {
		const h = harness();
		h.scheduler.request(1);
		h.flushFrame();
		h.scheduler.request(2);
		h.scheduler.request(3);
		h.scheduler.request(4);
		expect(h.frames).toHaveLength(0);
		await h.finish();
		expect(h.frames).toHaveLength(1);
		h.flushFrame();
		expect(h.runs).toEqual([1, 4]);
		await h.finish();
		expect(h.results).toEqual([2, 8]);
		const stats = h.scheduler.stats();
		expect(stats.completed).toBe(2);
		expect(stats.coalesced).toBe(2);
		expect(stats.p50).toBe(10);
	});

	test("idle resolves once nothing is pending", async () => {
		const h = harness();
		let idle = false;
		h.scheduler.request(1);
		h.scheduler.idle().then(() => {
			idle = true;
		});
		h.flushFrame();
		await h.finish();
		expect(idle).toBe(true);
	});

	test("dispose drops pending work", async () => {
		const h = harness();
		h.scheduler.request(1);
		h.scheduler.dispose();
		h.flushFrame();
		expect(h.runs).toEqual([]);
	});
});
