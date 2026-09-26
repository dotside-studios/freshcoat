import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrateSettings } from "~/shared/protocol";

describe("migrateSettings", () => {
	it("opens at the compact window by default", () => {
		expect(DEFAULT_SETTINGS.windowWidth).toBe(320);
		expect(DEFAULT_SETTINGS.windowHeight).toBe(480);
	});

	it("moves a window still at the previous default to the current one", () => {
		const stored = {
			...DEFAULT_SETTINGS,
			windowWidth: 400,
			windowHeight: 600,
			tab: "export",
		};
		expect(migrateSettings(stored)).toEqual({
			...stored,
			windowWidth: 320,
			windowHeight: 480,
		});
	});

	it("keeps a size the author resized to", () => {
		for (const [w, h] of [
			[400, 640],
			[480, 600],
			[520, 720],
			[320, 360],
		]) {
			const stored = { ...DEFAULT_SETTINGS, windowWidth: w, windowHeight: h };
			expect(migrateSettings(stored)).toBe(stored);
		}
	});
});
