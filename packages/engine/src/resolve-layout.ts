// resolveLayout — the flex (auto-layout) pass over the Node IR. Turns a tree
// whose group nodes carry a declarative `layout` into a plain absolute tree:
// concrete pos/size on every node, `layout`/`layoutChild` consumed. A group
// with no `layout` is returned as-is, recursing into its children in case a
// descendant is auto-layout. Leaves keep whatever pos/size they carry.
//
// The flex path is a full port of coatfile's auto-layout, retargeted from
// Element/FrameElement to the Node IR (ChildLayout fill/hug/fixed sizing +
// grow/min/max/absolute, FlexLayout direction/gap/crossGap/padding/align/justify/
// wrap). The grid path (a CSS-grid subset) is net-new — see resolveGrid below.
//
// The hard part is sizing: `hug` needs content measurement while `fill`/`grow`
// needs the parent's resolved free space, so each container is a two-pass —
// measure children's intrinsic sizes (bottom-up), then place + distribute
// leftover space (top-down). Text couples the axes (height depends on the width
// it wraps at), so cross sizes resolve before text is measured for the main axis.
//
// Coordinate model: child positions are ABSOLUTE. The painter's space is flat
// (drawGroup never translates), so each container folds its own pos into the
// placement origin.
//
// Rotation: a node's pos/size is always its UNROTATED box, and the painter turns
// it around that box's centre. So a rotated child claims a different amount of
// the flow than it measures — the axis-aligned bounding box of the turned box —
// while the box handed to it stays its own. Containers reserve the footprint and
// centre the child's own box inside it (see rotatedFootprint / measureChild).
//
// Scope: flex and a grid subset, because that is what a Figma export emits. This
// is not a CSS engine and is not on its way to becoming one — block and inline
// flow, floats, percentage units and min/max-content sizing are absent by
// decision, not by omission. Each additional layout case must be maintained
// here without an upstream implementation to inherit fixes from.
import type {
	ChildLayout,
	FlexLayout,
	GridLayout,
	GroupNode,
	MaskNode,
	Node,
	TrackSize,
} from "./node";
import type { MeasureText } from "./text-types";
import type { Size, Vec2 } from "./types";

export function resolveLayout(
	root: Node,
	opts: { measure: MeasureText },
): Node {
	return resolveNode(root, opts.measure);
}

function resolveNode(node: Node, measure: MeasureText): Node {
	if (node.kind === "mask") return resolveMask(node, measure);
	if (node.kind !== "group") return node;
	if (!node.layout) {
		// A layout-less group is a static container: its children's pos is
		// relative to it. Fold the group's own pos into them so the flattened
		// output is absolute (the painter's space; drawGroup never translates).
		return {
			...node,
			children: resolveChildren(
				node.children,
				node.pos ?? { x: 0, y: 0 },
				measure,
			),
		};
	}
	const pos: Vec2 = node.pos ?? { x: 0, y: 0 };
	const size: Size = node.size ?? { width: 0, height: 0 };
	return node.layout.type === "grid"
		? resolveGrid(node, node.layout, pos, size, measure)
		: resolveFlex(node, node.layout, pos, size, measure);
}

// A mask node is a static container: its mask + children are relative to it,
// folded to absolute (like a layout-less group).
function resolveMask(node: MaskNode, measure: MeasureText): MaskNode {
	const offset = node.pos ?? { x: 0, y: 0 };
	return {
		...node,
		mask: resolveChildren([node.mask], offset, measure)[0],
		children: resolveChildren(node.children, offset, measure),
	};
}

// ─────────────── axes ───────────────

type Axis = { main: (s: Size) => number; cross: (s: Size) => number };
const ROW_AXIS: Axis = { main: (s) => s.width, cross: (s) => s.height };
const COLUMN_AXIS: Axis = { main: (s) => s.height, cross: (s) => s.width };

// ─────────────── rotation ───────────────

/** The axis-aligned box a turned node covers — what its container has to make
 *  room for. Identity for an unrotated node, so nothing changes for one. */
