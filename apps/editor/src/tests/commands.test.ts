import { describe, expect, test } from "vitest";
import {
	COMMAND_BY_ID,
	COMMANDS,
	findCommand,
	type KeyLike,
	matchesChord,
} from "~/app/commands";
import type { EditorState } from "~/state/store";

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

	test("undo and redo are off in Export, which has no history of its own", () => {
		const undo = key({ key: "z", code: "KeyZ", metaKey: true });
		expect(findCommand(undo, true, false, "data")?.id).toBe("edit.undo");
		expect(findCommand(undo, true, true, "export")).toBeUndefined();
		const command = COMMAND_BY_ID.get("edit.undo");
		const s = {
			section: "export",
			doc: { history: { past: [{}], future: [] } },
		} as unknown as EditorState;
		expect(command?.enabled?.(s)).toBe(false);
		expect(command?.enabled?.({ ...s, section: "edit" })).toBe(true);
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

	test("Alt+[ and Alt+] step the previewed record", () => {
		const at = (code: string) =>
			findCommand(key({ key: "“", code, altKey: true }), true, false)?.id;
		expect(at("BracketLeft")).toBe("view.previousRecord");
		expect(at("BracketRight")).toBe("view.nextRecord");
	});

	test("Alt+, and Alt+. step sides, and with Shift variants", () => {
		const at = (code: string, shiftKey = false) =>
			findCommand(key({ key: "≤", code, altKey: true, shiftKey }), true, false)
				?.id;
		expect(at("Comma")).toBe("view.previousSide");
		expect(at("Period")).toBe("view.nextSide");
		expect(at("Comma", true)).toBe("view.previousVariant");
		expect(at("Period", true)).toBe("view.nextVariant");
	});

	test("Mod+0 zooms to 100%", () => {
		expect(
			findCommand(key({ key: "0", code: "Digit0", metaKey: true }), true, false)
				?.id,
		).toBe("view.zoom100");
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
