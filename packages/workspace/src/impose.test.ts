import { describe, expect, it } from "vitest";
import {
	cardSizeMm,
	cropMarks,
	DEFAULT_SHEET_LAYOUT,
	type ImposeItem,
	imposeSheets,
	minGapMm,
	SheetLayoutError,
	sheetSummary,
} from "./impose";
import type { SheetLayout } from "./types";

const CR80 = { widthMm: 85.6, heightMm: 54 };

function layout(overrides: Partial<SheetLayout> = {}): SheetLayout {
	return {
		kind: "sheet",
		paper: "a4",
		orientation: "portrait",
		marginMm: 10,
		gapMm: 0,
		cropMarks: true,
		duplex: "none",
		...overrides,
	};
}

type Item = ImposeItem & { name: string };

/** `count` records of `sides` sides each, in plan order. */
function items(count: number, sides = 1): Item[] {
	return Array.from({ length: count }, (_, r) =>
		Array.from({ length: sides }, (_, s) => ({
			name: `${r + 1}${s === 0 ? "f" : "b"}`,
			recordId: `r_${r + 1}`,
		})),
	).flat();
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

const placed = (page: { slots: { item: Item; xMm: number; yMm: number }[] }) =>
	page.slots.map((s) => [
		s.item.name,
		Math.round(s.xMm * 1000) / 1000,
		Math.round(s.yMm * 1000) / 1000,
	]);

describe("imposeSheets", () => {
	it("fits CR80 on A4 portrait with a 10 mm margin 2 × 5, centred", () => {
		const out = imposeSheets(items(10), CR80, layout());
		expect(out).toMatchObject({
			paper: { widthMm: 210, heightMm: 297, orientation: "portrait" },
			columns: 2,
			rows: 5,
			perSheet: 10,
			sheets: 1,
		});
		expect(out.originMm.x).toBeCloseTo(19.4, 9);
		expect(out.originMm.y).toBeCloseTo(13.5, 9);
		expect(out.pages).toHaveLength(1);
		expect(out.pages[0]?.side).toBe("any");
		expect(placed(out.pages[0] as never)).toEqual([
			["1f", 19.4, 13.5],
			["2f", 105, 13.5],
			["3f", 19.4, 67.5],
			["4f", 105, 67.5],
			["5f", 19.4, 121.5],
			["6f", 105, 121.5],
			["7f", 19.4, 175.5],
			["8f", 105, 175.5],
			["9f", 19.4, 229.5],
			["10f", 105, 229.5],
		]);
		expect(out.pages[0]?.slots.every((s) => s.rotated === false)).toBe(true);
	});

	it("fills sheets in order, every side its own item, single-sided", () => {
		const out = imposeSheets(items(6, 2), CR80, layout());
		expect(out.pages).toHaveLength(2);
		expect(out.sheets).toBe(2);
		expect(out.pages[0]?.slots.map((s) => s.item.name)).toEqual([
			"1f",
			"1b",
			"2f",
			"2b",
			"3f",
			"3b",
			"4f",
			"4b",
			"5f",
			"5b",
		]);
		expect(placed(out.pages[1] as never)).toEqual([
			["6f", 19.4, 13.5],
			["6b", 105, 13.5],
		]);
		expect(sheetSummary(out)).toBe("10 per sheet · 2 sheets");
	});

	it("spaces cards by the gap and centres the grid", () => {
		const out = imposeSheets(items(1), CR80, layout({ gapMm: 5 }));
		// floor((190 + 5) / 90.6) = 2, floor((277 + 5) / 59) = 4
		expect([out.columns, out.rows]).toEqual([2, 4]);
		expect(out.originMm.x).toBeCloseTo(16.9, 9);
		expect(out.originMm.y).toBeCloseTo(10 + (277 - 231) / 2, 9);
	});

	it("lays out landscape with the long edge across", () => {
		const out = imposeSheets(
			items(1),
			CR80,
			layout({ orientation: "landscape" }),
		);
		expect(out.paper).toEqual({
			widthMm: 297,
			heightMm: 210,
			orientation: "landscape",
		});
		expect([out.columns, out.rows]).toEqual([3, 3]);
		expect(out.originMm.x).toBeCloseTo(20.1, 9);
		expect(out.originMm.y).toBeCloseTo(24, 9);
	});

	it("reads a custom paper short edge across, and named sizes by name", () => {
		const custom = imposeSheets(
			items(1),
			CR80,
			layout({ paper: { widthMm: 297, heightMm: 210 } }),
		);
		expect(custom.paper.widthMm).toBe(210);
		expect(custom.paper.heightMm).toBe(297);
		const tabloid = imposeSheets(items(1), CR80, layout({ paper: "tabloid" }));
		expect(tabloid.paper).toMatchObject({ widthMm: 279.4, heightMm: 431.8 });
		const letter = imposeSheets(items(1), CR80, layout({ paper: "letter" }));
		expect(letter.paper).toMatchObject({ widthMm: 215.9, heightMm: 279.4 });
	});

	describe("auto orientation", () => {
		it("picks whichever fits more", () => {
			const card = { widthMm: 100, heightMm: 60 };
			// portrait 1 × 4, landscape 2 × 3
			const out = imposeSheets(items(1), card, layout({ orientation: "auto" }));
			expect(out.paper.orientation).toBe("landscape");
			expect(out.perSheet).toBe(6);
			const cr80 = imposeSheets(
				items(1),
				CR80,
				layout({ orientation: "auto" }),
			);
			expect(cr80.paper.orientation).toBe("portrait");
			expect(cr80.perSheet).toBe(10);
		});

		it("goes portrait on a tie", () => {
			const card = { widthMm: 90, heightMm: 90 };
			// 2 × 3 either way round
			const out = imposeSheets(items(1), card, layout({ orientation: "auto" }));
			expect(out.paper.orientation).toBe("portrait");
			expect([out.columns, out.rows]).toEqual([2, 3]);
		});

		it("takes landscape when only landscape fits", () => {
			const card = { widthMm: 200, heightMm: 54 };
			const out = imposeSheets(items(1), card, layout({ orientation: "auto" }));
			expect(out.paper.orientation).toBe("landscape");
		});
	});

	describe("duplex", () => {
		it("puts backs in the mirrored column on a long-edge flip", () => {
			const out = imposeSheets(
				items(3, 2),
				CR80,
				layout({ duplex: "long-edge" }),
			);
			expect(out.pages.map((p) => p.side)).toEqual(["front", "back"]);
			expect(out.sheets).toBe(1);
			expect(placed(out.pages[0] as never)).toEqual([
				["1f", 19.4, 13.5],
				["2f", 105, 13.5],
				["3f", 19.4, 67.5],
			]);
			expect(placed(out.pages[1] as never)).toEqual([
				["1b", 105, 13.5],
				["2b", 19.4, 13.5],
				["3b", 105, 67.5],
			]);
		});

		it("puts backs in the mirrored row on a short-edge flip", () => {
			const out = imposeSheets(
				items(3, 2),
				CR80,
				layout({ duplex: "short-edge" }),
			);
			expect(placed(out.pages[1] as never)).toEqual([
				["1b", 19.4, 229.5],
				["2b", 105, 229.5],
				["3b", 19.4, 175.5],
			]);
		});

		it("mirrors across the long edge of a landscape sheet, its rows", () => {
			const long = imposeSheets(
				items(2, 2),
				CR80,
				layout({ orientation: "landscape", duplex: "long-edge" }),
			);
			// 3 × 3 from (20.1, 24): record 1 is at the top left
			expect(placed(long.pages[1] as never)).toEqual([
				["1b", 20.1, 132],
				["2b", 105.7, 132],
			]);
			const short = imposeSheets(
				items(2, 2),
				CR80,
				layout({ orientation: "landscape", duplex: "short-edge" }),
			);
			expect(placed(short.pages[1] as never)).toEqual([
				["1b", 191.3, 24],
				["2b", 105.7, 24],
			]);
		});

		it("shifts back pages by the back offset, and only them", () => {
			const out = imposeSheets(
				items(1, 2),
				CR80,
				layout({ duplex: "long-edge", backOffsetMm: { x: 1, y: -0.5 } }),
			);
			expect(placed(out.pages[0] as never)).toEqual([["1f", 19.4, 13.5]]);
			expect(placed(out.pages[1] as never)).toEqual([["1b", 106, 13]]);
		});

		it("alternates front and back across sheets", () => {
			const out = imposeSheets(
				items(11, 2),
				CR80,
				layout({ duplex: "long-edge" }),
			);
			expect(out.pages.map((p) => [p.side, p.slots.length])).toEqual([
				["front", 10],
				["back", 10],
				["front", 1],
				["back", 1],
			]);
			expect(out.sheets).toBe(2);
			expect(sheetSummary(out)).toBe("10 per sheet · 2 sheets");
			expect(out.pages[3]?.slots[0]?.item.name).toBe("11b");
			expect(out.pages[3]?.slots[0]?.xMm).toBeCloseTo(105, 9);
		});

		it("keeps a record's slot when one of its sides is missing", () => {
			const all = items(2, 2);
			const withoutFront = [all[1], all[2], all[3]].map((item, n) =>
				n === 0 ? { ...(item as Item), sideIndex: 1 } : (item as Item),
			);
			const out = imposeSheets(
				withoutFront,
				CR80,
				layout({ duplex: "long-edge" }),
			);
			expect(placed(out.pages[0] as never)).toEqual([["2f", 105, 13.5]]);
			expect(placed(out.pages[1] as never)).toEqual([
				["1b", 105, 13.5],
				["2b", 19.4, 13.5],
			]);
		});

		it("pairs sides per record and variant, so every variant is a card", () => {
			const cards = ["default", "midnight"].flatMap((variant) =>
				["f", "b"].map((side) => ({
					name: `${variant}-${side}`,
					recordId: "",
					...(variant === "default" ? {} : { variantId: variant }),
				})),
			);
			const out = imposeSheets(cards, CR80, layout({ duplex: "long-edge" }));
			expect(placed(out.pages[0] as never)).toEqual([
				["default-f", 19.4, 13.5],
				["midnight-f", 105, 13.5],
			]);
			expect(placed(out.pages[1] as never)).toEqual([
				["default-b", 105, 13.5],
				["midnight-b", 19.4, 13.5],
			]);
		});

		it("prints a one-sided template's fronts only", () => {
			const out = imposeSheets(
				items(12),
				CR80,
				layout({ duplex: "long-edge" }),
			);
			expect(out.pages.map((p) => [p.side, p.slots.length])).toEqual([
				["front", 10],
				["front", 2],
			]);
			expect(out.sheets).toBe(2);
		});

		it("adds empty backs to a one-sided template when asked", () => {
			const out = imposeSheets(
				items(12),
				CR80,
				layout({ duplex: "short-edge", blankBacks: true }),
			);
			expect(out.pages.map((p) => [p.side, p.slots.length])).toEqual([
				["front", 10],
				["back", 0],
				["front", 2],
				["back", 0],
			]);
			expect(out.sheets).toBe(2);
		});

		it("refuses more than two sides", () => {
			expect(() =>
				imposeSheets(items(2, 3), CR80, layout({ duplex: "long-edge" })),
			).toThrow(/two sides.*has 3/);
			// single-sided, three sides are three items
			expect(
				imposeSheets(items(2, 3), CR80, layout()).pages[0]?.slots,
			).toHaveLength(6);
		});
	});

	describe("errors", () => {
		const error = (fn: () => unknown) => {
			try {
				fn();
			} catch (e) {
				return e as SheetLayoutError;
			}
			throw new Error("did not throw");
		};

		it("names the side that doesn't fit", () => {
			const wide = error(() =>
				imposeSheets(items(1), { widthMm: 200, heightMm: 54 }, layout()),
			);
			expect(wide).toBeInstanceOf(SheetLayoutError);
			expect(wide.axis).toBe("width");
			expect(wide.message).toBe(
				"The card is 200 mm × 54 mm, too wide: the paper leaves 190 mm × 277 mm inside its margins in portrait",
			);
			const tall = error(() =>
				imposeSheets(items(1), { widthMm: 54, heightMm: 290 }, layout()),
			);
			expect(tall.axis).toBe("height");
			expect(tall.message).toMatch(/too tall/);
			const both = error(() =>
				imposeSheets(
					items(1),
					{ widthMm: 300, heightMm: 300 },
					layout({ orientation: "auto" }),
				),
			);
			expect(both.axis).toBe("both");
			expect(both.message).toMatch(/too wide and too tall.*either way round/);
		});

		it("counts the margin against the paper", () => {
			const e = error(() =>
				imposeSheets(items(1), CR80, layout({ marginMm: 70 })),
			);
			expect(e.axis).toBe("width");
		});

		it("refuses negative margins and gaps, and an empty card", () => {
			expect(() =>
				imposeSheets(items(1), CR80, layout({ marginMm: -1 })),
			).toThrow(SheetLayoutError);
			expect(() => imposeSheets(items(1), CR80, layout({ gapMm: -1 }))).toThrow(
				/gap/,
			);
			expect(() =>
				imposeSheets(items(1), { widthMm: 0, heightMm: 54 }, layout()),
			).toThrow(/card/);
		});

		it("lays out nothing without failing", () => {
			const out = imposeSheets([], CR80, DEFAULT_SHEET_LAYOUT);
			expect(out.pages).toEqual([]);
			expect(sheetSummary(out)).toBe("10 per sheet · 0 sheets");
		});
	});
});

describe("cropMarks", () => {
	it("marks both ends of every cut line in the margin", () => {
		const marks = cropMarks(imposeSheets(items(1), CR80, layout()));
		// 3 vertical cut lines (x 19.4, 105, 190.6), 6 horizontal
		expect(marks).toHaveLength(3 * 2 + 6 * 2);
		const rounded = marks.map((m) => ({
			x1: round(m.x1),
			y1: round(m.y1),
			x2: round(m.x2),
			y2: round(m.y2),
		}));
		expect(rounded[0]).toEqual({ x1: 19.4, y1: 12.5, x2: 19.4, y2: 8.5 });
		expect(rounded[1]).toEqual({ x1: 19.4, y1: 284.5, x2: 19.4, y2: 288.5 });
		expect(rounded).toContainEqual({ x1: 18.4, y1: 13.5, x2: 14.4, y2: 13.5 });
		expect(rounded).toContainEqual({
			x1: 191.6,
			y1: 283.5,
			x2: 195.6,
			y2: 283.5,
		});
	});

	it("keeps marks out of a narrow gap, and puts them in a wide one", () => {
		const narrow = cropMarks(
			imposeSheets(items(1), CR80, layout({ gapMm: 5 })),
		);
		// 2 × 4: 4 vertical cut lines, 8 horizontal, margins only
		expect(narrow).toHaveLength(4 * 2 + 8 * 2);
		const wide = imposeSheets(items(1), CR80, layout({ gapMm: 10 }));
		expect([wide.columns, wide.rows]).toEqual([2, 4]);
		// each vertical line: 2 margin marks + 2 in each of 3 row gaps
		// each horizontal line: 2 margin marks + 2 in the column gap
		const marks = cropMarks(wide);
		expect(marks).toHaveLength(4 * (2 + 2 * 3) + 8 * (2 + 2 * 1));
	});

	it("never crosses a card", () => {
		for (const gapMm of [0, 3, 10, 12]) {
			const imposition = imposeSheets(items(1), CR80, layout({ gapMm }));
			const { columns, rows, originMm } = imposition;
			for (const m of cropMarks(imposition)) {
				for (let c = 0; c < columns; c++)
					for (let r = 0; r < rows; r++) {
						const x = originMm.x + c * (CR80.widthMm + gapMm);
						const y = originMm.y + r * (CR80.heightMm + gapMm);
						const inside = (px: number, py: number) =>
							px > x + 1e-6 &&
							px < x + CR80.widthMm - 1e-6 &&
							py > y + 1e-6 &&
							py < y + CR80.heightMm - 1e-6;
						const mid = [(m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2] as const;
						expect(inside(m.x1, m.y1) || inside(...mid)).toBe(false);
						// and they start 1 mm off the card, 4 mm long at most
						expect(Math.hypot(m.x2 - m.x1, m.y2 - m.y1)).toBeLessThanOrEqual(
							4 + 1e-9,
						);
					}
			}
		}
	});

	it("cuts marks short at the paper's edge", () => {
		const tight = imposeSheets(
			items(1),
			CR80,
			layout({
				paper: { widthMm: 88.6, heightMm: 60 },
				orientation: "landscape",
				marginMm: 0,
			}),
		);
		// 1.5 mm across either side of the card, 3 mm above and below
		const marks = cropMarks(tight);
		expect(marks).toHaveLength(8);
		for (const m of marks) {
			for (const v of [m.x1, m.x2]) expect(v).toBeGreaterThanOrEqual(0);
			for (const v of [m.y1, m.y2]) expect(v).toBeGreaterThanOrEqual(0);
		}
		const bare = imposeSheets(
			items(1),
			CR80,
			layout({
				paper: { widthMm: 54, heightMm: 85.6 },
				marginMm: 0,
				orientation: "landscape",
			}),
		);
		expect(cropMarks(bare)).toEqual([]);
	});
});

describe("bleed", () => {
	it("places each card by its trim, with the gap widened to hold both bleeds", () => {
		const out = imposeSheets(items(4), CR80, layout(), { bleedMm: 3 });
		expect(out.gapMm).toBe(6);
		expect(out.bleedMm).toEqual({ top: 3, right: 3, bottom: 3, left: 3 });
		expect([out.columns, out.rows]).toEqual([2, 4]);
		const [a, b, c] = out.pages[0]?.slots ?? [];
		expect(round((b?.xMm ?? 0) - (a?.xMm ?? 0))).toBe(85.6 + 6);
		expect(round((c?.yMm ?? 0) - (a?.yMm ?? 0))).toBe(54 + 6);
	});

	it("keeps a gap already wide enough", () => {
		const out = imposeSheets(items(1), CR80, layout({ gapMm: 8 }), {
			bleedMm: 3,
		});
		expect(out.gapMm).toBe(8);
	});

	it("widens the gap by the wider axis of an uneven bleed", () => {
		const bleedMm = { top: 1, right: 2, bottom: 3, left: 4 };
		expect(minGapMm(bleedMm)).toBe(6);
		expect(imposeSheets(items(1), CR80, layout(), { bleedMm }).gapMm).toBe(6);
	});

	it("leaves a layout without bleed as it was", () => {
		const out = imposeSheets(items(1), CR80, layout(), { bleedMm: 0 });
		expect(out).toEqual(imposeSheets(items(1), CR80, layout()));
		expect(out.bleedMm).toBeUndefined();
	});

	it("refuses a negative bleed", () => {
		expect(() =>
			imposeSheets(items(1), CR80, layout(), { bleedMm: -1 }),
		).toThrow(SheetLayoutError);
	});

	it("starts crop marks outside the bleed and keeps them off every card's bleed", () => {
		for (const [gapMm, bleed] of [
			[0, 3],
			[16, 3],
			[20, 5],
		] as const) {
			const imposition = imposeSheets(items(1), CR80, layout({ gapMm }), {
				bleedMm: bleed,
			});
			const { columns, rows, originMm } = imposition;
			const gap = imposition.gapMm;
			const marks = cropMarks(imposition);
			const first = marks[0];
			expect(first?.x1).toBeCloseTo(originMm.x, 9);
			expect(first?.y1).toBeCloseTo(originMm.y - bleed - 1, 9);
			for (const m of marks)
				for (let c = 0; c < columns; c++)
					for (let r = 0; r < rows; r++) {
						const x = originMm.x + c * (CR80.widthMm + gap) - bleed;
						const y = originMm.y + r * (CR80.heightMm + gap) - bleed;
						const w = CR80.widthMm + 2 * bleed;
						const h = CR80.heightMm + 2 * bleed;
						const inside = (px: number, py: number) =>
							px > x + 1e-6 &&
							px < x + w - 1e-6 &&
							py > y + 1e-6 &&
							py < y + h - 1e-6;
						expect(inside(m.x1, m.y1) || inside(m.x2, m.y2)).toBe(false);
					}
		}
	});

	it("puts marks in the gap only when it holds both bleeds and two marks", () => {
		const count = (gapMm: number) => {
			const imposition = imposeSheets(items(1), CR80, layout({ gapMm }), {
				bleedMm: 3,
			});
			return [
				imposition.columns,
				imposition.rows,
				cropMarks(imposition).length,
			];
		};
		// 2 × 4, margins only
		expect(count(15)).toEqual([2, 4, 4 * 2 + 8 * 2]);
		expect(count(16)).toEqual([2, 4, 4 * (2 + 2 * 3) + 8 * (2 + 2 * 1)]);
	});
});

describe("cardSizeMm", () => {
	it("is the pixels at the DPI in millimetres", () => {
		const card = cardSizeMm(1200, 900, 300);
		expect(card.widthMm).toBeCloseTo(101.6, 9);
		expect(card.heightMm).toBeCloseTo(76.2, 9);
	});
});
