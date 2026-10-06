import { afterEach, describe, expect, it, vi } from "vitest";
import { type CardsView, createCardsPublisher } from "~/main/cards-publisher";
import type { CardsMessage } from "~/shared/protocol";

const view = (pageName: string): CardsView => ({
	cards: [],
	nodes: [],
	pageName,
});

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function setup(compute: () => Promise<CardsView>) {
	const posted: CardsMessage[] = [];
	let selected: string | null = null;
	const publisher = createCardsPublisher({
		compute,
		selected: () => ({ selectedCardId: selected, selectedNodeId: selected }),
		post: (msg) => posted.push(msg),
	});
	return {
		publisher,
		posted,
		select: (id: string | null) => {
			selected = id;
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("createCardsPublisher", () => {
	it("reuses the cached view and re-derives only the selection", async () => {
		const compute = vi.fn(async () => view("p"));
		const { publisher, posted, select } = setup(compute);
		await publisher.publish();
		select("a");
		await publisher.publish();
		expect(compute).toHaveBeenCalledTimes(1);
		expect(posted).toEqual([
			{
				type: "cards",
				...view("p"),
				selectedCardId: null,
				selectedNodeId: null,
			},
			{ type: "cards", ...view("p"), selectedCardId: "a", selectedNodeId: "a" },
		]);
	});

	it("recomputes after invalidate", async () => {
		let n = 0;
		const compute = vi.fn(async () => view(`p${++n}`));
		const { publisher, posted } = setup(compute);
		await publisher.publish();
		publisher.invalidate();
		await publisher.publish();
		expect(compute).toHaveBeenCalledTimes(2);
		expect(posted.map((m) => m.pageName)).toEqual(["p1", "p2"]);
	});

	it("drops a slower, older publish so it cannot overwrite a newer one", async () => {
		const first = deferred<CardsView>();
		const compute = vi
			.fn<() => Promise<CardsView>>()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(view("new"));
		const { publisher, posted } = setup(compute);
		const older = publisher.publish();
		publisher.invalidate();
		await publisher.publish();
		first.resolve(view("old"));
		await older;
		expect(posted.map((m) => m.pageName)).toEqual(["new"]);
	});

	it("recomputes when invalidated while a compute is in flight", async () => {
		const first = deferred<CardsView>();
		const compute = vi
			.fn<() => Promise<CardsView>>()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(view("fresh"));
		const { publisher, posted } = setup(compute);
		const pending = publisher.publish();
		publisher.invalidate();
		first.resolve(view("stale"));
		await pending;
		expect(posted.map((m) => m.pageName)).toEqual(["fresh"]);
	});

	it("does not cache a failed compute", async () => {
		const compute = vi
			.fn<() => Promise<CardsView>>()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(view("p"));
		const { publisher, posted } = setup(compute);
		await publisher.publish();
		await publisher.publish();
		expect(posted.map((m) => m.pageName)).toEqual(["p"]);
	});

	it("coalesces a burst of scheduled publishes into one post", async () => {
		vi.useFakeTimers();
		const { publisher, posted, select } = setup(async () => view("p"));
		select("a");
		publisher.schedule();
		select("b");
		publisher.schedule();
		select("c");
		publisher.schedule();
		await vi.runAllTimersAsync();
		expect(posted.map((m) => m.selectedCardId)).toEqual(["c"]);
	});

	it("an immediate publish cancels a pending scheduled one", async () => {
		vi.useFakeTimers();
		const { publisher, posted } = setup(async () => view("p"));
		publisher.schedule();
		await publisher.publish();
		await vi.runAllTimersAsync();
		expect(posted).toHaveLength(1);
	});

	it("serves the cached view to an export without recomputing", async () => {
		const compute = vi.fn(async () => view("p"));
		const { publisher } = setup(compute);
		await publisher.publish();
		expect(await publisher.view()).toEqual(view("p"));
		expect(await publisher.view()).toEqual(view("p"));
		expect(compute).toHaveBeenCalledTimes(1);
		publisher.invalidate();
		await publisher.view();
		expect(compute).toHaveBeenCalledTimes(2);
	});

	it("does not serve a view invalidated while it was computing", async () => {
		const first = deferred<CardsView>();
		const compute = vi
			.fn<() => Promise<CardsView>>()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(view("new"));
		const { publisher } = setup(compute);
		const pending = publisher.view();
		publisher.invalidate();
		first.resolve(view("old"));
		expect(await pending).toEqual(view("new"));
	});
});
