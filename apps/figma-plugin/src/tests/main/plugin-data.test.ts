import { describe, expect, it } from "vitest";
import { FIELD_KEY, readPluginData } from "~/main/plugin-data";

/** A node whose pluginData is a plain map. */
function node(data: Record<string, string>) {
	return { getPluginData: (key: string) => data[key] ?? "" };
}

describe("readPluginData", () => {
	it("reads the current key", () => {
		expect(readPluginData(node({ [FIELD_KEY]: "now" }), FIELD_KEY)).toBe("now");
	});

	it("returns empty for an unset key", () => {
		expect(readPluginData(node({}), FIELD_KEY)).toBe("");
	});

	it("tolerates a node with no pluginData at all", () => {
		expect(readPluginData({}, FIELD_KEY)).toBe("");
	});
});
