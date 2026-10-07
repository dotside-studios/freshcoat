import type { Template } from "@freshcoat-js/coatfile";
import type { EditorState } from "~/state/store";
import type { Section } from "~/state/workspace";

/** What a link asks the editor to open. Acted on once, then removed from the
 *  URL so a reload does not reopen it over the user's work. */
export type OpenIntent =
	| { kind: "sample"; id: string }
	| { kind: "starter"; id: string }
	| { kind: "new"; presetId: string };

/** What a link from the Figma plugin asks for, in the fragment rather than
 *  the search so the browser never sends it to a server: a template to open
 *  (`#coat=<data>`, see `handoff.ts`), or a pointer at "Open file…" for the
 *  `.coat` the plugin downloaded instead (`#open=1`; older plugins send
 *  `#drop=1`, read the same way). Acted on once and removed, as an
 *  `OpenIntent` is. */
export type HandoffIntent =
	| { kind: "coat"; data: string; returnTo?: string }
	| { kind: "open" };

/** What is being shown, as the URL carries it. A missing key means the
 *  default: the first template, dataset and preset, the first side, the Edit
 *  section and no record. */
export type ViewState = {
	section?: Section;
	template?: string;
	side?: string;
	record?: string;
	dataset?: string;
	preset?: string;
};

/** The query string, as the router reads and writes it: every value a
 *  string, a flag such as `?bench` the empty string. */
export type SearchRecord = Record<string, string>;

/** The search the section routes accept: the view, an open intent and the
 *  theme. */
export type EditorSearch = {
	template?: string;
	side?: string;
	record?: string;
	dataset?: string;
	preset?: string;
	sample?: string;
	starter?: string;
	new?: string;
	theme?: string;
};

/** The search `/bench` accepts. */
export type BenchSearch = {
	sample?: string;
	frames?: string;
	theme?: string;
	/** "main" paints the Edit canvas on the main thread. */
	preview?: string;
};

const INTENT_PARAMS = ["sample", "starter", "new"] as const;
export const SECTIONS: readonly Section[] = ["edit", "data", "export"];
const VIEW_KEYS = ["template", "side", "record", "dataset", "preset"] as const;
const EDITOR_KEYS = [...VIEW_KEYS, ...INTENT_PARAMS, "theme"] as const;
const BENCH_KEYS = ["sample", "frames", "theme", "preview"] as const;

/** Parses a query string. Malformed input parses to what can be read of it
 *  rather than throwing. */
export function parseSearch(search: string): SearchRecord {
	const out: SearchRecord = {};
	for (const [key, value] of new URLSearchParams(search))
		if (!(key in out)) out[key] = value;
	return out;
}

/** The query string for `search`, `?`-prefixed, with flags written bare
 *  (`?bench`, not `?bench=`); the empty string when there is nothing. */
export function stringifySearch(search: Record<string, unknown>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(search))
		if (typeof value === "string") params.append(key, value);
	const s = params.toString().replace(/=(?=&|$)/g, "");
	return s ? `?${s}` : "";
}

/**
 * Splits a search string into the open intent it carries and what stays in
 * the URL. The first intent param wins; every intent param is removed.
 */
export function readIntent(search: string): {
	intent: OpenIntent | null;
	search: string;
} {
	const params = new URLSearchParams(search);
	let intent: OpenIntent | null = null;
	for (const key of INTENT_PARAMS) {
		const value = params.get(key)?.trim();
		if (!intent && value) {
			intent =
				key === "new"
					? { kind: "new", presetId: value }
					: { kind: key, id: value };
		}
		params.delete(key);
	}
	const rest = params.toString().replace(/=(?=&|$)/g, "");
	return { intent, search: rest ? `?${rest}` : "" };
}

const HANDOFF_PARAMS = ["coat", "open", "drop"] as const;
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

