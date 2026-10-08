import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeAutosave } from "~/app/autosave";
import { EditorController } from "~/app/controller";
import type { Action } from "~/state/store";
import { doc } from "./doc-fixture";

vi.mock("~/app/autosave", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/app/autosave")>()),
	writeAutosave: vi.fn(async () => {}),
}));

const rendered: Action = {
	type: "rendered",
	geometry: new Map(),
	timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
	stats: {
		completed: 1,
		coalesced: 0,
		p50: 0,
		p95: 0,
		max: 0,
		perSecond: 1,
	},
	warnings: [],
} as unknown as Action;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.mocked(writeAutosave).mockClear();
});

describe("autosave scheduling", () => {
	it("does not re-arm for rendered and hover dispatches", () => {
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		vi.advanceTimersByTime(2000);
		c.select(["0/0"]);
		c.deleteSelection();
		for (let i = 0; i < 3; i++) {
			vi.advanceTimersByTime(300);
			c.dispatch(rendered);
			c.dispatch({ type: "hover", key: i % 2 ? "0/1" : null });
		}
		vi.advanceTimersByTime(100);
		expect(writeAutosave).toHaveBeenCalledTimes(1);

		c.dispatch(rendered);
		c.dispatch({ type: "hover", key: "0/2" });
		vi.advanceTimersByTime(2000);
		expect(writeAutosave).toHaveBeenCalledTimes(1);
	});
});

describe("recent workspaces", () => {
	it("writes the autosave for the recent entry of the workspace it opened", async () => {
		const record = vi.fn(async () => {});
		const { recentStore } = await import("~/app/recent");
		vi.spyOn(recentStore(), "record").mockImplementation(record);
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		expect(record).toHaveBeenCalledOnce();
		const [entry] = record.mock.calls[0] as unknown as [
			{ id: string; source: { kind: string } },
		];
		expect(entry.source.kind).toBe("workspace");
		c.select(["0/0"]);
		c.deleteSelection();
		vi.advanceTimersByTime(2000);
		expect(vi.mocked(writeAutosave).mock.calls[0]?.[0].recentId).toBe(entry.id);

		const saved = {
			...(vi.mocked(writeAutosave).mock.calls[0]?.[0] as Parameters<
				typeof writeAutosave
			>[0]),
			savedAt: 1,
		};
		c.restore(saved);
		expect(record).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: entry.id }),
		);
	});
});
