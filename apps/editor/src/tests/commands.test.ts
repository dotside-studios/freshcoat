import { describe, expect, test } from "vitest";
import {
	COMMANDS,
	findCommand,
	type KeyLike,
	matchesChord,
} from "~/app/commands";

const key = (k: Partial<KeyLike> & { key: string }): KeyLike => ({
	code: "",
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...k,
});

describe("shortcut matching", () => {
	test("Mod is Meta on a Mac and Ctrl elsewhere", () => {
		const metaZ = key({ key: "z", code: "KeyZ", metaKey: true });
		const ctrlZ = key({ key: "z", code: "KeyZ", ctrlKey: true });
		expect(matchesChord(metaZ, "Mod+Z", true)).toBe(true);
		expect(matchesChord(ctrlZ, "Mod+Z", true)).toBe(false);
		expect(matchesChord(ctrlZ, "Mod+Z", false)).toBe(true);
		expect(matchesChord(metaZ, "Mod+Z", false)).toBe(false);
	});

	test("shift must match exactly", () => {
		const e = key({ key: "Z", code: "KeyZ", metaKey: true, shiftKey: true });
		expect(matchesChord(e, "Mod+Z", true)).toBe(false);
		expect(matchesChord(e, "Mod+Shift+Z", true)).toBe(true);
	});

	test("letters match by physical key so Alt chords work on a Mac", () => {
		const e = key({ key: "å", code: "KeyA", altKey: true });
		expect(matchesChord(e, "Alt+A", true)).toBe(true);
		expect(matchesChord(e, "A", true)).toBe(false);
	});

	test("brackets, digits and punctuation", () => {
		expect(
			matchesChord(
				key({ key: "]", code: "BracketRight", metaKey: true }),
				"Mod+]",
				true,
			),
		).toBe(true);
		expect(
			matchesChord(
				key({ key: ")", code: "Digit0", shiftKey: true }),
				"Shift+0",
				true,
			),
		).toBe(true);
		expect(
			matchesChord(key({ key: "?", shiftKey: true }), "Shift+?", true),
		).toBe(true);
		expect(matchesChord(key({ key: "=", code: "Equal" }), "=", true)).toBe(
			true,
		);
	});

	test("only global commands run while typing in a field", () => {
		const del = key({ key: "Backspace" });
		expect(findCommand(del, true, false)?.id).toBe("edit.delete");
		expect(findCommand(del, true, true)).toBeUndefined();
		const undo = key({ key: "z", code: "KeyZ", metaKey: true });
		expect(findCommand(undo, true, true)?.id).toBe("edit.undo");
	});

	test("tool keys and redo alternatives resolve", () => {
		expect(findCommand(key({ key: "r", code: "KeyR" }), true, false)?.id).toBe(
			"tool.rect",
		);
		expect(
			findCommand(key({ key: "y", code: "KeyY", ctrlKey: true }), false, false)
				?.id,
		).toBe("edit.redo");
	});

	test("no two commands claim the same chord", () => {
		const seen = new Map<string, string>();
		for (const c of COMMANDS)
			for (const k of c.keys ?? []) {
				expect(seen.get(k), `${k} on ${c.id}`).toBeUndefined();
				seen.set(k, c.id);
			}
	});
});
