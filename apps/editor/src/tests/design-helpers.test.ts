import type { Element, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { beforeEach, describe, expect, it } from "vitest";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import {
	commonValue,
	documentSwatches,
	formatFeatures,
	mergeKeyOf,
	parseDash,
	parseFeatures,
	patchLayers,
} from "~/panels/design/field-helpers";
import { googleFontUrls, verifyGoogleFamily } from "~/panels/design/fonts";
import { liveRect, setAxis } from "~/panels/design/LayerSection";
import { pathDataError } from "~/panels/design/VectorSection";
import { doc, geometryOf } from "./doc-fixture";

function controllerWith(t: Template, selection: string[]): EditorController {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	c.select(selection);
	return c;
}

const el = (c: EditorController, key: string) =>
	getElement(c.template as Template, key) as Element;

describe("commonValue", () => {
	it("returns the shared value", () => {
		expect(commonValue([3, 3, 3])).toBe(3);
		expect(commonValue(["a"])).toBe("a");
	});
	it("returns null when values differ", () => {
		expect(commonValue([1, 2])).toBeNull();
		expect(commonValue(["#fff", "#000", "#fff"])).toBeNull();
	});
	it("compares objects and arrays by content", () => {
		expect(commonValue([{ a: [1, 2] }, { a: [1, 2] }])).toEqual({ a: [1, 2] });
		expect(commonValue([[1], [1, 2]])).toBeNull();
	});
	it("keeps undefined as a shared value and is null when empty", () => {
		expect(commonValue([undefined, undefined])).toBeUndefined();
		expect(commonValue([undefined, 1])).toBeNull();
		expect(commonValue([])).toBeNull();
	});
});

describe("patchLayers", () => {
	let c: EditorController;
	beforeEach(() => {
		c = controllerWith(doc(), ["0/0", "0/5"]);
	});

	it("writes every selected layer in one undo step", () => {
		const keys = c.state.selection;
		c.edit((t) => patchLayers(t, keys, () => ({ opacity: 0.5 }), getElement));
		expect(el(c, "0/0").opacity).toBe(0.5);
		expect(el(c, "0/5").opacity).toBe(0.5);
		expect(c.state.doc?.history.past).toHaveLength(1);
		c.undo();
		expect(el(c, "0/0").opacity).toBeUndefined();
		expect(el(c, "0/5").opacity).toBeUndefined();
	});

	it("merges a burst of edits to one field", () => {
		const keys = c.state.selection;
		for (const o of [0.9, 0.8, 0.7])
			c.edit((t) => patchLayers(t, keys, () => ({ opacity: o }), getElement), {
				mergeKey: mergeKeyOf("opacity", keys),
			});
		expect(el(c, "0/5").opacity).toBe(0.7);
		expect(c.state.doc?.history.past).toHaveLength(1);
	});

	it("skips layers whose patch is null and removes undefined keys", () => {
		c.edit((t) =>
			patchLayers(
				t,
				["0/0", "0/5"],
				(e) => (e.id === "a" ? { rotation: undefined, blur: 2 } : null),
				getElement,
			),
		);
		expect(el(c, "0/0").blur).toBe(2);
		expect(el(c, "0/5").blur).toBeUndefined();
		expect(el(c, "0/5").rotation).toBe(30);
	});
});

describe("setAxis", () => {
	it("sets absolute X for nested and top-level layers", () => {
		const t = doc();
		const g = geometryOf(t);
		const r = setAxis(t, ["0/0", "0/1/0"], "x", 250, g);
		if (!r.ok) throw new Error(r.reason);
		expect(getElement(r.template, "0/0")?.pos?.x).toBe(250);
		// f1 sits inside frame f at x 200, so its own x is parent-relative.
		expect(getElement(r.template, "0/1/0")?.pos?.x).toBe(50);
		expect(liveRect(r.template, "0/1/0", g)?.x).toBe(250);
	});

	it("gives an auto-layout child a fixed size and leaves its position", () => {
		const t = doc();
		const r = setAxis(t, ["0/3/0", "0/3/1"], "width", 70, geometryOf(t));
		if (!r.ok) throw new Error(r.reason);
		const r1 = getElement(r.template, "0/3/0") as Element;
		expect(r1.size?.width).toBe(70);
		expect(r1.pos).toBeUndefined();
		expect(getElement(r.template, "0/3/1")?.size?.width).toBe(70);
		expect(validate(r.template).ok).toBe(true);
	});
});

describe("small parsers", () => {
	it("parses dash text", () => {
		expect(parseDash("4 2")).toEqual([4, 2]);
		expect(parseDash("4, 2 1")).toEqual([4, 2, 1]);
		expect(parseDash("  ")).toBeUndefined();
		expect(parseDash("4 x")).toBeNull();
	});

	it("validates path data with the coat engine's tokenizer", () => {
		expect(pathDataError("M0 0L10 10Z")).toBeNull();
		expect(pathDataError("M0 0A5 5 0 1 0 10 10")).toBeNull();
		expect(pathDataError("")).not.toBeNull();
		expect(pathDataError("M0 0 K5 5")).not.toBeNull();
		expect(pathDataError("10 10")).not.toBeNull();
	});

	it("collects document colours, most used first", () => {
		const s = documentSwatches(doc().template_data);
		expect(s[0]).toBe("#000000");
		expect(s).toContain("#111111");
	});
});

describe("font families", () => {
	it("builds the Google stylesheet urls", () => {
		expect(googleFontUrls("Open Sans")).toEqual([
			"https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap",
			"https://fonts.googleapis.com/css2?family=Open+Sans&display=swap",
		]);
	});

	it("falls back to the plain stylesheet, then gives up", async () => {
		const seen: string[] = [];
		const second = await verifyGoogleFamily("Bebas Neue", async (u) => {
			seen.push(u);
			return { ok: seen.length === 2 };
		});
		expect(second).toEqual({
			kind: "google",
			family: "Bebas Neue",
			url: "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap",
		});
		const none = await verifyGoogleFamily("Nope", async () => {
			throw new Error("offline");
		});
		expect(none).toBeNull();
	});
});

describe("parseFeatures", () => {
	it("reads tags on, off and with values, and round-trips", () => {
		const f = parseFeatures("tnum, -liga ss01 salt=2");
		expect(f).toEqual({ tnum: 1, liga: 0, ss01: 1, salt: 2 });
		expect(parseFeatures(formatFeatures(f as Record<string, number>))).toEqual(
			f,
		);
		expect(parseFeatures("  ")).toBeUndefined();
		expect(parseFeatures("tabular")).toBeNull();
		expect(parseFeatures("-salt=2")).toBeNull();
	});
});
