import type { Template } from "@freshcoat-js/coatfile";
import { autoBinding, type Dataset } from "@freshcoat-js/workspace";
import { describe, expect, test, vi } from "vitest";
import {
	defaultsOf,
	type IntentTarget,
	legacyTarget,
	parseLegacyHash,
	parseSearch,
	planView,
	readHandoffIntent,
	readIntent,
	runIntent,
	stringifySearch,
	urlOf,
	urlOfView,
	type ViewState,
	validateEditorSearch,
	viewOf,
	viewOfUrl,
} from "~/app/url-state";
import { createEditorStore, type EditorState } from "~/state/store";
import { doc } from "./doc-fixture";

function dataset(id: string, rows: number): Dataset {
	return {
		id,
		name: id,
		columns: [{ key: "name", type: "text" }],
		records: Array.from({ length: rows }, (_, i) => ({
			id: `r_${id}${i}`,
			values: { name: `N${i}` },
			status: "pending" as const,
		})),
		assets: [],
	};
}

/** A workspace of two templates and two datasets, the first template bound. */
function workspace() {
	const store = createEditorStore();
	store.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	const other: Template = { ...doc(), id: "other", name: "Other" };
	store.dispatch({ type: "open", template: other, fileName: "other.coat" });
	const ws = store.getState().workspace;
	if (!ws) throw new Error("no workspace");
	const [first, second] = ws.templates.map((t) => t.id) as [string, string];
	store.dispatch({ type: "switchTemplate", id: first });
	const a = dataset("a", 3);
	store.dispatch({ type: "datasetEdit", datasets: [a, dataset("b", 2)] });
	store.dispatch({
		type: "setBinding",
		id: first,
		binding: autoBinding(doc(), a),
	});
	return { store, first, second };
}

const templateOf =
	(state: EditorState) =>
	(id: string): Template | undefined => {
		const slot = state.workspace?.templates.find((s) => s.id === id);
		return id === state.workspace?.activeTemplateId
			? (state.doc?.history.present ?? undefined)
			: slot?.template;
	};

/** Round-trips a view through its URL. */
function reparse(url: string): ViewState {
	const [path = "", search = ""] = url.split("?");
	return viewOfUrl(path, parseSearch(search));
}

describe("the URL of a view", () => {
	const defaults: ViewState = {
		section: "edit",
		template: "t_1",
		side: "front",
		dataset: "d_1",
		preset: "p_1",
	};

	test("round trip every key", () => {
		const view: ViewState = {
			section: "data",
			template: "t_ab12cd34",
			side: "back",
			record: "r_0007",
			dataset: "d_x",
			preset: "p_y",
		};
		const url = urlOfView(view, defaults);
		expect(url).toBe(
			"/data?template=t_ab12cd34&side=back&record=r_0007&dataset=d_x&preset=p_y",
		);
		expect(reparse(url)).toEqual(view);
	});

	test("keys equal to their default are omitted", () => {
		expect(urlOfView(defaults, defaults)).toBe("/edit");
		expect(urlOfView({ ...defaults, side: "back" }, defaults)).toBe(
			"/edit?side=back",
		);
	});

	test("the theme is kept after the view", () => {
		expect(urlOfView({ section: "export" }, {}, { theme: "dark" })).toBe(
			"/export?theme=dark",
		);
		expect(urlOfView({ record: "r_1" }, {}, { theme: "dark" })).toBe(
			"/edit?record=r_1&theme=dark",
		);
	});

	test("ids with reserved characters survive", () => {
		const view: ViewState = {
			section: "edit",
			side: "front & back",
			record: "r#1=2",
		};
		expect(reparse(urlOfView(view, {}))).toEqual(view);
	});

	test("ids that read as numbers or JSON stay strings", () => {
		expect(stringifySearch({ record: "123", side: "true" })).toBe(
			"?record=123&side=true",
		);
		expect(parseSearch("?record=123&side=true")).toEqual({
			record: "123",
			side: "true",
		});
	});

	test("unknown keys, empty values and an unknown path are ignored", () => {
		expect(
			viewOfUrl(
				"/settings",
				parseSearch("foo=bar&section=data&template=&side=back&zoom=2"),
			),
		).toEqual({ side: "back" });
	});

	test("malformed input parses to nothing rather than throwing", () => {
		expect(parseSearch("")).toEqual({});
		expect(parseSearch("?")).toEqual({});
		expect(viewOfUrl("/", parseSearch("%E0%A4%A&&=&==x"))).toEqual({});
	});

	test("validateSearch keeps the view, the intent and the theme", () => {
		expect(
			validateEditorSearch({
				template: "t_1",
				sample: "certificate",
				theme: "dark",
				zoom: "2",
				side: "",
				record: 7,
			}),
		).toEqual({ template: "t_1", sample: "certificate", theme: "dark" });
	});
});

