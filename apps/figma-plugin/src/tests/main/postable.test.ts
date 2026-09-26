import { describe, expect, it } from "vitest";
import { findUnpostable } from "~/main/postable";

// Stands in for figma.mixed, which is a symbol.
const MIXED = Symbol("figma.mixed");

describe("findUnpostable", () => {
	it("passes a plain payload", () => {
		expect(
			findUnpostable({ type: "read-document", slots: [{ w: 1, name: "a" }] }),
		).toBeNull();
	});

	it("names a symbol nested in a scene graph", () => {
		const payload = {
			slots: [{ tree: { children: [{ style: { fontSize: MIXED } }] } }],
		};
		expect(findUnpostable(payload)).toBe(
			"payload.slots[0].tree.children[0].style.fontSize (Symbol(figma.mixed))",
		);
	});

	it("names a function", () => {
		expect(findUnpostable({ a: { cb: () => 1 } })).toBe(
			"payload.a.cb (function)",
		);
	});

	it("names a symbol-keyed property", () => {
		expect(findUnpostable({ a: { [MIXED]: 1 } })).toContain("symbol key");
	});

	it("tolerates null, undefined and empty containers", () => {
		expect(findUnpostable({ a: null, b: undefined, c: [], d: {} })).toBeNull();
	});

	it("terminates on a cycle", () => {
		const a: Record<string, unknown> = { name: "a" };
		a.self = a;
		expect(findUnpostable(a)).toBeNull();
	});

	it("finds a symbol reached through a cycle-containing object", () => {
		const a: Record<string, unknown> = { bad: MIXED };
		a.self = a;
		expect(findUnpostable(a)).toBe("payload.bad (Symbol(figma.mixed))");
	});

	it("gives up rather than recursing forever on a very deep payload", () => {
		let deep: Record<string, unknown> = { end: MIXED };
		for (let i = 0; i < 200; i++) deep = { next: deep };
		expect(findUnpostable(deep)).toBeNull();
	});
});
