import type { FieldMeta } from "~/lib/figma/binding";

// pluginData keys, in one place because they are written in main/index.ts and
// read in two more modules.
//
// setPluginData is already private to the plugin id — "Plugins with other IDs
// won't be able to read this data" — so the prefix does no namespacing work.
// It exists to keep our own keys legible in an exported .fig, and to leave room
// for keys added later.

/** Per-node binding: which element property maps to which {{field}}. */
export const FIELD_KEY = "freshcoat_plugin:field";
/** Per-slot-frame field metadata: id → label, type, source, required. */
export const FIELDS_KEY = "freshcoat_plugin:fields";

// Keys used before the plugin was renamed. Read-only, and transitional: Figma
// assigns the real plugin id at publish, and stored data "will become
// inaccessible if your plugin ID changes" — so at that point every key is
// orphaned anyway and these two lines can go. Until then they keep the team's
// already-marked-up files working.
const LEGACY_FIELD_KEY = "davi:field";
const LEGACY_FIELDS_KEY = "davi:fields";

const LEGACY: Record<string, string> = {
	[FIELD_KEY]: LEGACY_FIELD_KEY,
	[FIELDS_KEY]: LEGACY_FIELDS_KEY,
};

type PluginDataReader = { getPluginData?: (key: string) => string };

/** Read a key, falling back to its pre-rename name. Writes always use the
 *  current key, so a node re-saved by this version stops needing the fallback. */
export function readPluginData(node: PluginDataReader, key: string): string {
	if (typeof node.getPluginData !== "function") return "";
	const current = node.getPluginData(key);
	if (current) return current;
	const legacy = LEGACY[key];
	return legacy ? node.getPluginData(legacy) : "";
}

/** Every key `readPluginData` may read for `key`, for pluginData search criteria. */
export function pluginDataKeys(key: string): string[] {
	const legacy = LEGACY[key];
	return legacy ? [key, legacy] : [key];
}

function readJson(node: PluginDataReader, key: string): unknown {
	const raw = readPluginData(node, key);
	if (!raw) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		// Malformed pluginData: treat as absent.
		return undefined;
	}
}

/** The node's stored binding: property → value template, e.g.
 *  { text: "{{name}}", textColor: "{{brand}}" }. */
export function readBinding(
	node: PluginDataReader,
): { bind: Record<string, string> } | undefined {
	const parsed = readJson(node, FIELD_KEY) as {
		bind?: Record<string, string>;
	} | null;
	if (parsed && typeof parsed === "object" && parsed.bind) {
		return { bind: parsed.bind };
	}
	return undefined;
}

/** A slot frame's stored field metadata, keyed by field id. */
export function readFieldMeta(
	node: PluginDataReader,
): Record<string, FieldMeta> | undefined {
	const parsed = readJson(node, FIELDS_KEY);
	return parsed && typeof parsed === "object"
		? (parsed as Record<string, FieldMeta>)
		: undefined;
}