export function rotatedFootprint(
	size: Size,
	rotation: number | undefined,
): Size {
	if (!rotation) return size;
	const rad = (rotation * Math.PI) / 180;
	// Math.cos(π/2) is 6e-17, not 0, and that dust survives into every downstream
	// coordinate. A right angle is the overwhelmingly common case here (a card's
	// vertical label), so snap the axis it zeroes.
	const c = snapZero(Math.abs(Math.cos(rad)));
	const s = snapZero(Math.abs(Math.sin(rad)));
	return {
		width: size.width * c + size.height * s,
		height: size.width * s + size.height * c,
	};
}

const snapZero = (n: number): number => (n < 1e-9 ? 0 : n);

const isRotated = (node: Node): boolean => (node.rotation ?? 0) !== 0;

// A turned child's own box, resolved in ITS OWN axes. The container's axes are
// no longer the child's, so `layoutChild.width`/`height` — which describe the
// node's own sides — can't be read through the container's main/cross mapping,
// and `fill`/`grow`/`stretch` have nothing to mean (there is no container axis
// left to fill). Those fall back to the authored size; `hug` and fixed numbers
// still resolve, which is what a turned label or a turned nested stack needs.
function ownSizeOf(child: Node, measure: MeasureText): Size {
	const lc: ChildLayout = child.layoutChild ?? {};
	const base = child.size ?? { width: 0, height: 0 };
	const fixed = (mode: ChildLayout["width"], fallback: number) =>
		typeof mode === "number" ? mode : fallback;

	if (child.kind === "text") {
		const width =
			lc.width === "hug"
				? measure(textOf(child), child.font, null).width
				: fixed(lc.width, base.width);
		const height =
			lc.height === "hug"
				? capLines(measure(textOf(child), child.font, width).height, child)
				: fixed(lc.height, base.height);
		return { width, height };
	}
	if (child.kind === "group" && child.layout?.type === "flex") {
		// resolveFlex hugs exactly the axes layoutChild marks `hug`, so hand it the
		// other two and read the natural box back off the result.
		const probe: Size = {
			width: lc.width === "hug" ? 0 : fixed(lc.width, base.width),
			height: lc.height === "hug" ? 0 : fixed(lc.height, base.height),
		};
		const resolved = resolveFlex(
			child,
			child.layout,
			{ x: 0, y: 0 },
			probe,
			measure,
		);
		return resolved.size ?? base;
	}
	return {
		width: fixed(lc.width, base.width),
		height: fixed(lc.height, base.height),
	};
}