describe("legacy links", () => {
	test("?kit and ?bench become their routes, keeping the rest", () => {
		expect(legacyTarget("/", parseSearch("?kit&theme=dark"), "")).toEqual({
			to: "/kit",
			search: { theme: "dark" },
		});
		expect(
			legacyTarget("/", parseSearch("?bench&sample=certificate&frames=90"), ""),
		).toEqual({
			to: "/bench",
			search: { sample: "certificate", frames: "90" },
		});
	});

	test("a phase 3 hash becomes the section's path and search", () => {
		expect(
			legacyTarget(
				"/",
				parseSearch("?theme=dark"),
				"#section=data&template=t_1&record=r_2",
			),
		).toEqual({
			to: "/data",
			search: { theme: "dark", template: "t_1", record: "r_2" },
		});
		expect(legacyTarget("/", {}, "#side=back")).toEqual({
			to: "/edit",
			search: { side: "back" },
		});
		expect(legacyTarget("/export", {}, "#record=r_1")).toEqual({
			to: "/export",
			search: { record: "r_1" },
		});
	});

	test("/ goes to /edit with its search, intents included", () => {
		expect(legacyTarget("/", parseSearch("?sample=certificate"), "")).toEqual({
			to: "/edit",
			search: { sample: "certificate" },
		});
		expect(legacyTarget("/", {}, "#nothing-here")).toEqual({
			to: "/edit",
			search: {},
		});
	});

	test("current URLs are left alone", () => {
		expect(legacyTarget("/data", { template: "t_1" }, "")).toBeNull();
		expect(legacyTarget("/kit", {}, "")).toBeNull();
		expect(legacyTarget("/bench", { sample: "minimal" }, "")).toBeNull();
		expect(legacyTarget("/edit", { kit: "" }, "")).toBeNull();
	});

	test("the phase 3 hash parser drops what it does not know", () => {
		expect(
			parseLegacyHash("#foo=bar&section=settings&template=&side=back&zoom=2"),
		).toEqual({ side: "back" });
		expect(parseLegacyHash("")).toEqual({});
		expect(parseLegacyHash("#")).toEqual({});
		expect(parseLegacyHash("section")).toEqual({});
	});
});

describe("readIntent", () => {
	test("takes the intent out and keeps the rest", () => {
		expect(readIntent("?sample=certificate&bench&theme=dark")).toEqual({
			intent: { kind: "sample", id: "certificate" },
			search: "?bench&theme=dark",
		});
		expect(readIntent("?starter=davi-card")).toEqual({
			intent: { kind: "starter", id: "davi-card" },
			search: "",
		});
		expect(readIntent("?new=square&kit")).toEqual({
			intent: { kind: "new", presetId: "square" },
			search: "?kit",
		});
	});

	test("no intent leaves the search alone", () => {
		expect(readIntent("?bench")).toEqual({ intent: null, search: "?bench" });
		expect(readIntent("")).toEqual({ intent: null, search: "" });
	});

	test("an empty intent is dropped without acting", () => {
		expect(readIntent("?sample=&theme=light")).toEqual({
			intent: null,
			search: "?theme=light",
		});
	});
});

describe("readHandoffIntent", () => {
	test("takes a template or an open request out of the fragment", () => {
		expect(readHandoffIntent("#coat=abc_-9")).toEqual({
			intent: { kind: "coat", data: "abc_-9" },
			hash: "",
		});
		expect(readHandoffIntent("#open=1")).toEqual({
			intent: { kind: "open" },
			hash: "",
		});
	});

	test("carries a template's return origin and removes it", () => {
		expect(
			readHandoffIntent(
				"#coat=abc&return=https%3A%2F%2Forders.example.com%2Fadmin&x=y",
			),
		).toEqual({
			intent: {
				kind: "coat",
				data: "abc",
				returnTo: "https://orders.example.com",
			},
			hash: "#x=y",
		});
		expect(
			readHandoffIntent("#coat=abc&return=http%3A%2F%2Fevil.test"),
		).toEqual({ intent: { kind: "coat", data: "abc" }, hash: "" });
	});

	test("reads an older plugin's drop=1 as an open request", () => {
		expect(readHandoffIntent("drop=1")).toEqual({
			intent: { kind: "open" },
			hash: "",
		});
		expect(readHandoffIntent("#drop=1&x=y")).toEqual({
			intent: { kind: "open" },
			hash: "#x=y",
		});
	});

	test("the first wins, both are removed and the rest is kept", () => {
		expect(readHandoffIntent("#coat=abc&open=1&drop=1&x=y")).toEqual({
			intent: { kind: "coat", data: "abc" },
			hash: "#x=y",
		});
	});

	test("a fragment without one is left alone", () => {
		expect(readHandoffIntent("#section=data")).toEqual({
			intent: null,
			hash: "#section=data",
		});
		expect(readHandoffIntent("")).toEqual({ intent: null, hash: "" });
		expect(readHandoffIntent("#coat=")).toEqual({ intent: null, hash: "" });
	});
});

