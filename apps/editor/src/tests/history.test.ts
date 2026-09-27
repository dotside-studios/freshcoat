import type { Template } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import {
	begin,
	cancel,
	canRedo,
	canUndo,
	commit,
	createHistory,
	end,
	HISTORY_CAP,
	preview,
	redo,
	undo,
} from "../doc/history";
import { deepFreeze, doc } from "./doc-fixture";

const base = deepFreeze(doc());
const v = (name: string): Template => ({ ...base, name });

describe("commit", () => {
	test("pushes the present and clears the future", () => {
		const a = v("a");
		const b = v("b");
		let h = commit(createHistory(base), a, { now: 0 });
		h = commit(h, b, { now: 5000 });
		expect(h.past).toEqual([base, a]);
		expect(h.present).toBe(b);
		h = undo(h);
		expect(h.future).toEqual([b]);
		h = commit(h, v("c"), { now: 9000 });
		expect(h.future).toEqual([]);
	});

	test("committing the present is a no-op", () => {
		const h = createHistory(base);
		expect(commit(h, base)).toBe(h);
	});

	test("merges a burst with the same key inside the window", () => {
		let h = createHistory(base);
		h = commit(h, v("1"), { mergeKey: "x", now: 0 });
		h = commit(h, v("2"), { mergeKey: "x", now: 400 });
		h = commit(h, v("3"), { mergeKey: "x", now: 1300 });
		expect(h.past).toEqual([base]);
		expect(h.present.name).toBe("3");
		expect(undo(h).present).toBe(base);
	});

	test("does not merge across keys, gaps, or unkeyed commits", () => {
		let h = createHistory(base);
		h = commit(h, v("1"), { mergeKey: "x", now: 0 });
		h = commit(h, v("2"), { mergeKey: "y", now: 10 });
		expect(h.past.length).toBe(2);
		h = commit(h, v("3"), { mergeKey: "y", now: 1100 });
		expect(h.past.length).toBe(3);
		h = commit(h, v("4"), { now: 1200 });
		h = commit(h, v("5"), { mergeKey: "y", now: 1300 });
		expect(h.past.length).toBe(5);
	});

	test("an undo breaks a merge run", () => {
		let h = createHistory(base);
		h = commit(h, v("1"), { mergeKey: "x", now: 0 });
		h = commit(h, v("2"), { mergeKey: "x", now: 100 });
		h = undo(h);
		h = commit(h, v("3"), { mergeKey: "x", now: 200 });
		expect(h.past).toEqual([base]);
		expect(h.present.name).toBe("3");
	});

	test("is capped at the history limit", () => {
		let h = createHistory(base);
		for (let i = 0; i < HISTORY_CAP + 50; i++)
			h = commit(h, v(String(i)), { now: i * 5000 });
		expect(h.past.length).toBe(HISTORY_CAP);
		expect(h.past[0].name).toBe("49");
		expect(h.present.name).toBe(String(HISTORY_CAP + 49));
	});
});

describe("transactions", () => {
	test("previews do not touch the past and end commits once", () => {
		let h = commit(createHistory(base), v("start"), { now: 0 });
		h = begin(h);
		for (let i = 0; i < 30; i++) h = preview(h, v(`drag${i}`));
		expect(h.past.length).toBe(1);
		expect(h.present.name).toBe("drag29");
		h = end(h);
		expect(h.tx).toBeUndefined();
		expect(h.past.map((t) => t.name)).toEqual(["Doc", "start"]);
		expect(undo(h).present.name).toBe("start");
	});

	test("end without changes records nothing", () => {
		const h0 = commit(createHistory(base), v("start"), { now: 0 });
		const h = end(preview(begin(h0), h0.present));
		expect(h.past).toBe(h0.past);
		expect(h.present).toBe(h0.present);
		expect(h.tx).toBeUndefined();
		expect(end(h0)).toBe(h0);
	});

	test("cancel restores the base", () => {
		let h = begin(createHistory(base));
		h = preview(h, v("moved"));
		h = cancel(h);
		expect(h.present).toBe(base);
		expect(h.tx).toBeUndefined();
		expect(h.past).toEqual([]);
	});

	test("preview opens a transaction, and begin keeps the first base", () => {
		let h = preview(createHistory(base), v("a"));
		expect(h.tx?.base).toBe(base);
		h = begin(h);
		expect(h.tx?.base).toBe(base);
	});

	test("commit during a transaction only previews", () => {
		let h = begin(createHistory(base));
		h = commit(h, v("a"));
		expect(h.past).toEqual([]);
		expect(end(h).past).toEqual([base]);
	});

	test("undo during a transaction cancels it; redo is inert", () => {
		const h0 = commit(createHistory(base), v("a"), { now: 0 });
		const h = preview(begin(h0), v("b"));
		expect(canUndo(h)).toBe(true);
		expect(canRedo(h)).toBe(false);
		expect(undo(h).present.name).toBe("a");
		expect(redo(h)).toBe(h);
	});
});

describe("undo and redo", () => {
	test("move one step and are no-ops at the edges", () => {
		const h0 = createHistory(base);
		expect(undo(h0)).toBe(h0);
		expect(redo(h0)).toBe(h0);
		expect(canUndo(h0)).toBe(false);
		let h = commit(h0, v("a"), { now: 0 });
		h = commit(h, v("b"), { now: 5000 });
		h = undo(undo(h));
		expect(h.present).toBe(base);
		expect(canRedo(h)).toBe(true);
		h = redo(h);
		expect(h.present.name).toBe("a");
		h = redo(redo(h));
		expect(h.present.name).toBe("b");
		expect(canRedo(h)).toBe(false);
	});
});
