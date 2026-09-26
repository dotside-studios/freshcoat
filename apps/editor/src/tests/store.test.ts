import { describe, expect, test } from "vitest";
import {
	removeElements,
	renameElement,
	unwrap,
	updateElement,
} from "~/doc/ops";
import {
	createEditorStore,
	initialState,
	isDirty,
	reduce,
} from "~/state/store";
import { workspaceSnapshot } from "~/state/workspace";
import { doc } from "./doc-fixture";

function opened() {
	const store = createEditorStore();
	store.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	return store;
}

const t = (store: ReturnType<typeof opened>) =>
	// biome-ignore lint/style/noNonNullAssertion: opened() always has a doc
	store.getState().doc!.history.present;

describe("editor store", () => {
	test("open seeds values, history and a clean state", () => {
		const store = opened();
		const s = store.getState();
		expect(s.doc?.fileName).toBe("doc.coat");
		expect(s.values.name).toBeDefined();
		expect(isDirty(s)).toBe(false);
		expect(s.doc?.issues).toEqual([]);
	});

	test("commit makes the document dirty and undo cleans it", () => {
		const store = opened();
		const next = unwrap(updateElement(t(store), "0/0", { opacity: 0.5 }));
		store.dispatch({ type: "commit", next: next.template });
		expect(isDirty(store.getState())).toBe(true);
		store.dispatch({ type: "undo" });
		expect(isDirty(store.getState())).toBe(false);
		store.dispatch({ type: "redo" });
		expect(isDirty(store.getState())).toBe(true);
	});

	test("selection follows a layer when the tree above it changes", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/1"] });
		const next = unwrap(removeElements(t(store), ["0/0"]));
		store.dispatch({ type: "commit", next: next.template });
		expect(store.getState().selection).toEqual(["0/0"]);
		store.dispatch({ type: "undo" });
		expect(store.getState().selection).toEqual(["0/1"]);
	});

	test("hidden and locked layers are remapped like the selection", () => {
		const store = opened();
		store.dispatch({ type: "toggleHidden", key: "0/1" });
		store.dispatch({ type: "toggleLocked", key: "0/2" });
		const next = unwrap(removeElements(t(store), ["0/0"]));
		store.dispatch({ type: "commit", next: next.template });
		expect([...store.getState().hidden]).toEqual(["0/0"]);
		expect([...store.getState().locked]).toEqual(["0/1"]);
	});

	test("select modes replace, add and toggle", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/0"] });
		store.dispatch({ type: "select", keys: ["0/1"], mode: "add" });
		expect(store.getState().selection).toEqual(["0/0", "0/1"]);
		store.dispatch({ type: "select", keys: ["0/0"], mode: "toggle" });
		expect(store.getState().selection).toEqual(["0/1"]);
		store.dispatch({ type: "select", keys: ["9/9"] });
		expect(store.getState().selection).toEqual([]);
	});

	test("locking a selected layer deselects it", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/0"] });
		store.dispatch({ type: "toggleLocked", key: "0/0" });
		expect(store.getState().selection).toEqual([]);
	});

	test("a transaction previews without history and ends as one step", () => {
		const store = opened();
		const base = t(store);
		store.dispatch({ type: "txBegin" });
		for (const x of [10, 20, 30]) {
			const next = unwrap(updateElement(t(store), "0/0", { pos: { x, y: 0 } }));
			store.dispatch({ type: "txPreview", next: next.template });
		}
		expect(store.getState().doc?.history.past).toHaveLength(0);
		store.dispatch({ type: "txEnd" });
		expect(store.getState().doc?.history.past).toEqual([base]);
		store.dispatch({ type: "undo" });
		expect(t(store)).toBe(base);
	});

	test("cancel restores the base", () => {
		const store = opened();
		const base = t(store);
		store.dispatch({ type: "txBegin" });
		const next = unwrap(updateElement(t(store), "0/0", { opacity: 0 }));
		store.dispatch({ type: "txPreview", next: next.template });
		store.dispatch({ type: "txCancel" });
		expect(t(store)).toBe(base);
	});

	test("issues are recomputed on commit", () => {
		const store = opened();
		const bad = unwrap(
			updateElement(t(store), "0/4", (el) =>
				el.type === "text"
					? { ...el, properties: { ...el.properties, value: "{{nope}}" } }
					: el,
			),
		);
		store.dispatch({ type: "commit", next: bad.template });
		expect(store.getState().doc?.issues.map((i) => i.code)).toContain(
			"unknown_field_reference",
		);
	});

	test("a side switch clears the selection and an undo that drops a side clamps it", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/0"] });
		store.dispatch({ type: "setSide", side: 1 });
		expect(store.getState().side).toBe(1);
		expect(store.getState().selection).toEqual([]);
		const state = reduce(store.getState(), { type: "setSide", side: 7 });
		expect(state.side).toBe(1);
	});

	test("rename keeps the selection on the renamed layer", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/0"] });
		const next = unwrap(renameElement(t(store), "0/0", "renamed"));
		store.dispatch({ type: "commit", next: next.template });
		expect(store.getState().selection).toEqual(["0/0"]);
	});

	test("saved clears dirty, close resets", () => {
		const store = opened();
		const next = unwrap(updateElement(t(store), "0/0", { opacity: 0.2 }));
		store.dispatch({ type: "commit", next: next.template });
		store.dispatch({ type: "saved", template: t(store) });
		expect(isDirty(store.getState())).toBe(true);
		const snapshot = workspaceSnapshot(store.getState());
		if (!snapshot) throw new Error("no workspace");
		store.dispatch({ type: "workspaceSaved", saved: snapshot });
		expect(isDirty(store.getState())).toBe(false);
		store.dispatch({ type: "close" });
		expect(store.getState().doc).toBeNull();
		expect(initialState().doc).toBeNull();
	});
});

describe("editor store identity", () => {
	test("a preview that leaves the selection alone keeps the same arrays", () => {
		const store = opened();
		store.dispatch({ type: "select", keys: ["0/1"] });
		store.dispatch({ type: "toggleHidden", key: "0/2" });
		const { selection, hidden, locked } = store.getState();
		store.dispatch({ type: "txBegin" });
		const next = unwrap(
			updateElement(t(store), "0/1", { pos: { x: 5, y: 5 } }),
		);
		store.dispatch({ type: "txPreview", next: next.template });
		expect(store.getState().selection).toBe(selection);
		expect(store.getState().hidden).toBe(hidden);
		expect(store.getState().locked).toBe(locked);
	});
});