describe("runIntent", () => {
	const target = (extra: Partial<IntentTarget> = {}) => ({
		openSample: vi.fn(async () => {}),
		newDocument: vi.fn((id: string) => id === "square"),
		...extra,
	});
	const samples = (id: string) => id === "certificate";

	test("a starter opens from the registry when there is one", async () => {
		const registry = new Set(["davi-card"]);
		const openStarter = vi.fn(async () => {});
		const t = target({
			openStarter,
			hasStarter: (id) => registry.has(id),
		});
		expect(
			await runIntent({ kind: "starter", id: "davi-card" }, t, samples),
		).toBe(true);
		expect(openStarter).toHaveBeenCalledWith("davi-card");
		expect(t.openSample).not.toHaveBeenCalled();
	});

	test("an unknown starter falls back to a sample of that id", async () => {
		const openStarter = vi.fn();
		const t = target({ openStarter, hasStarter: () => false });
		expect(
			await runIntent({ kind: "starter", id: "certificate" }, t, samples),
		).toBe(true);
		expect(openStarter).not.toHaveBeenCalled();
		expect(t.openSample).toHaveBeenCalledWith("certificate");
		expect(await runIntent({ kind: "starter", id: "nope" }, t, samples)).toBe(
			false,
		);
	});

	test("without a registry a starter is a sample", async () => {
		const t = target();
		await runIntent({ kind: "starter", id: "certificate" }, t, samples);
		expect(t.openSample).toHaveBeenCalledWith("certificate");
	});

	test("samples and presets", async () => {
		const t = target();
		expect(
			await runIntent({ kind: "sample", id: "certificate" }, t, samples),
		).toBe(true);
		expect(await runIntent({ kind: "sample", id: "nope" }, t, samples)).toBe(
			false,
		);
		expect(
			await runIntent({ kind: "new", presetId: "square" }, t, samples),
		).toBe(true);
		expect(await runIntent({ kind: "new", presetId: "nope" }, t, samples)).toBe(
			false,
		);
	});
});

describe("the view of a workspace", () => {
	test("a fresh document is plain /edit", () => {
		const store = createEditorStore();
		expect(urlOf(store.getState(), { theme: "dark" })).toBe("/edit?theme=dark");
		store.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
		expect(urlOf(store.getState())).toBe("/edit");
		expect(urlOf(store.getState(), { sample: "x", theme: "dark" })).toBe(
			"/edit?theme=dark",
		);
	});

	test("reflects section, template, side and the previewed record", () => {
		const { store, second } = workspace();
		expect(urlOf(store.getState())).toBe("/edit");
		store.dispatch({ type: "setSide", side: 1 });
		store.dispatch({
			type: "previewRecord",
			id: "r_a1",
			values: {},
		});
		expect(urlOf(store.getState())).toBe("/edit?side=back&record=r_a1");
		store.dispatch({ type: "setSection", section: "data" });
		expect(urlOf(store.getState())).toBe("/data?side=back");
		store.dispatch({ type: "setSection", section: "export" });
		store.dispatch({ type: "setRecord", id: "r_a2" });
		expect(urlOf(store.getState())).toBe("/export?side=back&record=r_a2");
		store.dispatch({ type: "switchTemplate", id: second });
		store.dispatch({ type: "setActiveDataset", id: "b" });
		expect(viewOf(store.getState())).toMatchObject({
			template: second,
			side: "front",
			dataset: "b",
		});
		expect(defaultsOf(store.getState()).dataset).toBe("a");
	});

	test("planning a view orders template before side and record", () => {
		const { store, second } = workspace();
		const state = store.getState();
		const steps = planView(
			state,
			{ template: second, side: "back", section: "data", dataset: "b" },
			templateOf(state),
		);
		expect(steps).toEqual([
			{ type: "template", id: second },
			{ type: "side", index: 1 },
			{ type: "dataset", id: "b" },
			{ type: "preset", id: null },
			{ type: "section", section: "data" },
		]);
	});

	test("unknown ids are skipped", () => {
		const { store } = workspace();
		const state = store.getState();
		const steps = planView(
			state,
			{
				template: "t_gone",
				side: "middle",
				dataset: "d_gone",
				record: "r_gone",
			},
			templateOf(state),
		);
		expect(steps).toEqual([
			{ type: "preset", id: null },
			{ type: "section", section: "edit" },
		]);
	});

	test("a missing key means its default", () => {
		const { store } = workspace();
		const state = store.getState();
		expect(planView(state, { record: "r_a2" }, templateOf(state))).toEqual([
			{ type: "side", index: 0 },
			{ type: "dataset", id: "a" },
			{ type: "preset", id: null },
			{ type: "section", section: "edit" },
			{ type: "previewRecord", id: "r_a2" },
		]);
	});
});
