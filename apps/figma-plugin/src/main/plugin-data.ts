import type { FieldMeta } from "~/lib/figma/binding";

// pluginData keys, in one place because they are written in main/bindings.ts
// and read in main/read-base.ts too.
//
// setPluginData is already private to the plugin id — "Plugins with other IDs
// won't be able to read this data" — so the prefix does no namespacing work.
// It exists to keep our own keys legible in an exported .fig, and to leave room
// for keys added later.

/** Per-node binding: which element property maps to which {{field}}. */
export const FIELD_KEY = "freshcoat_plugin:field";
/** Per-slot-frame field metadata: id → label, type, source, required. */
export const FIELDS_KEY = "freshcoat_plugin:fields";

type PluginDataReader = { getPluginData?: (key: string) => string };

export function readPluginData(node: PluginDataReader, key: string): string {
	if (typeof node.getPluginData !== "function") return "";
	return node.getPluginData(key);
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
