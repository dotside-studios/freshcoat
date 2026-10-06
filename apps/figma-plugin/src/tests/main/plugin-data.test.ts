import { describe, expect, it } from "vitest";
import {
	FIELD_KEY,
	FIELDS_KEY,
	pluginDataKeys,
	readPluginData,
} from "~/main/plugin-data";

/** A node whose pluginData is a plain map. */
function node(data: Record<string, string>) {
	return { getPluginData: (key: string) => data[key] ?? "" };
}

describe("readPluginData", () => {
	it("reads the current key", () => {
		expect(readPluginData(node({ [FIELD_KEY]: "now" }), FIELD_KEY)).toBe("now");
	});

	it("falls back to the pre-rename key", () => {
		// A file marked up before the plugin was renamed.
		expect(readPluginData(node({ "davi:field": "old" }), FIELD_KEY)).toBe(
			"old",
		);
		expect(readPluginData(node({ "davi:fields": "old" }), FIELDS_KEY)).toBe(
			"old",
		);
	});

	it("prefers the current key when both are present", () => {
		const both = node({ [FIELD_KEY]: "now", "davi:field": "old" });
		expect(readPluginData(both, FIELD_KEY)).toBe("now");
	});

	it("returns empty for an unset key", () => {
		expect(readPluginData(node({}), FIELD_KEY)).toBe("");
	});

	it("has no fallback for a key that never had a legacy name", () => {
		expect(
			readPluginData(node({ "davi:other": "x" }), "freshcoat_plugin:other"),
		).toBe("");
	});

	it("tolerates a node with no pluginData at all", () => {
		expect(readPluginData({}, FIELD_KEY)).toBe("");
	});
});

describe("pluginDataKeys", () => {
	it("includes the pre-rename key so search finds older markup", () => {
		expect(pluginDataKeys(FIELD_KEY)).toEqual([FIELD_KEY, "davi:field"]);
	});

	it("is just the key when it has no legacy name", () => {
		expect(pluginDataKeys("other")).toEqual(["other"]);
	});
});
