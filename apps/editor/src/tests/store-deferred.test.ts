import type { Template } from "@freshcoat-js/coatfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EditorController } from "~/app/controller";
import { MERGE_WINDOW_MS } from "~/doc/history";
import { removeElements, unwrap, updateElement } from "~/doc/ops";
import * as path from "~/doc/path";
import { createEditorStore } from "~/state/store";
import { TemplateSchema } from "../../../../packages/coatfile/src/schemas";
import { doc } from "./doc-fixture";

vi.mock("~/doc/path", async (actual) => {
	const mod = await actual<typeof import("~/doc/path")>();
	return { ...mod, keyRemapper: vi.fn(mod.keyRemapper) };
});

const keyRemapper = vi.mocked(path.keyRemapper);

function opened() {
	const store = createEditorStore();
	store.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	return store;
}

const t = (store: ReturnType<typeof opened>) =>
	// biome-ignore lint/style/noNonNullAssertion: opened() always has a doc
	store.getState().doc!.history.present;

const withText = (template: Template, value: string) =>
	unwrap(
		updateElement(template, "0/4", (el) =>
			el.type === "text"
				? { ...el, properties: { ...el.properties, value } }
				: el,
		),
	).template;

const moved = (template: Template, x: number) =>
	unwrap(updateElement(template, "0/0", { pos: { x, y: 0 } })).template;

function swapFirstTwo(template: Template): Template {
	const [front, ...rest] = template.template_data;
	if (!front) return template;
	const [a, b, ...others] = front.elements;
	if (!a || !b) return template;
	return {
		...template,
		template_data: [{ ...front, elements: [b, a, ...others] }, ...rest],
	};
}

const safeParse = vi.spyOn(TemplateSchema, "safeParse");

beforeEach(() => {
	safeParse.mockClear();
	keyRemapper.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("deferred validation", () => {
	test("a 50-step scrub validates once, when the merge window closes", () => {
		vi.useFakeTimers();
		const controller = new EditorController(opened());
		const store = controller.store;
		safeParse.mockClear();
		for (let x = 1; x <= 50; x++)
			store.dispatch({
				type: "commit",
				next: moved(t(store), x),
				mergeKey: "scrub",
			});
		store.dispatch({
			type: "commit",
			next: withText(t(store), "{{nope}}"),
			mergeKey: "scrub",
		});
		expect(safeParse).not.toHaveBeenCalled();
		expect(store.getState().doc?.history.past).toHaveLength(1);
		vi.advanceTimersByTime(MERGE_WINDOW_MS);
		expect(safeParse).toHaveBeenCalledTimes(1);
		expect(store.getState().doc?.issuesStale).toBe(false);
		expect(store.getState().doc?.issues.map((i) => i.code)).toContain(
			"unknown_field_reference",
		);
	});

	test("a transaction validates at txEnd only", () => {
		const store = opened();
		safeParse.mockClear();
		store.dispatch({ type: "txBegin" });
		for (let x = 1; x <= 50; x++)
			store.dispatch({ type: "commit", next: moved(t(store), x) });
		store.dispatch({
			type: "txPreview",
			next: withText(t(store), "{{nope}}"),
		});
		expect(safeParse).not.toHaveBeenCalled();
		store.dispatch({ type: "txEnd" });
		expect(safeParse).toHaveBeenCalledTimes(1);
		expect(store.getState().doc?.issues.map((i) => i.code)).toContain(
			"unknown_field_reference",
		);
		store.dispatch({ type: "undo" });
		expect(store.getState().doc?.issues).toEqual([]);
	});

	test("a commit without a merge key settles stale issues", () => {
		const store = opened();
		store.dispatch({
			type: "commit",
			next: withText(t(store), "{{nope}}"),
			mergeKey: "text",
		});
		expect(store.getState().doc?.issues).toEqual([]);
		store.dispatch({ type: "commit", next: moved(t(store), 5) });
		expect(store.getState().doc?.issues.map((i) => i.code)).toContain(
			"unknown_field_reference",
		);
	});

	test("switching templates settles the one being parked", () => {
		const store = opened();
		store.dispatch({
			type: "commit",
			next: withText(t(store), "{{nope}}"),
			mergeKey: "text",
		});
		const id = store.getState().workspace?.activeTemplateId as string;
		store.dispatch({ type: "addTemplate", template: doc(), fileName: "b" });
		store.dispatch({ type: "switchTemplate", id });
		expect(store.getState().doc?.issues.map((i) => i.code)).toContain(
			"unknown_field_reference",
		);
	});
});

describe("deferred key remapping", () => {
	test("a 50-step drag preview remaps once", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/0", "0/1/0"] });
		store.dispatch({ type: "toggleHidden", key: "0/2" });
		store.dispatch({ type: "toggleLocked", key: "0/3" });
		const { selection, hidden, locked } = store.getState();
		keyRemapper.mockClear();
		store.dispatch({ type: "txBegin" });
		for (let x = 1; x <= 50; x++)
			store.dispatch({ type: "txPreview", next: moved(t(store), x) });
		expect(keyRemapper).not.toHaveBeenCalled();
		expect(store.getState().selection).toBe(selection);
		expect(store.getState().hidden).toBe(hidden);
		expect(store.getState().locked).toBe(locked);
		store.dispatch({ type: "txEnd" });
		expect(keyRemapper).toHaveBeenCalledTimes(1);
		expect(store.getState().selection).toEqual(["0/0", "0/1/0"]);
		expect([...store.getState().hidden]).toEqual(["0/2"]);
		expect([...store.getState().locked]).toEqual(["0/3"]);
		expect(store.getState().doc?.keysAt).toBeUndefined();
	});

	test("a structural preview remaps at once and txEnd carries the rest", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/2"] });
		store.dispatch({ type: "toggleHidden", key: "0/3" });
		store.dispatch({ type: "toggleLocked", key: "0/4" });
		store.dispatch({ type: "txBegin" });
		store.dispatch({ type: "txPreview", next: moved(t(store), 1) });
		const removed = unwrap(removeElements(t(store), ["0/0"])).template;
		store.dispatch({ type: "txPreview", next: removed });
		expect(store.getState().selection).toEqual(["0/1"]);
		expect([...store.getState().hidden]).toEqual(["0/2"]);
		expect([...store.getState().locked]).toEqual(["0/3"]);
		store.dispatch({ type: "txPreview", next: swapFirstTwo(t(store)) });
		store.dispatch({ type: "txEnd" });
		const s = store.getState();
		const at = (k: string) => path.getElement(t(store), k)?.id;
		expect(s.selection.map(at)).toEqual(["m"]);
		expect([...s.hidden].map(at)).toEqual(["row"]);
		expect([...s.locked].map(at)).toEqual(["title"]);
	});

	test("cancel maps keys back to the base", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/2"] });
		store.dispatch({ type: "toggleHidden", key: "0/3" });
		store.dispatch({ type: "txBegin" });
		store.dispatch({
			type: "txPreview",
			next: unwrap(removeElements(t(store), ["0/0"])).template,
		});
		store.dispatch({ type: "txPreview", next: moved(t(store), 3) });
		store.dispatch({ type: "txCancel" });
		expect(store.getState().selection).toEqual(["0/2"]);
		expect([...store.getState().hidden]).toEqual(["0/3"]);
	});

	test("sameStructure tells edits in place from structural ones", () => {
		const base = doc();
		expect(path.sameStructure(base, moved(base, 9))).toBe(true);
		expect(
			path.sameStructure(
				base,
				unwrap(removeElements(base, ["0/1/2/0"])).template,
			),
		).toBe(false);
	});
});
