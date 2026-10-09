import type { Fill, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import {
	addStop,
	convertFill,
	fillsOf,
	fillsPatch,
	type Gradient,
	removeStop,
} from "@freshcoat-js/coatfile/fills";
import { describe, expect, it } from "vitest";
import { getElement } from "~/doc/path";
import { patchLayers } from "~/panels/design/field-helpers";
import { editedGradient, removeAt, replaceAt } from "~/panels/design/fills";
import { conditionsOf, opOf, withOp } from "~/panels/design/VisibilitySection";
import { doc } from "./doc-fixture";

/** Rewrites the fills of `keys` with `fn`, as the Fill section does. */
function editFills(
	t: Template,
	keys: string[],
	fn: (fills: Fill[]) => Fill[],
): Template {
	const r = patchLayers(
		t,
		keys,
		(el) => ({ properties: fillsPatch(el, fn(fillsOf(el))) }),
		getElement,
	);
	if (!r.ok) throw new Error(r.reason);
	return r.template;
}

function expectValid(t: Template) {
	const v = validate(t);
	expect(v.ok ? [] : v.errors).toEqual([]);
}

const RECT = "0/0";
const TEXT = "0/1/1";
const BG = "0/bg";

describe("fill list edits", () => {
	it("adds, converts and removes fills on a rect, staying valid", () => {
		let t = doc();
		t = editFills(t, [RECT], (f) => [...f, "#ff0000"]);
		expect(fillsOf(getElement(t, RECT) as never)).toEqual([
			"#111111",
			"#ff0000",
		]);
		expectValid(t);

		for (const kind of [
			"linear",
			"radial",
			"angular",
			"pattern",
			"solid",
		] as const) {
			t = editFills(t, [RECT], (f) => replaceAt(f, 1, convertFill(f[1], kind)));
			expectValid(t);
		}
		t = editFills(t, [RECT], (f) => removeAt(f, 0));
		expect(getElement(t, RECT)?.properties).toMatchObject({ fill: "#ff0000" });
		t = editFills(t, [RECT], (f) => removeAt(f, 0));
		expect(getElement(t, RECT)?.properties).not.toHaveProperty("fill");
		expectValid(t);
	});

	it("keeps gradients at two stops or more", () => {
		let t = editFills(doc(), [RECT], (f) => [convertFill(f[0], "linear")]);
		const stops = () =>
			(fillsOf(getElement(t, RECT) as never)[0] as Gradient).stops;
		expect(stops()).toHaveLength(2);
		t = editFills(t, [RECT], ([g]) => [
			{ ...(g as Gradient), stops: addStop((g as Gradient).stops) },
		]);
		expect(stops().map((s) => s.offset)).toEqual([0, 0.5, 1]);
		expectValid(t);
		for (let i = 0; i < 3; i++)
			t = editFills(t, [RECT], ([g]) => [
				{ ...(g as Gradient), stops: removeStop((g as Gradient).stops, 0) },
			]);
		expect(stops()).toHaveLength(2);
		expectValid(t);
	});

	it("writes text solids to color and gradients to fill", () => {
		let t = editFills(doc(), [TEXT], () => ["#123456"]);
		expect(getElement(t, TEXT)?.properties).toMatchObject({ color: "#123456" });
		t = editFills(t, [TEXT], (f) => [convertFill(f[0], "radial")]);
		const p = getElement(t, TEXT)?.properties as Record<string, unknown>;
		expect((p.fill as Gradient).kind).toBe("radial");
		expectValid(t);
		t = editFills(t, [TEXT], (f) => [convertFill(f[0], "solid")]);
		expect(getElement(t, TEXT)?.properties).not.toHaveProperty("fill");
		expectValid(t);
	});

	it("edits the background and several layers at once", () => {
		let t = editFills(doc(), [BG], (f) => [convertFill(f[0], "linear")]);
		expectValid(t);
		t = editFills(t, ["0/0", "0/5", "0/1"], () => ["#abcdef"]);
		for (const k of ["0/0", "0/5", "0/1"])
			expect(getElement(t, k)?.properties).toMatchObject({ fill: "#abcdef" });
		expectValid(t);
	});
});

describe("visibility conditions", () => {
	it("maps each test to the format's shape", () => {
		const base = { field: "show" };
		expect(withOp(base, "set")).toEqual({ field: "show" });
		expect(withOp(base, "unset")).toEqual({ field: "show", not: true });
		expect(withOp(base, "equals")).toEqual({ field: "show", equals: "" });
		expect(withOp(base, "differs")).toEqual({
			field: "show",
			equals: "",
			not: true,
		});
		for (const op of ["set", "unset", "equals", "differs"] as const)
			expect(opOf(withOp(base, op))).toBe(op);
		expect(conditionsOf(getElement(doc(), "0/4") as never)).toEqual([
			{ field: "show" },
		]);
	});
});

describe("gradient handles", () => {
	const stops = [
		{ offset: 0, color: "#000000" },
		{ offset: 1, color: "#ff000080" },
	];

	it("edits the opened gradient, else the topmost", () => {
		const lin: Gradient = { kind: "linear", angle: 0, stops };
		expect(editedGradient([lin, "#fff", lin, "#000"], null)).toBe(2);
		expect(editedGradient([lin, "#fff", lin], 0)).toBe(0);
		expect(editedGradient([lin, "#fff"], 1)).toBe(0);
		expect(editedGradient(["#fff"], null)).toBeNull();
	});
});
