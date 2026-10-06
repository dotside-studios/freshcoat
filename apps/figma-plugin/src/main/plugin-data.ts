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

type PluginDataReader = { getPluginData?: (key: string) => string };

export function readPluginData(node: PluginDataReader, key: string): string {
	if (typeof node.getPluginData !== "function") return "";
	return node.getPluginData(key);
}
