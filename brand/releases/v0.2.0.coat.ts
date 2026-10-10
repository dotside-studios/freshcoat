// The v0.2.0 banner. Word: arrange.
//
// Truchet tiles: one tile of paired quarter arcs, turned one of two ways by
// the seed in every cell of a grid, so the arcs join into meandering paths.
// 0.2 brought grids, SVG and typography: new ways to lay things out.

import type { Element } from "../../packages/coatfile/src/types";
import { defineTemplate } from "../../packages/coatfile/src/define";
import { banner, HEIGHT, random, WIDTH } from "./art";

const VERSION = "0.2.0";
const rng = random(`freshcoat v${VERSION}`);

const GROUND = "#14513f";
const INK = "#86d6ad";

const CELL = 40;
const RADII = [12, 28];
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const PANEL = { w: 680, h: 120 };

const clearOfPanel = (x: number, y: number) =>
	x + CELL <= CX - PANEL.w / 2 || x >= CX + PANEL.w / 2 || y + CELL <= CY - PANEL.h / 2 || y >= CY + PANEL.h / 2;

// Quarter arcs around two opposite corners of a cell.
const arcs = (x: number, y: number, flip: boolean) =>
	RADII.map((r) =>
		flip
			? `M${x + r} ${y}A${r} ${r} 0 0 1 ${x} ${y + r}M${x + CELL - r} ${y + CELL}A${r} ${r} 0 0 1 ${x + CELL} ${y + CELL - r}`
			: `M${x + CELL - r} ${y}A${r} ${r} 0 0 0 ${x + CELL} ${y + r}M${x + r} ${y + CELL}A${r} ${r} 0 0 0 ${x} ${y + CELL - r}`,
	).join("");

let d = "";
for (let y = 0; y < HEIGHT; y += CELL)
	for (let x = 0; x < WIDTH; x += CELL) {
		const flip = rng() < 0.5;
		if (clearOfPanel(x, y)) d += arcs(x, y, flip);
	}

const art: Element[] = [
	{
		id: "tiles",
		type: "vector",
		pos: { x: 0, y: 0 },
		size: { width: WIDTH, height: HEIGHT },
		properties: { d, stroke: { color: INK, width: 7, cap: "butt" } },
	} as Element,
];

export default defineTemplate(
	banner({
		version: VERSION,
		description: "The v0.2.0 release banner: arrange, as Truchet tiles.",
		background: GROUND,
		tone: "dark",
		shade: false,
		art,
	}),
);