export function returnOrigin(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	const local = LOOPBACK.has(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
		return null;
	if (url.username || url.password) return null;
	return url.origin;
}

/**
 * Splits a fragment into the hand-off it carries and what stays. The first
 * hand-off param wins; every one is removed. The returned hash is
 * `#`-prefixed, or empty.
 */
export function readHandoffIntent(hash: string): {
	intent: HandoffIntent | null;
	hash: string;
} {
	const raw = hash.replace(/^#/, "");
	if (!HANDOFF_PARAMS.some((key) => raw.includes(`${key}=`)))
		return { intent: null, hash: raw ? `#${raw}` : "" };
	const params = new URLSearchParams(raw);
	let intent: HandoffIntent | null = null;
	const returnTo = returnOrigin(params.get("return")?.trim() ?? "");
	for (const key of HANDOFF_PARAMS) {
		const value = params.get(key)?.trim();
		if (!intent && value)
			intent =
				key === "coat"
					? { kind: "coat", data: value, ...(returnTo ? { returnTo } : {}) }
					: { kind: "open" };
		params.delete(key);
	}
	params.delete("return");
	const rest = params.toString().replace(/=(?=&|$)/g, "");
	return { intent, hash: rest ? `#${rest}` : "" };
}

function pick<K extends string>(
	raw: Record<string, unknown>,
	keys: readonly K[],
): Partial<Record<K, string>> {
	const out: Partial<Record<K, string>> = {};
	for (const key of keys) {
		const value = raw[key];
		if (typeof value === "string" && value) out[key] = value;
	}
	return out;
}

/** `validateSearch` for the section routes: known keys with non-empty string
 *  values; anything else is dropped. */
export function validateEditorSearch(
	raw: Record<string, unknown>,
): EditorSearch {
	return pick(raw, EDITOR_KEYS);
}

export function validateBenchSearch(raw: Record<string, unknown>): BenchSearch {
	return pick(raw, BENCH_KEYS);
}

/** The section a path shows, or null for a path that is not a section. */
export function sectionOfPath(pathname: string): Section | null {
	const name = pathname.replace(/^\/+|\/+$/g, "");
	return (SECTIONS as readonly string[]).includes(name)
		? (name as Section)
		: null;
}

/** What a section route's URL says is shown. */
export function viewOfUrl(pathname: string, search: SearchRecord): ViewState {
	const section = sectionOfPath(pathname);
	return {
		...(section ? { section } : {}),
		...pick(search, VIEW_KEYS),
	};
}

/** The URL for `view`: the section as the path, and every other key that is
 *  not at its default as a search param. `keep` (the theme) follows them. */
export function urlOfView(
	view: ViewState,
	defaults: ViewState,
	keep: SearchRecord = {},
): string {
	const search: SearchRecord = {};
	for (const key of VIEW_KEYS) {
		const value = view[key];
		if (value !== undefined && value !== defaults[key]) search[key] = value;
	}
	return `/${view.section ?? "edit"}${stringifySearch({ ...search, ...keep })}`;
}

/** The phase 3 hash, `#section=data&template=…`. Unknown keys, empty values
 *  and an unknown section are dropped. */
export function parseLegacyHash(hash: string): ViewState {
	const params = parseSearch(hash.replace(/^#/, ""));
	const out: ViewState = pick(params, VIEW_KEYS);
	const section = params.section;
	if (section && (SECTIONS as readonly string[]).includes(section))
		out.section = section as Section;
	return out;
}

/**
 * Where an older link now lives, or null when it is already current:
 * `/?kit` is `/kit`, `/?bench&…` is `/bench?…`, a `#section=…&template=…`
 * hash becomes the section's path and search params, and `/` is `/edit`.
 * Search params the link carried go with it.
 */
export function legacyTarget(
	pathname: string,
	search: SearchRecord,
	hash: string,
): { to: string; search: SearchRecord } | null {
	const root = pathname === "/" || pathname === "";
	if (root && "kit" in search) {
		const { kit: _, ...rest } = search;
		return { to: "/kit", search: rest };
	}
	if (root && "bench" in search) {
		const { bench: _, ...rest } = search;
		return { to: "/bench", search: rest };
	}
	const section = sectionOfPath(pathname);
	const view = parseLegacyHash(hash);
	if ((root || section) && Object.keys(view).length) {
		const { section: hashSection, ...keys } = view;
		return {
			to: `/${hashSection ?? section ?? "edit"}`,
			search: { ...search, ...keys },
		};
	}
	return root ? { to: "/edit", search } : null;
}

/** What the editor is showing now. */
export function viewOf(state: EditorState): ViewState {
	const ws = state.workspace;
	if (!ws) return {};
	const t = state.doc?.history.present;
	const record =
		state.section === "edit"
			? state.previewRecordId
			: state.section === "export"
				? state.exportRecordId
				: null;
	return {
		section: state.section,
		template: ws.activeTemplateId,
		side: t?.template_data[state.side]?.name,
		...(record ? { record } : {}),
		...(ws.activeDatasetId ? { dataset: ws.activeDatasetId } : {}),
		...(ws.activePresetId ? { preset: ws.activePresetId } : {}),
	};
}

/** What each key means when the hash leaves it out. */
export function defaultsOf(state: EditorState): ViewState {
	const ws = state.workspace;
	if (!ws) return {};
	const t = state.doc?.history.present;
	return {
		section: "edit",
		template: ws.templates[0]?.id,
		side: t?.template_data[0]?.name,
		dataset: ws.datasets[0]?.id,
		preset: ws.presets[0]?.id,
	};
}

/** The URL for what the editor shows, keeping the theme from `search`. */
export function urlOf(state: EditorState, search: SearchRecord = {}): string {
	const keep = pick(search, ["theme"] as const);
	return state.workspace
		? urlOfView(viewOf(state), defaultsOf(state), keep)
		: `/edit${stringifySearch(keep)}`;
}

/** The steps that bring the editor to `view`, in the order they must run:
 *  switching template restores that template's own side and clears the
 *  previewed record, so both follow it. Ids the workspace does not have are
 *  skipped, which leaves that part of the view as it is. */
export type ViewStep =
	| { type: "template"; id: string }
	| { type: "side"; index: number }
	| { type: "dataset"; id: string | null }
	| { type: "preset"; id: string | null }
	| { type: "section"; section: Section }
	| { type: "previewRecord"; id: string | null }
	| { type: "exportRecord"; id: string | null };

export function planView(
	state: EditorState,
	view: ViewState,
	templateOf: (id: string) => Template | undefined,
): ViewStep[] {
	const ws = state.workspace;
	if (!ws) return [];
	const steps: ViewStep[] = [];
	const templateId = view.template ?? ws.templates[0]?.id;
	const slot = ws.templates.find((s) => s.id === templateId);
	if (slot && slot.id !== ws.activeTemplateId)
		steps.push({ type: "template", id: slot.id });
	const activeId = slot ? slot.id : ws.activeTemplateId;
	const template = templateOf(activeId);
	if (template) {
		const index =
			view.side === undefined
				? 0
				: template.template_data.findIndex((f) => f.name === view.side);
		if (index >= 0) steps.push({ type: "side", index });
	}
	const datasetId = view.dataset ?? ws.datasets[0]?.id ?? null;
	if (datasetId === null || ws.datasets.some((d) => d.id === datasetId))
		steps.push({ type: "dataset", id: datasetId });
	const presetId = view.preset ?? ws.presets[0]?.id ?? null;
	if (presetId === null || ws.presets.some((p) => p.id === presetId))
		steps.push({ type: "preset", id: presetId });
	const section = view.section ?? "edit";
	steps.push({ type: "section", section });
	const known = (id: string) =>
		ws.datasets.some((d) => d.records.some((r) => r.id === id));
	if (section === "edit") {
		if (view.record === undefined)
			steps.push({ type: "previewRecord", id: null });
		else if (known(view.record))
			steps.push({ type: "previewRecord", id: view.record });
	} else if (section === "export") {
		if (view.record === undefined)
			steps.push({ type: "exportRecord", id: null });
		else if (known(view.record))
			steps.push({ type: "exportRecord", id: view.record });
	}
	return steps;
}

/** What `?starter=` resolves to: a starter when the editor has a registry of
 *  them, otherwise a sample of the same id. */
export type IntentTarget = {
	openSample(id: string): Promise<unknown> | unknown;
	openStarter?: (id: string) => Promise<unknown> | unknown;
	hasStarter?: (id: string) => boolean;
	newDocument(presetId: string): Promise<boolean> | boolean;
};

/** Acts on an intent. Resolves false when nothing it names exists. */
export async function runIntent(
	intent: OpenIntent,
	target: IntentTarget,
	hasSample: (id: string) => boolean,
): Promise<boolean> {
	switch (intent.kind) {
		case "sample":
			if (!hasSample(intent.id)) return false;
			await target.openSample(intent.id);
			return true;
		case "starter":
			if (target.openStarter && (target.hasStarter?.(intent.id) ?? true)) {
				await target.openStarter(intent.id);
				return true;
			}
			if (!hasSample(intent.id)) return false;
			await target.openSample(intent.id);
			return true;
		case "new":
			return target.newDocument(intent.presetId);
	}
}
