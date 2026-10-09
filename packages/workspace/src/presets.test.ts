import { describe, expect, it } from "vitest";
import { DEFAULT_DPI, DEFAULT_FILE_NAME_PATTERN } from "./plan";
import { duplicatePreset, newPreset } from "./presets";

describe("presets", () => {
	it("gives a new preset the spec's defaults", () => {
		expect(newPreset("t_doc", [], "p_1")).toEqual({
			id: "p_1",
			name: "New preset",
			templateId: "t_doc",
			records: "all",
			sides: "all",
			format: "png-zip",
			scale: 1,
			dpi: DEFAULT_DPI,
			fileName: DEFAULT_FILE_NAME_PATTERN,
			markExported: true,
		});
		expect(DEFAULT_DPI).toBe(300);
		expect(newPreset("t_doc", []).id).toMatch(/^p_[0-9a-f]{16}$/);
	});

	it("gives new presets unique names, ignoring case", () => {
		const first = newPreset("t_doc", [], "p_1");
		const second = newPreset("t_doc", [first], "p_2");
		expect(second.name).toBe("New preset 2");
		expect(newPreset("t_doc", [first, second]).name).toBe("New preset 3");
		expect(newPreset("t_doc", [{ ...first, name: "NEW PRESET" }]).name).toBe(
			"New preset 2",
		);
	});

	it("duplicates a preset under a fresh id and a unique name", () => {
		const first = newPreset("t_doc", [], "p_1");
		const source = { ...first, records: "selected" as const, selected: ["r1"] };
		const copy = duplicatePreset(source, [first], "p_3");
		expect(copy).toMatchObject({
			id: "p_3",
			name: "New preset copy",
			records: "selected",
			selected: ["r1"],
		});
		expect(copy.selected).not.toBe(source.selected);
		expect(duplicatePreset(first, [first, copy]).name).toBe(
			"New preset copy 2",
		);
		expect(duplicatePreset(first, []).id).toMatch(/^p_[0-9a-f]{16}$/);
	});
});
