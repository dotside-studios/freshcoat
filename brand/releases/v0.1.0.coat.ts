// The v0.1.0 banner. Word: prime.
//
// The first release, and the first coat. An Ulam spiral: count outward from
// the centre in a square spiral and mark every prime. The primes gather on
// diagonals no one could place by hand, and take the colours of the mark by
// their angle around the centre, where the count starts at 1, behind the
// lockup.

import type { Element } from "../../packages/coatfile/src/types";
import { defineTemplate } from "../../packages/coatfile/src/define";
import { banner, HEIGHT, WIDTH } from "./art";

const VERSION = "0.1.0";

// The stops of the mark's angular gradient.
const MARK = ["#019dda", "#2eaa8f", "#7bb353", "#f1b82b", "#f78e21", "#e75234", "#cc3b56", "#9f3d8c", "#5368b6", "#2883c9"];

const CELL = 5;
const GAP = 1;
const COLS = WIDTH / CELL;
const PANEL = { w: 640, h: 120 };

const CX = WIDTH / 2;
const CY = HEIGHT / 2;

const LIMIT = COLS * COLS;
const composite = new Uint8Array(LIMIT + 1);
for (let i = 2; i * i <= LIMIT; i++)
	if (!composite[i]) for (let j = i * i; j <= LIMIT; j += i) composite[j] = 1;

const inPanel = (x: number, y: number) => {
	const dx = Math.max(0, Math.abs(x - CX) - (PANEL.w - PANEL.h) / 2);
	return Math.hypot(dx, y - CY) < PANEL.h / 2 + CELL / 2;
};

// The mark's colour at `t`, wrapping, blended between neighbouring stops.
const hue = (t: number) => {
	const at = (((t % 1) + 1) % 1) * MARK.length;
	const i = Math.floor(at);
	const [a, b] = [MARK[i], MARK[(i + 1) % MARK.length]].map((hex) =>
		[1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16)),
	);
	return `#${a.map((v, n) => Math.round(v + (b[n] - v) * (at - i)).toString(16).padStart(2, "0")).join("")}`;
};

// The primes, bucketed by their angle around the centre, measured as if the
// strip were square so every colour of the mark gets an even share of it.
const BUCKETS = 60;
const paths: string[] = Array.from({ length: BUCKETS }, () => "");

// Walk the square spiral: right 1, up 1, left 2, down 2, right 3 and so on.
let col = 0;
let row = 0;
let n = 1;
const dirs = [
	[1, 0],
	[0, -1],
	[-1, 0],
	[0, 1],
];
const mark = () => {
	const x = CX + col * CELL;
	const y = CY + row * CELL;
	if (n < 2 || composite[n] || Math.abs(x - CX) > CX || Math.abs(y - CY) > CY || inPanel(x, y)) return;
	const size = CELL - GAP;
	// Clockwise from 12 o'clock, as the mark's sweep runs.
	const turn = (Math.atan2((x - CX) / WIDTH, -(y - CY) / HEIGHT) / (Math.PI * 2) + 1) % 1;
	paths[Math.floor(turn * BUCKETS)] += `M${x - size / 2} ${y - size / 2}h${size}v${size}h${-size}z`;
};
mark();
for (let leg = 0; n < LIMIT; leg++) {
	const [dx, dy] = dirs[leg % 4];
	const length = Math.floor(leg / 2) + 1;
	for (let i = 0; i < length && n < LIMIT; i++) {
		col += dx;
		row += dy;
		n++;
		mark();
	}
}

const art: Element[] = paths.map(
	(d, i) =>
		({
			id: `primes-${i}`,
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: WIDTH, height: HEIGHT },
			properties: { d, fill: hue((i + 0.5) / BUCKETS) },
		}) as Element,
);

export default defineTemplate(
	banner({
		version: VERSION,
		description: "The v0.1.0 release banner: prime, as an Ulam spiral.",
		background: "#ffffff",
		tone: "light",
		shade: false,
		art,
	}),
);
