import type { Element, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { beforeEach, describe, expect, it } from "vitest";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import {
	gridGaps,
	makeTrack,
	packGap,
	resizeTracks,
	switchLayout,
	trackAmount,
	trackKind,
} from "~/panels/design/FrameSection";
import {
	commonValue,
	documentSwatches,
	focusFieldOf,
	formatFeatures,
	formatGridLine,
	mergeKeyOf,
	parseDash,
	parseFeatures,
	parseGridLine,
	patchLayers,
} from "~/panels/design/field-helpers";
import { googleFontUrls, verifyGoogleFamily } from "~/panels/design/fonts";
import {
	focusFromPercent,
	focusPercent,
	setCropValue,
} from "~/panels/design/ImageSection";
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

describe("grid helpers", () => {
	it("reads and builds tracks by kind", () => {
		expect([120, "1.5fr", "auto"].map((t) => trackKind(t))).toEqual([
			"fixed",
			"fill",
			"hug",
		]);
		expect([120, "1.5fr", "auto"].map((t) => trackAmount(t))).toEqual([
			120,
			1.5,
			null,
		]);
		expect(makeTrack("fill")).toBe("1fr");
		expect(makeTrack("fill", 2)).toBe("2fr");
		expect(makeTrack("fixed")).toBe(100);
		expect(makeTrack("hug", 40)).toBe("auto");
	});

	it("adds and drops tracks at the end", () => {
		expect(resizeTracks([80], 3, "columns")).toEqual([80, "1fr", "1fr"]);
		expect(resizeTracks([], 2, "rows")).toEqual(["auto", "auto"]);
		expect(resizeTracks([80, "2fr", "auto"], 1, "columns")).toEqual([80]);
	});

	it("parses and formats grid lines", () => {
		expect(parseGridLine("2")).toBe(2);
		expect(parseGridLine("1-3")).toEqual([1, 3]);
		expect(parseGridLine("2 / 2")).toBe(2);
		expect(parseGridLine("auto")).toBeUndefined();
		expect(parseGridLine("")).toBeUndefined();
		expect(parseGridLine("3-1")).toBeNull();
		expect(parseGridLine("0")).toBeNull();
		expect(formatGridLine([1, 3])).toBe("1-3");
		expect(formatGridLine(2)).toBe("2");
	});

	it("switches between flex and grid, keeping spacing", () => {
		const grid = switchLayout(
			{ direction: "column", gap: 6, padding: { top: 4 } },
			"grid",
		);
		expect(grid).toEqual({
			type: "grid",
			columns: ["1fr", "1fr"],
			gap: 6,
			padding: { top: 4 },
		});
		expect(
			switchLayout({ type: "grid", columns: [10], gap: [2, 9] }, "flex"),
		).toEqual({ direction: "row", gap: 9 });
	});

	it("packs gaps into their shortest form", () => {
		expect(packGap([0, 0])).toBeUndefined();
		expect(packGap([4, 4])).toBe(4);
		expect(packGap([4, 8])).toEqual([4, 8]);
		expect(gridGaps({ type: "grid", columns: [1], gap: 3 })).toEqual([3, 3]);
		expect(gridGaps({ type: "grid", columns: [1] })).toEqual([0, 0]);
	});
});

describe("image framing helpers", () => {
	it("reads and writes focal points in percent", () => {
		expect(focusPercent(undefined)).toEqual({ x: 50, y: 50 });
		expect(focusPercent([0.25, 1])).toEqual({ x: 25, y: 100 });
		expect(focusPercent("{{photo_focus}}")).toEqual({ x: 50, y: 50 });
		expect(focusFromPercent(50, 50)).toBeUndefined();
		expect(focusFromPercent(20, 120)).toEqual([0.2, 1]);
		expect(focusFieldOf("{{ photo_focus }}")).toBe("photo_focus");
		expect(focusFieldOf("0.2,0.3")).toBeUndefined();
	});

	it("keeps a crop inside the image", () => {
		const full = { x: 0, y: 0, width: 1, height: 1 };
		expect(setCropValue(full, "x", 40)).toEqual({
			x: 0.4,
			y: 0,
			width: 0.6,
			height: 1,
		});
		expect(setCropValue({ ...full, x: 0.5, width: 0.5 }, "width", 80)).toEqual({
			x: 0.5,
			y: 0,
			width: 0.5,
			height: 1,
		});
		const edge = setCropValue(full, "y", 100);
		expect(edge.y + edge.height).toBeLessThanOrEqual(1);
		expect(edge.height).toBeGreaterThan(0);
	});
});
