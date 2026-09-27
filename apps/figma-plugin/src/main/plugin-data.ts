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
