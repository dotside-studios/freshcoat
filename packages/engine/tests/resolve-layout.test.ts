// Phase 2 of the Node IR: resolveLayout turns declarative flex (auto-layout)
// groups into absolute pos/size on every node. These lock the flex algorithm —
// gap/padding, hug/fill/grow sizing, justify/align, wrap, nesting, and the
// text width→height coupling — with a deterministic stub `measure` so the
// geometry is exact (no font/CanvasKit dependency).
import { describe, expect, test } from "vitest";
import type { MeasureText, ResolvedFont } from "../src/index";
import {
	autoLayout,
	createGroup,
	createRect,
	createText,
	gridLayout,
	resolveLayout,
} from "../src/index";
import type { GridLayout, GroupNode, Node } from "../src/node";

// A stub metric: every glyph is `size`×`size`; a single line is chars*size wide
// and `size` tall. With a maxWidth, wrap greedily by whole chars (word-blind —
// fine, the point is exercising the width→height coupling, not real shaping).
const measure: MeasureText = (text, font, maxWidth) => {
	const g = font.size;
	const chars = text.length;
	if (maxWidth == null) return { width: chars * g, height: g };
	const perLine = Math.max(1, Math.floor(maxWidth / g));
	const lines = Math.max(1, Math.ceil(chars / perLine));
	return { width: Math.min(chars, perLine) * g, height: lines * g };
};

const FONT: ResolvedFont = {
	family: "Stub",
	weight: 400,
	style: "normal",
	size: 10,
	lineHeight: 10,
};

const rect = (w: number, h: number, extra?: Partial<Node>) =>
	createRect({ size: { width: w, height: h }, ...extra });

// Narrow a resolved node to a group and index its children for assertions.
function asGroup(n: Node): GroupNode {
	if (n.kind !== "group") throw new Error("expected group");
	return n;
}