type Padding = { top: number; right: number; bottom: number; left: number };
function normalizePad(p: FlexLayout["padding"]): Padding {
	if (p === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
	if (typeof p === "number") return { top: p, right: p, bottom: p, left: p };
	const [top, right, bottom, left] = p;
	return { top, right, bottom, left };
}

// ─────────────── the container two-pass ───────────────

function resolveFlex(
	group: GroupNode,
	layout: FlexLayout,
	pos: Vec2,
	size: Size,
	measure: MeasureText,
): GroupNode {
	const isRow = layout.direction === "row";
	const axis = isRow ? ROW_AXIS : COLUMN_AXIS;
	const gap = layout.gap ?? 0;
	const crossGap = layout.crossGap ?? gap;
	const p = normalizePad(layout.padding);

	const mainPadTotal = isRow ? p.left + p.right : p.top + p.bottom;
	const crossPadTotal = isRow ? p.top + p.bottom : p.left + p.right;
	const contentMain = axis.main(size) - mainPadTotal;
	const contentCross = axis.cross(size) - crossPadTotal;
	// Absolute placement origin: container pos + leading padding.
	const originMain = isRow ? pos.x : pos.y;
	const originCross = isRow ? pos.y : pos.x;
	const mainStart = originMain + (isRow ? p.left : p.top);
	const crossStart = originCross + (isRow ? p.top : p.left);

	const flow = group.children.filter((c) => c.layoutChild?.absolute !== true);
	const absolute = group.children.filter(
		(c) => c.layoutChild?.absolute === true,
	);

	// Pass 1 — measure each flow child's intrinsic main/cross + grow + clamps.
	const measured = flow.map((child) =>
		measureChild(child, isRow, contentCross, measure),
	);

	// Grow: distribute leftover main-axis space by weight, honoring per-child max.
	const totalMain =
		measured.reduce((s, m) => s + m.main, 0) +
		gap * Math.max(0, measured.length - 1);
	const free = contentMain - totalMain;
	const growable = measured.filter((m) => m.grow > 0);
	if (growable.length > 0 && free > 0) {
		let remaining = free;
		const open = new Set(growable);
		while (open.size > 0 && remaining > 0.001) {
			const share = remaining / open.size;
			let consumed = 0;
			let pinned = false;
			for (const m of [...open]) {
				const room = m.maxMain - m.main;
				const take = Math.min(share, room);
				m.main += take;
				consumed += take;
				if (take >= room - 0.001) {
					open.delete(m);
					pinned = true;
				}
			}
			remaining -= consumed;
			if (!pinned && consumed <= 0.001) break;
		}
	}

	const grownTotal =
		measured.reduce((s, m) => s + m.main, 0) +
		gap * Math.max(0, measured.length - 1);
	const freeAfterGrow = contentMain - grownTotal;

	// Wrap into lines (single line when wrap is off).
	const lines: Measured[][] = [];
	if (layout.wrap) {
		let line: Measured[] = [];
		let used = 0;
		for (const m of measured) {
			const add = (line.length > 0 ? gap : 0) + m.main;
			if (line.length > 0 && used + add > contentMain) {
				lines.push(line);
				line = [m];
				used = m.main;
			} else {
				line.push(m);
				used += add;
			}
		}
		if (line.length > 0) lines.push(line);
	} else {
		lines.push(measured);
	}

	// Pass 2 — place. Justify along main, align along cross, per line.
	const placed: Node[] = [];
	let lineCrossCursor = crossStart;
	for (const line of lines) {
		const single = lines.length === 1;
		const lineMain =
			line.reduce((s, m) => s + m.main, 0) + gap * Math.max(0, line.length - 1);
		const lineFree = single ? freeAfterGrow : contentMain - lineMain;
		const dist = distributeMain(
			layout.justify ?? "start",
			lineFree,
			gap,
			line.length,
		);
		const lineCross = line.reduce((mx, m) => Math.max(mx, m.cross), 0);
		let cursor = mainStart + dist.leading;
		for (const m of line) {
			const alignMode =
				m.child.layoutChild?.alignSelf ?? layout.align ?? "start";
			const crossExtent = single ? contentCross : lineCross;
			const crossOff = alignCross(alignMode, crossExtent, m.cross);
			const mainCoord = cursor;
			const crossCoord = lineCrossCursor + crossOff;
			const footprint: Vec2 = isRow
				? { x: mainCoord, y: crossCoord }
				: { x: crossCoord, y: mainCoord };
			const footSize: Size = isRow
				? { width: m.main, height: m.cross }
				: { width: m.cross, height: m.main };
			// The flow placed the FOOTPRINT. A turned child's own box is centred in
			// it, because that is the point the painter rotates around. Identical to
			// the footprint when nothing is turned.
			const childSize: Size = m.own ?? footSize;
			const abs: Vec2 = {
				x: footprint.x + (footSize.width - childSize.width) / 2,
				y: footprint.y + (footSize.height - childSize.height) / 2,
			};
			cursor += m.main + dist.between;
			placed.push(placeChild(m.child, abs, childSize, measure));
		}
		lineCrossCursor += lineCross + crossGap;
	}

	// Absolute children: placed at container origin + their frame-relative pos,
	// out of flow. Nested layout groups still resolve.
	const placedAbsolute: Node[] = absolute.map((c) => {
		const local = c.pos ?? { x: 0, y: 0 };
		const abs: Vec2 = { x: pos.x + local.x, y: pos.y + local.y };
		return placeChild(c, abs, c.size ?? { width: 0, height: 0 }, measure);
	});

	// Hug axes grow to enclose content; fixed/fill axes keep the handed-in size.
	const maxCross = measured.reduce((mx, m) => Math.max(mx, m.cross), 0);
	let naturalMain = grownTotal + mainPadTotal;
	let naturalCross = maxCross + crossPadTotal;
	if (layout.wrap) {
		const lineMains = lines.map(
			(line) =>
				line.reduce((s, m) => s + m.main, 0) +
				gap * Math.max(0, line.length - 1),
		);
		const stackedCross =
			lines.reduce(
				(s, line) => s + line.reduce((mx, m) => Math.max(mx, m.cross), 0),
				0,
			) +
			crossGap * Math.max(0, lines.length - 1);
		naturalMain = Math.max(0, ...lineMains) + mainPadTotal;
		naturalCross = stackedCross + crossPadTotal;
	}
	const hugsWidth = group.layoutChild?.width === "hug";
	const hugsHeight = group.layoutChild?.height === "hug";
	const outSize: Size = {
		width: hugsWidth ? (isRow ? naturalMain : naturalCross) : size.width,
		height: hugsHeight ? (isRow ? naturalCross : naturalMain) : size.height,
	};

	return {
		...stripChild(group),
		pos,
		size: outSize,
		layout: undefined,
		children: [...placed, ...placedAbsolute],
	};
}

function placeChild(
	child: Node,
	abs: Vec2,
	size: Size,
	measure: MeasureText,
): Node {
	if (child.kind === "mask") {
		return {
			...stripChild(child),
			pos: abs,
			size,
			mask: resolveChildren([child.mask], abs, measure)[0],
			children: resolveChildren(child.children, abs, measure),
		};
	}
	if (child.kind === "group" && child.layout) {
		return child.layout.type === "grid"
			? resolveGrid(child, child.layout, abs, size, measure)
			: resolveFlex(child, child.layout, abs, size, measure);
	}
	if (child.kind === "group") {
		// Layout-less group placed by a layout parent: fold its resolved absolute
		// pos into its (relative) children so the whole subtree stays absolute.
		return {
			...stripChild(child),
			pos: abs,
			size,
			children: resolveChildren(child.children, abs, measure),
		};
	}
	return { ...stripChild(child), pos: abs, size };
}

// Resolve each child after folding `offset` into its (parent-relative) pos, so
// a static container's subtree flattens to absolute coordinates.
function resolveChildren(
	children: Node[],
	offset: Vec2,
	measure: MeasureText,
): Node[] {
	return children.map((c) => {
		const local = c.pos ?? { x: 0, y: 0 };
		const moved = {
			...c,
			pos: { x: offset.x + local.x, y: offset.y + local.y },
		};
		return resolveNode(moved, measure);
	});
}

// ─────────────── grid (CSS-grid subset) ───────────────
//
// Tracks size as fixed px / "auto" (content) / "Nfr" (fraction of leftover).
// Items place by explicit 1-based `column`/`row` (a number = one track, a
// [start,end] pair = inclusive span) or auto-flow row-major into free cells;
// implicit rows are added ("auto"). An item fills its cell unless width/height
// says `hug` (intrinsic) or a fixed number. fr tracks need a definite container
// size on that axis (a hug container falls back to content/fixed tracks).

type Placement = { col: number; colSpan: number; row: number; rowSpan: number };

function normalizeGap(
	gap: GridLayout["gap"],
): [rowGap: number, colGap: number] {
	if (gap === undefined) return [0, 0];
	if (typeof gap === "number") return [gap, gap];
	return gap;
}

// 1-based number/[start,end] (inclusive) → 0-based line + span. Undefined = auto.
function trackSpan(v: number | [number, number] | undefined): {
	line: number | null;
	span: number;
} {
	if (v === undefined) return { line: null, span: 1 };
	if (typeof v === "number") return { line: v - 1, span: 1 };
	const [s, e] = v;
	return { line: s - 1, span: Math.max(1, e - s + 1) };
}

function resolveGrid(
	group: GroupNode,
	layout: GridLayout,
	pos: Vec2,
	size: Size,
	measure: MeasureText,
): GroupNode {
	const p = normalizePad(layout.padding);
	const [rowGap, colGap] = normalizeGap(layout.gap);
	const contentLeft = pos.x + p.left;
	const contentTop = pos.y + p.top;
	const contentWidth = size.width - p.left - p.right;
	const contentHeight = size.height - p.top - p.bottom;

	const colDefs = layout.columns;
	const nCols = colDefs.length;

	const flow = group.children.filter((c) => c.layoutChild?.absolute !== true);
	const absolute = group.children.filter(
		(c) => c.layoutChild?.absolute === true,
	);

	const placements = placeGrid(flow, nCols);
	const maxRow = placements.reduce(
		(m, pl) => Math.max(m, pl.row + pl.rowSpan),
		0,
	);
	const explicitRows = layout.rows ?? [];
	const nRows = Math.max(maxRow, explicitRows.length);
	const rowDefs: TrackSize[] = Array.from(
		{ length: nRows },
		(_, i) => explicitRows[i] ?? "auto",
	);

	// Column tracks: auto columns size to the widest single-column item.
	const colAuto = new Array(nCols).fill(0);
	placements.forEach((pl, i) => {
		if (pl.colSpan === 1) {
			colAuto[pl.col] = Math.max(
				colAuto[pl.col],
				gridIntrinsicWidth(flow[i], measure),
			);
		}
	});
	const colSizes = resolveTracks(colDefs, contentWidth, colGap, colAuto);
	const colOffsets = trackOffsets(colSizes, colGap, contentLeft);

	// Row tracks: auto rows size to the tallest single-row item measured at its
	// (now known) cell width — the width→height coupling, grid-side.
	const rowAuto = new Array(nRows).fill(0);
	placements.forEach((pl, i) => {
		if (pl.rowSpan === 1) {
			const cellW = spanExtent(colSizes, pl.col, pl.colSpan, colGap);
			rowAuto[pl.row] = Math.max(
				rowAuto[pl.row],
				gridIntrinsicHeight(flow[i], cellW, measure),
			);
		}
	});
	const rowSizes = resolveTracks(rowDefs, contentHeight, rowGap, rowAuto);
	const rowOffsets = trackOffsets(rowSizes, rowGap, contentTop);

	const placed: Node[] = flow.map((child, i) => {
		const pl = placements[i];
		const cellX = colOffsets[pl.col] ?? contentLeft;
		const cellY = rowOffsets[pl.row] ?? contentTop;
		const cellW = spanExtent(colSizes, pl.col, pl.colSpan, colGap);
		const cellH = spanExtent(rowSizes, pl.row, pl.rowSpan, rowGap);
		// A turned item keeps its own box — there is no cell axis left for it to
		// fill — and sits centred on the cell, the point the painter turns it
		// around. An upright item is sized and placed exactly as before.
		if (isRotated(child)) {
			const own = ownSizeOf(child, measure);
			const foot = rotatedFootprint(own, child.rotation);
			return placeChild(
				child,
				{
					x: cellX + (cellW - foot.width) / 2 + (foot.width - own.width) / 2,
					y: cellY + (cellH - foot.height) / 2 + (foot.height - own.height) / 2,
				},
				own,
				measure,
			);
		}
		const lc = child.layoutChild ?? {};
		const w = gridItemSize(lc.width, cellW, () =>
			gridIntrinsicWidth(child, measure),
		);
		const h = gridItemSize(lc.height, cellH, () =>
			gridIntrinsicHeight(child, w, measure),
		);
		return placeChild(
			child,
			{ x: cellX, y: cellY },
			{ width: w, height: h },
			measure,
		);
	});

	const placedAbsolute: Node[] = absolute.map((c) => {
		const local = c.pos ?? { x: 0, y: 0 };
		const abs: Vec2 = { x: pos.x + local.x, y: pos.y + local.y };
		return placeChild(c, abs, c.size ?? { width: 0, height: 0 }, measure);
	});

	const hugsWidth = group.layoutChild?.width === "hug";
	const hugsHeight = group.layoutChild?.height === "hug";
	const naturalWidth =
		colSizes.reduce((s, x) => s + x, 0) +
		colGap * Math.max(0, nCols - 1) +
		p.left +
		p.right;
	const naturalHeight =
		rowSizes.reduce((s, x) => s + x, 0) +
		rowGap * Math.max(0, nRows - 1) +
		p.top +
		p.bottom;
	const outSize: Size = {
		width: hugsWidth ? naturalWidth : size.width,
		height: hugsHeight ? naturalHeight : size.height,
	};

	return {
		...stripChild(group),
		pos,
		size: outSize,
		layout: undefined,
		children: [...placed, ...placedAbsolute],
	};
}

function placeGrid(children: Node[], nCols: number): Placement[] {
	const occ = new Set<string>();
	const key = (r: number, c: number) => `${r},${c}`;
	const fits = (r: number, c: number, rowSpan: number, colSpan: number) => {
		if (c < 0 || c + colSpan > nCols) return false;
		for (let dr = 0; dr < rowSpan; dr++)
			for (let dc = 0; dc < colSpan; dc++)
				if (occ.has(key(r + dr, c + dc))) return false;
		return true;
	};
	const mark = (r: number, c: number, rowSpan: number, colSpan: number) => {
		for (let dr = 0; dr < rowSpan; dr++)
			for (let dc = 0; dc < colSpan; dc++) occ.add(key(r + dr, c + dc));
	};

	const out: Placement[] = [];
	let curR = 0;
	let curC = 0;
	for (const child of children) {
		const lc = child.layoutChild ?? {};
		const cp = trackSpan(lc.column);
		const rp = trackSpan(lc.row);
		const colSpan = Math.min(cp.span, nCols);
		const rowSpan = rp.span;
		let col = cp.line;
		let row = rp.line;

		if (col !== null && row !== null) {
			// exact placement
		} else if (col !== null) {
			let r = 0;
			while (!fits(r, col, rowSpan, colSpan)) r++;
			row = r;
		} else if (row !== null) {
			let c = 0;
			while (!fits(row, c, rowSpan, colSpan)) c++;
			col = c;
		} else {
			let r = curR;
			let c = curC;
			while (!fits(r, c, rowSpan, colSpan)) {
				c++;
				if (c + colSpan > nCols) {
					c = 0;
					r++;
				}
			}
			row = r;
			col = c;
			curR = r;
			curC = c + colSpan;
			if (curC >= nCols) {
				curC = 0;
				curR++;
			}
		}
		mark(row, col, rowSpan, colSpan);
		out.push({ col, colSpan, row, rowSpan });
	}
	return out;
}

function resolveTracks(
	defs: TrackSize[],
	available: number,
	gap: number,
	autoSizes: number[],
): number[] {
	const n = defs.length;
	const sizes = new Array(n).fill(0);
	let used = 0;
	let frTotal = 0;
	for (let i = 0; i < n; i++) {
		const d = defs[i];
		if (typeof d === "number") {
			sizes[i] = d;
			used += d;
		} else if (d === "auto") {
			sizes[i] = autoSizes[i] ?? 0;
			used += sizes[i];
		} else {
			frTotal += parseFloat(d); // "Nfr"
		}
	}
	const leftover = Math.max(0, available - gap * Math.max(0, n - 1) - used);
	if (frTotal > 0) {
		for (let i = 0; i < n; i++) {
			const d = defs[i];
			if (typeof d === "string" && d.endsWith("fr")) {
				sizes[i] = (parseFloat(d) / frTotal) * leftover;
			}
		}
	}
	return sizes;
}

function trackOffsets(sizes: number[], gap: number, start: number): number[] {
	const offs: number[] = [];
	let cur = start;
	for (const s of sizes) {
		offs.push(cur);
		cur += s + gap;
	}
	return offs;
}

function spanExtent(
	sizes: number[],
	start: number,
	span: number,
	gap: number,
): number {
	let total = gap * Math.max(0, span - 1);
	for (let i = 0; i < span; i++) total += sizes[start + i] ?? 0;
	return total;
}

function gridItemSize(
	mode: ChildLayout["width"],
	cell: number,
	intrinsic: () => number,
): number {
	if (mode === "hug") return intrinsic();
	if (typeof mode === "number") return mode;
	return cell; // "fill" or unset → stretch to the cell
}

// Auto tracks size to the space an item COVERS, so a turned item contributes
// its footprint — the same rule the flex flow uses.
function gridIntrinsicWidth(child: Node, measure: MeasureText): number {
	if (isRotated(child))
		return rotatedFootprint(ownSizeOf(child, measure), child.rotation).width;
	if (child.kind === "text")
		return measure(textOf(child), child.font, null).width;
	return child.size?.width ?? 0;
}

function gridIntrinsicHeight(
	child: Node,
	width: number,
	measure: MeasureText,
): number {
	if (isRotated(child))
		return rotatedFootprint(ownSizeOf(child, measure), child.rotation).height;
	if (child.kind === "text")
		return measure(textOf(child), child.font, width).height;
	return child.size?.height ?? 0;
}

// ─────────────── measurement ───────────────

type Measured = {
	child: Node;
	// Extents along the CONTAINER's axes — the footprint the flow reserves. For
	// an unrotated child that is the child's own box; for a turned one it is the
	// bounding box of the turn (`own` then holds the box itself).
	main: number;
	cross: number;
	grow: number;
	maxMain: number;
	/** Set only for a rotated child, whose own box is not its footprint. */
	own?: Size;
};

function measureChild(
	child: Node,
	isRow: boolean,
	containerCross: number,
	measure: MeasureText,
): Measured {
	if (isRotated(child)) {
		// A turned child keeps its own box and only claims a different amount of
		// the flow. It never grows: growing is a main-axis notion of the
		// container's, and the container's main axis is not one of this child's.
		const own = ownSizeOf(child, measure);
		const foot = rotatedFootprint(own, child.rotation);
		return {
			child,
			main: axisMain(foot, isRow),
			cross: axisCross(foot, isRow),
			grow: 0,
			maxMain: Number.POSITIVE_INFINITY,
			own,
		};
	}
	const lc: ChildLayout = child.layoutChild ?? {};
	// Cross axis first — its size is what text (main axis) wraps against.
	const crossMode = isRow ? lc.height : lc.width;
	let cross: number;
	if (crossMode === "fill" || lc.alignSelf === "stretch") {
		cross = containerCross;
	} else if (crossMode === "hug") {
		cross = intrinsicCross(child, isRow, measure);
	} else if (typeof crossMode === "number") {
		cross = crossMode;
	} else {
		cross = axisCross(child.size, isRow);
	}

	// Main axis. `fill`/fixed use the base size (main-axis fill grows via the
	// grow pass); `hug` measures content.
	const mainMode = isRow ? lc.width : lc.height;
	let main: number;
	if (mainMode === "hug") {
		main = intrinsicMain(child, isRow, cross, measure);
	} else if (typeof mainMode === "number") {
		main = mainMode;
	} else {
		main = axisMain(child.size, isRow);
	}

	const minMain = isRow ? (lc.min?.width ?? 0) : (lc.min?.height ?? 0);
	const maxMain = isRow
		? (lc.max?.width ?? Number.POSITIVE_INFINITY)
		: (lc.max?.height ?? Number.POSITIVE_INFINITY);
	main = Math.min(Math.max(main, minMain), maxMain);

	return { child, main, cross, grow: lc.grow ?? 0, maxMain };
}

function intrinsicCross(
	child: Node,
	isRow: boolean,
	measure: MeasureText,
): number {
	if (child.kind === "text") {
		const m = measure(textOf(child), child.font, null);
		return isRow ? m.height : m.width;
	}
	if (child.kind === "group" && child.layout?.type === "flex") {
		// Resolve at the child's fixed width (in a row) so a fixed-width column
		// measures its height at that width instead of collapsing to 0 — else
		// wrapping text inside it wraps to nothing and reports a runaway cross size.
		// A hug/fill child has no fixed number here, so it still probes at 0 (natural).
		const fixedW =
			(typeof child.layoutChild?.width === "number"
				? child.layoutChild.width
				: child.size?.width) ?? 0;
		const probe: Size = isRow
			? { width: fixedW, height: child.size?.height ?? 0 }
			: { width: child.size?.width ?? 0, height: 0 };
		const resolved = resolveFlex(
			child,
			child.layout,
			{ x: 0, y: 0 },
			probe,
			measure,
		);
		return axisCross(resolved.size, isRow);
	}
	return axisCross(child.size, isRow);
}

function intrinsicMain(
	child: Node,
	isRow: boolean,
	cross: number,
	measure: MeasureText,
): number {
	if (child.kind === "text") {
		const maxWidth = isRow ? null : cross;
		const m = measure(textOf(child), child.font, maxWidth);
		return isRow ? m.width : capLines(m.height, child);
	}
	if (child.kind === "group" && child.layout?.type === "flex") {
		const probe: Size = isRow
			? { width: 0, height: cross }
			: { width: cross, height: 0 };
		const resolved = resolveFlex(
			child,
			child.layout,
			{ x: 0, y: 0 },
			probe,
			measure,
		);
		return axisMain(resolved.size, isRow);
	}
	return axisMain(child.size, isRow);
}

// Cap a measured text height at its `maxLines` (CSS line-clamp): the text bakes
// to at most maxLines, so its box must not reserve space for the clipped
// remainder — otherwise a long, clamped paragraph leaves a gap below it.
function capLines(
	height: number,
	node: Extract<Node, { kind: "text" }>,
): number {
	if (!node.maxLines || node.maxLines <= 0) return height;
	return Math.min(
		height,
		node.maxLines * node.font.size * node.font.lineHeight,
	);
}

function textOf(node: Extract<Node, { kind: "text" }>): string {
	if (node.spans && node.spans.length > 0)
		return node.spans.map((s) => s.text).join("");
	return node.text ?? "";
}

// ─────────────── small helpers ───────────────

function axisMain(size: Size | undefined, isRow: boolean): number {
	const s = size ?? { width: 0, height: 0 };
	return isRow ? s.width : s.height;
}
function axisCross(size: Size | undefined, isRow: boolean): number {
	const s = size ?? { width: 0, height: 0 };
	return isRow ? s.height : s.width;
}

function stripChild<T extends Node>(node: T): T {
	if (node.layoutChild === undefined) return node;
	const { layoutChild: _omit, ...rest } = node;
	return rest as T;
}

function distributeMain(
	justify: NonNullable<FlexLayout["justify"]>,
	free: number,
	gap: number,
	n: number,
): { leading: number; between: number } {
	if (free <= 0 || n === 0) return { leading: 0, between: gap };
	switch (justify) {
		case "center":
			return { leading: free / 2, between: gap };
		case "end":
			return { leading: free, between: gap };
		case "space-between":
			return { leading: 0, between: gap + (n > 1 ? free / (n - 1) : 0) };
		case "space-around": {
			const unit = free / n;
			return { leading: unit / 2, between: gap + unit };
		}
		case "space-evenly": {
			const unit = free / (n + 1);
			return { leading: unit, between: gap + unit };
		}
		default:
			return { leading: 0, between: gap };
	}
}

function alignCross(
	align: NonNullable<FlexLayout["align"]>,
	containerCross: number,
	childCross: number,
): number {
	if (align === "center") return (containerCross - childCross) / 2;
	if (align === "end") return containerCross - childCross;
	return 0; // start / stretch (child already filled cross in measure)
}