describe("resolveLayout — flex", () => {
	test("row: gap + padding place fixed children left→right", () => {
		const g = autoLayout(
			createGroup([rect(20, 20), rect(30, 20)], {
				pos: { x: 0, y: 0 },
				size: { width: 200, height: 50 },
			}),
			{ direction: "row", gap: 10, padding: 5 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.layout).toBeUndefined();
		expect(out.children[0].pos).toEqual({ x: 5, y: 5 });
		expect(out.children[0].size).toEqual({ width: 20, height: 20 });
		// second child: 5 (pad) + 20 (first) + 10 (gap) = 35
		expect(out.children[1].pos).toEqual({ x: 35, y: 5 });
	});

	test("column: children stack top→bottom by height + gap", () => {
		const g = autoLayout(
			createGroup([rect(40, 20), rect(40, 30)], {
				size: { width: 100, height: 200 },
			}),
			{ direction: "column", gap: 8 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[0].pos).toEqual({ x: 0, y: 0 });
		expect(out.children[1].pos).toEqual({ x: 0, y: 28 }); // 20 + 8
	});

	test("justify=center offsets the block by half the free space", () => {
		const g = autoLayout(
			createGroup([rect(20, 20), rect(20, 20)], {
				size: { width: 100, height: 40 },
			}),
			{ direction: "row", gap: 0, justify: "center" },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// content 100, used 40, free 60 → leading 30
		expect(out.children[0].pos).toEqual({ x: 30, y: 0 });
		expect(out.children[1].pos).toEqual({ x: 50, y: 0 });
	});

	test("justify=space-between spreads free space between items", () => {
		const g = autoLayout(
			createGroup([rect(20, 20), rect(20, 20), rect(20, 20)], {
				size: { width: 120, height: 40 },
			}),
			{ direction: "row", gap: 0, justify: "space-between" },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// used 60, free 60, gaps between 3 items = 2 → between = 30
		expect(out.children[0].pos.x).toBe(0);
		expect(out.children[1].pos.x).toBe(50);
		expect(out.children[2].pos.x).toBe(100);
	});

	test("align=center centers children on the cross axis", () => {
		const g = autoLayout(
			createGroup([rect(20, 20)], { size: { width: 100, height: 50 } }),
			{ direction: "row", align: "center" },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[0].pos).toEqual({ x: 0, y: 15 }); // (50-20)/2
	});

	test("fill on the main axis claims all free space (grow:1)", () => {
		const g = autoLayout(
			createGroup(
				[
					rect(20, 20),
					rect(0, 20, { layoutChild: { width: "fill", grow: 1 } }),
				],
				{ size: { width: 100, height: 20 } },
			),
			{ direction: "row", gap: 0 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[1].pos.x).toBe(20);
		expect(out.children[1].size).toEqual({ width: 80, height: 20 });
	});

	test("grow children split free space equally (coatfile semantics)", () => {
		const g = autoLayout(
			createGroup(
				[
					rect(0, 20, { layoutChild: { width: "fill", grow: 1 } }),
					rect(0, 20, { layoutChild: { width: "fill", grow: 1 } }),
				],
				{ size: { width: 80, height: 20 } },
			),
			{ direction: "row", gap: 0 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[0].size?.width).toBe(40); // 80 / 2
		expect(out.children[1].size?.width).toBe(40);
		expect(out.children[1].pos.x).toBe(40);
	});

	test("max clamps a grow child; leftover stays with the container", () => {
		const g = autoLayout(
			createGroup(
				[
					rect(0, 20, {
						layoutChild: { width: "fill", grow: 1, max: { width: 30 } },
					}),
				],
				{ size: { width: 100, height: 20 } },
			),
			{ direction: "row", gap: 0 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[0].size?.width).toBe(30); // capped at max
	});

	test("absolute child ignores flow, placed at container origin + its pos", () => {
		const g = autoLayout(
			createGroup(
				[
					rect(20, 20),
					rect(15, 15, {
						pos: { x: 80, y: 5 },
						layoutChild: { absolute: true },
					}),
				],
				{ pos: { x: 100, y: 100 }, size: { width: 200, height: 40 } },
			),
			{ direction: "row", gap: 10, padding: 5 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// flow child at origin 100+5
		expect(out.children[0].pos).toEqual({ x: 105, y: 105 });
		// absolute child: container pos + its own pos, out of flow
		const abs = out.children[out.children.length - 1];
		expect(abs.pos).toEqual({ x: 180, y: 105 });
	});

	test("justify=space-evenly distributes equal gaps including the ends", () => {
		const g = autoLayout(
			createGroup([rect(20, 20), rect(20, 20)], {
				size: { width: 120, height: 20 },
			}),
			{ direction: "row", gap: 0, justify: "space-evenly" },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// free 80, 2 items → 3 units of 80/3 ≈ 26.67: x0=26.67, x1=26.67+20+26.67
		expect(out.children[0].pos.x).toBeCloseTo(80 / 3, 5);
		expect(out.children[1].pos.x).toBeCloseTo(80 / 3 + 20 + 80 / 3, 5);
	});

	test("wrap stacks lines by crossGap", () => {
		const g = autoLayout(
			createGroup([rect(60, 20), rect(60, 20), rect(60, 20)], {
				size: { width: 100, height: 200 },
			}),
			{ direction: "row", gap: 10, wrap: true, crossGap: 5 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// first line holds one (60), second wraps (60+10+60 > 100 keeps 1 each)
		expect(out.children[0].pos).toEqual({ x: 0, y: 0 });
		expect(out.children[1].pos).toEqual({ x: 0, y: 25 }); // 20 + crossGap 5
		expect(out.children[2].pos).toEqual({ x: 0, y: 50 });
	});

	test("hug width shrinks the container to its content + padding", () => {
		const g = autoLayout(
			createGroup([rect(20, 20), rect(30, 20)], {
				size: { width: 999, height: 999 },
				layoutChild: { width: "hug", height: "hug" },
			}),
			{ direction: "row", gap: 10, padding: 5 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// main: 5 + 20 + 10 + 30 + 5 = 70 ; cross: 5 + 20 + 5 = 30
		expect(out.size).toEqual({ width: 70, height: 30 });
	});

	test("text: cross width drives the wrapped main height", () => {
		// A column child whose width is fixed 30; text of 9 chars @10px wraps to
		// 3 per line → 3 lines → height 30. hug column height encloses it.
		const g = autoLayout(
			createGroup(
				[
					createText({
						text: "abcdefghi",
						font: FONT,
						layoutChild: { width: 30, height: "hug" },
					}),
				],
				{ size: { width: 30, height: 999 }, layoutChild: { height: "hug" } },
			),
			{ direction: "column" },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[0].size).toEqual({ width: 30, height: 30 });
		expect(out.size?.height).toBe(30);
	});

	test("nested auto-layout resolves at the size its parent hands it", () => {
		const inner = autoLayout(
			createGroup([rect(20, 20), rect(20, 20)], {
				layoutChild: { width: "hug", height: "hug" },
			}),
			{ direction: "row", gap: 10 },
		);
		const outer = autoLayout(
			createGroup([inner], {
				pos: { x: 0, y: 0 },
				size: { width: 200, height: 100 },
			}),
			{ direction: "column", padding: 5 },
		);
		const out = asGroup(resolveLayout(outer, { measure }));
		const nested = asGroup(out.children[0]);
		expect(nested.pos).toEqual({ x: 5, y: 5 });
		expect(nested.size).toEqual({ width: 50, height: 20 }); // 20+10+20 , 20
		expect(nested.layout).toBeUndefined();
		expect(nested.children[1].pos).toEqual({ x: 35, y: 5 }); // absolute
	});

	test("groups without a layout are passed through, descendants still resolved", () => {
		const inner = autoLayout(
			createGroup([rect(10, 10), rect(10, 10)], {
				pos: { x: 5, y: 5 },
				size: { width: 100, height: 20 },
			}),
			{ direction: "row", gap: 5 },
		);
		const plain = createGroup([inner], {
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
		});
		const out = asGroup(resolveLayout(plain, { measure }));
		expect(out.layout).toBeUndefined();
		const resolvedInner = asGroup(out.children[0]);
		expect(resolvedInner.children[1].pos).toEqual({ x: 20, y: 5 }); // 5 + 10 + 5
	});

	test("layout-less group folds its pos into children (static nesting)", () => {
		// A static (no-layout) group at {50,50} holding a leaf at {10,10} relative.
		const staticGroup = createGroup([rect(10, 10, { pos: { x: 10, y: 10 } })], {
			pos: { x: 50, y: 50 },
			size: { width: 100, height: 100 },
		});
		const out = asGroup(resolveLayout(staticGroup, { measure }));
		// leaf flattened to absolute: 50 + 10
		expect(out.children[0].pos).toEqual({ x: 60, y: 60 });
	});

	test("layout-less group nested inside a flex parent stays absolute", () => {
		const staticGroup = createGroup([rect(10, 10, { pos: { x: 5, y: 5 } })], {
			size: { width: 20, height: 20 },
			layoutChild: { width: 20, height: 20 },
		});
		const parent = autoLayout(
			createGroup([rect(20, 20), staticGroup], {
				pos: { x: 100, y: 100 },
				size: { width: 200, height: 40 },
			}),
			{ direction: "row", gap: 10, padding: 5 },
		);
		const out = asGroup(resolveLayout(parent, { measure }));
		const nested = asGroup(out.children[1]);
		// static group placed by flex at 100+5 + 20 + 10 = 135 (x), 105 (y)
		expect(nested.pos).toEqual({ x: 135, y: 105 });
		// its child folded: 135 + 5, 105 + 5
		expect(nested.children[0].pos).toEqual({ x: 140, y: 110 });
	});
});

describe("resolveLayout — grid", () => {
	const grid = (children: Node[], cfg: Omit<GridLayout, "type">): GroupNode =>
		gridLayout(createGroup(children), cfg);

	test("fixed columns place items in a row, items fill their cells", () => {
		const g = {
			...grid([rect(0, 0), rect(0, 0), rect(0, 0)], {
				columns: [30, 40, 50],
				rows: [20],
			}),
			pos: { x: 0, y: 0 },
			size: { width: 120, height: 20 },
		};
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.layout).toBeUndefined();
		expect(out.children[0].pos).toEqual({ x: 0, y: 0 });
		expect(out.children[0].size).toEqual({ width: 30, height: 20 });
		expect(out.children[1].pos.x).toBe(30);
		expect(out.children[1].size?.width).toBe(40);
		expect(out.children[2].pos.x).toBe(70);
		expect(out.children[2].size?.width).toBe(50);
	});

	test("fr columns split leftover space after fixed + gap", () => {
		const g = {
			...grid([rect(0, 0), rect(0, 0)], { columns: [40, "1fr"], gap: 10 }),
			size: { width: 100, height: 20 },
		};
		const out = asGroup(resolveLayout(g, { measure }));
		// leftover = 100 - 40 - 10(gap) = 50 → the 1fr col
		expect(out.children[0].size?.width).toBe(40);
		expect(out.children[1].pos.x).toBe(50); // 40 + 10
		expect(out.children[1].size?.width).toBe(50);
	});

	test("two fr columns split proportionally", () => {
		const g = {
			...grid([rect(0, 0), rect(0, 0)], { columns: ["1fr", "3fr"] }),
			size: { width: 80, height: 20 },
		};
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[0].size?.width).toBe(20); // 80 * 1/4
		expect(out.children[1].size?.width).toBe(60); // 80 * 3/4
		expect(out.children[1].pos.x).toBe(20);
	});

	test("auto-flow wraps into rows and stacks by row gap", () => {
		const g = {
			...grid([rect(0, 0), rect(0, 0), rect(0, 0)], {
				columns: [50, 50],
				rows: [20, 20],
				gap: [5, 0], // rowGap 5, colGap 0
			}),
			size: { width: 100, height: 45 },
		};
		const out = asGroup(resolveLayout(g, { measure }));
		// row-major: [0]→(0,0), [1]→(0,1), [2]→ next row (1,0)
		expect(out.children[0].pos).toEqual({ x: 0, y: 0 });
		expect(out.children[1].pos).toEqual({ x: 50, y: 0 });
		expect(out.children[2].pos).toEqual({ x: 0, y: 25 }); // 20 + rowGap 5
	});

	test("explicit column/row placement (1-based) with a span", () => {
		const g = {
			...grid([rect(0, 0), rect(0, 0)], {
				columns: [20, 20, 20],
				rows: [10, 10],
			}),
			size: { width: 60, height: 20 },
		};
		// child 0 at column 2, row 1; child 1 spans columns 1..3 on row 2
		const withPlacement: GroupNode = {
			...g,
			children: [
				{ ...g.children[0], layoutChild: { column: 2, row: 1 } },
				{ ...g.children[1], layoutChild: { column: [1, 3], row: 2 } },
			],
		};
		const out = asGroup(resolveLayout(withPlacement, { measure }));
		expect(out.children[0].pos).toEqual({ x: 20, y: 0 }); // col 2
		expect(out.children[1].pos).toEqual({ x: 0, y: 10 }); // row 2
		expect(out.children[1].size?.width).toBe(60); // span 3 cols (20*3)
	});

	test("auto column sizes to widest item; text drives row height at cell width", () => {
		// col 0 auto (fits the 30-wide text), col 1 fixed 30.
		const textNode = createText({
			text: "abcdef", // 6 chars @10 → natural width 60, wraps to 30 → 2 lines → h 20
			font: FONT,
			layoutChild: { width: 30, height: "hug", column: 2, row: 1 },
		});
		const g: GroupNode = {
			...grid(
				[rect(40, 12, { layoutChild: { column: 1, row: 1 } }), textNode],
				{
					columns: ["auto", 30],
					rows: ["auto"],
				},
			),
			size: { width: 200, height: 200 },
			layoutChild: { width: "hug", height: "hug" },
		};
		const out = asGroup(resolveLayout(g, { measure }));
		// auto col 0 = widest single-col item = 40 (the rect)
		expect(out.children[0].size?.width).toBe(40);
		// hug container width = 40 + 30 = 70
		expect(out.size?.width).toBe(70);
		// auto row height = tallest item; text at width 30 → 2 lines → 20
		expect(out.size?.height).toBe(20);
	});

	test("nested grid inside a flex parent resolves absolutely", () => {
		const inner = gridLayout(
			createGroup([rect(0, 0), rect(0, 0)], {
				layoutChild: { width: 60, height: 20 },
			}),
			{ columns: [30, 30] },
		);
		const outer = autoLayout(
			createGroup([inner], {
				pos: { x: 100, y: 50 },
				size: { width: 80, height: 40 },
			}),
			{ direction: "row", padding: 5 },
		);
		const out = asGroup(resolveLayout(outer, { measure }));
		const nested = asGroup(out.children[0]);
		expect(nested.pos).toEqual({ x: 105, y: 55 });
		// grid cells absolute: 105, then 135
		expect(nested.children[0].pos).toEqual({ x: 105, y: 55 });
		expect(nested.children[1].pos).toEqual({ x: 135, y: 55 });
	});
});

describe("fixed-width flex column nested in a row measures height at its width", () => {
	// Regression: a row measured a nested column's height by probing at width 0, so
	// wrapping fill-text inside a fixed-width column wrapped to nothing → runaway
	// height. The probe now uses the column's fixed width.
	test("wrapping text in a fixed-width nested column reports the wrapped height", () => {
		const column = createGroup(
			[
				createText({
					text: "0123456789", // 10 glyphs × size 10 = 100 natural width
					font: FONT,
					layoutChild: { width: "fill", height: "hug" },
				}),
			],
			{
				layout: { type: "flex", direction: "column" },
				size: { width: 50, height: 0 },
				layoutChild: { width: 50, height: "hug" },
			},
		);
		const row = createGroup([rect(30, 30), column], {
			layout: { type: "flex", direction: "row", gap: 0 },
			size: { width: 200, height: 0 },
		}) as GroupNode;

		const resolved = resolveLayout(row, { measure }) as GroupNode;
		const resolvedColumn = resolved.children[1];
		// At width 50: 5 glyphs/line → 2 lines → height 20 (not 100 at width 0).
		expect(resolvedColumn.size).toEqual({ width: 50, height: 20 });
	});
});

describe("text height is capped at maxLines (line-clamp)", () => {
	// A clamped paragraph bakes to at most maxLines, so auto-layout must reserve
	// only that height — not the full wrapped height — or a gap opens below it.
	test("a 4-line wrap with maxLines:2 reserves 2 lines", () => {
		const F1: ResolvedFont = {
			family: "Stub",
			weight: 400,
			style: "normal",
			size: 10,
			lineHeight: 1,
		};
		const column = createGroup(
			[
				createText({
					text: "01234567890123456789", // 20 glyphs
					font: F1,
					maxLines: 2,
					layoutChild: { width: "fill", height: "hug" },
				}),
			],
			{
				layout: { type: "flex", direction: "column" },
				size: { width: 50, height: 0 }, // 5 glyphs/line → 4 lines unclamped
				layoutChild: { width: 50, height: "hug" },
			},
		) as GroupNode;
		const resolved = resolveLayout(column, { measure }) as GroupNode;
		expect(resolved.size).toEqual({ width: 50, height: 20 }); // 2 lines, not 40
	});
});

describe("resolveLayout — rotated flow children", () => {
	// A node's pos/size is its UNROTATED box and the painter turns it around that
	// box's centre, so a turned child claims the bounding box of the turn while
	// still being handed its own box. This is the shape a Figma card hits: a
	// vertical label inside a column of horizontal content.
	test("column reserves a turned child's footprint, not its own height", () => {
		const label = rect(16, 100, { rotation: -90 });
		const g = autoLayout(
			createGroup([rect(200, 40), label, rect(200, 40)], {
				size: { width: 200, height: 500 },
			}),
			{ direction: "column", gap: 10 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// The turned label covers 100×16, so the row after it starts at
		// 40 + 10 + 16 + 10 = 76. Measuring its unrotated 100 tall would have
		// pushed that to 160.
		expect(out.children[2].pos).toEqual({ x: 0, y: 76 });
	});

	test("the turned child keeps its own box, centred on the footprint", () => {
		const label = rect(16, 100, { rotation: -90 });
		const g = autoLayout(
			createGroup([rect(200, 40), label], {
				size: { width: 200, height: 500 },
			}),
			{ direction: "column", gap: 10 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// Footprint is 100×16 at y=50; the 16×100 box shares its centre (50, 58).
		expect(out.children[1].size).toEqual({ width: 16, height: 100 });
		expect(out.children[1].pos).toEqual({ x: 42, y: 8 });
	});

	test("a hugging column hugs the footprint", () => {
		const g = createGroup([rect(16, 100, { rotation: 90 })], {
			size: { width: 200, height: 0 },
			layoutChild: { height: "hug" },
		});
		const out = asGroup(
			resolveLayout(autoLayout(g, { direction: "column", gap: 0 }), {
				measure,
			}),
		);
		expect(out.size?.height).toBe(16);
	});

	test("cross-axis align works off the footprint", () => {
		const g = autoLayout(
			createGroup([rect(16, 100, { rotation: 90 })], {
				size: { width: 200, height: 100 },
			}),
			{ direction: "column", align: "end" },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		// Footprint 100 wide, right-aligned in 200 → x 100..200; the 16-wide box
		// centres on that at 100 + 42.
		expect(out.children[0].pos).toEqual({ x: 142, y: -42 });
	});

	test("an unrotated child is placed exactly as before", () => {
		const g = autoLayout(
			createGroup([rect(16, 100)], { size: { width: 200, height: 100 } }),
			{ direction: "column", align: "end" },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[0].pos).toEqual({ x: 184, y: 0 });
		expect(out.children[0].size).toEqual({ width: 16, height: 100 });
	});

	test("a turned nested auto-layout still hugs its own content", () => {
		// A vertical stack of two 10-tall rows, turned on its side: its own box
		// hugs to 60 tall, so the parent column reserves 60 wide × 40 tall.
		const inner = autoLayout(
			createGroup([rect(40, 25), rect(40, 25)], {
				size: { width: 40, height: 0 },
				rotation: 90,
				layoutChild: { width: 40, height: "hug" },
			}),
			{ direction: "column", gap: 10 },
		);
		const g = autoLayout(
			createGroup([inner, rect(200, 20)], {
				size: { width: 200, height: 300 },
			}),
			{ direction: "column", gap: 0 },
		);
		const out = asGroup(resolveLayout(g, { measure }));
		expect(out.children[0].size).toEqual({ width: 40, height: 60 });
		// Footprint of a 40×60 box turned 90° is 60×40, so the next row is at 40.
		expect(out.children[1].pos).toEqual({ x: 0, y: 40 });
	});
});

describe("resolveLayout — nested hug groups", () => {
	// Each level hugs a text and the next level, alternating direction.
	function nest(depth: number): GroupNode {
		let node: Node = createText({ text: "leaf", font: FONT });
		for (let i = 0; i < depth; i++) {
			node = autoLayout(
				createGroup(
					[
						createText({
							text: `level ${i}`,
							font: FONT,
							layoutChild: { width: "hug", height: "hug" },
						}),
						node,
					],
					{ layoutChild: { width: "hug", height: "hug" } },
				),
				{ direction: i % 2 === 0 ? "row" : "column", gap: 4, padding: 2 },
			);
		}
		return autoLayout(
			createGroup([node], {
				pos: { x: 0, y: 0 },
				size: { width: 1000, height: 1000 },
			}),
			{ direction: "column" },
		);
	}

	function countedMeasure(): { fn: MeasureText; calls: () => number } {
		let n = 0;
		return {
			fn: (text, font, maxWidth) => {
				n++;
				return measure(text, font, maxWidth);
			},
			calls: () => n,
		};
	}

	test("layout of an 8-deep hug nest", () => {
		const out = asGroup(resolveLayout(nest(8), { measure }));
		let g = asGroup(out.children[0]);
		expect(g.size).toEqual({ width: 328, height: 98 });
		for (let i = 0; i < 7; i++) g = asGroup(g.children[1]);
		expect(g.pos).toEqual({ x: 236, y: 70 });
		expect(g.size).toEqual({ width: 78, height: 14 });
		expect(g.children[1].pos).toEqual({ x: 312, y: 72 });
	});

	test("text measurement grows linearly with depth", () => {
		const counts = [6, 7, 8].map((depth) => {
			const m = countedMeasure();
			resolveLayout(nest(depth), { measure: m.fn });
			return m.calls();
		});
		const step = counts[1] - counts[0];
		expect(counts[2] - counts[1]).toBe(step);
		expect(counts[2]).toBeLessThan(8 * 10);
	});
});
