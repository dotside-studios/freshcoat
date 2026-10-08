import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import {
	createEllipse,
	createGroup,
	createImage,
	createPath,
	createRect,
	type Node,
} from "../src/node";
import type { GradientFill, Stroke } from "../src/types";
import { validateCommands } from "../src/validate-commands";
import { renderSceneToPng } from "./helpers/headless";

const W = 100;
const H = 100;
const WHITE = [255, 255, 255];
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const pos = { x: 20, y: 30 };
const size = { width: 60, height: 40 };
const white = [{ kind: "solid" as const, color: "#ffffff" }];
const stops = [
	{ offset: 0, color: "#ff0000" },
	{ offset: 0.5, color: "#00ff00" },
	{ offset: 1, color: "#0000ff" },
];

const GRADIENTS: Record<GradientFill["kind"], GradientFill> = {
	linear: { kind: "linear", from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, stops },
	radial: {
		kind: "radial",
		center: { x: 0.3, y: 0.4 },
		radius: 0.6,
		radiusY: 0.3,
		rotation: 20,
		stops,
	},
	angular: { kind: "angular", center: { x: 0.3, y: 0.6 }, rotation: 40, stops },
};

const KINDS = Object.keys(GRADIENTS) as GradientFill["kind"][];

type Shape = "rect" | "path" | "viewBox" | "ellipse" | "image";

const SHAPES: Record<Shape, (stroke: Stroke) => Node> = {
	rect: (stroke) => createRect({ pos, size, stroke }),
	path: (stroke) =>
		createPath({ pos, size, d: "M0 0H60V40H0Z", stroke }),
	viewBox: (stroke) =>
		createPath({
			pos,
			size,
			d: "M0 0H30V20H0Z",
			viewBox: { width: 30, height: 20 },
			stroke: { ...stroke, width: stroke.width / 2 },
		}),
	ellipse: (stroke) => createEllipse({ pos, size, stroke }),
	image: (stroke) => createImage({ pos, size, src: "missing", fit: "cover", stroke }),
};

const SHAPE_NAMES = Object.keys(SHAPES) as Shape[];

const gradientStroke = (
	gradient: GradientFill,
	extra: Partial<Stroke> = {},
): Stroke => ({ color: "#000000", gradient, width: 8, ...extra });

let ck: unknown;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

async function paint(node: Node) {
	const ground = createRect({ pos: { x: 0, y: 0 }, size: { width: W, height: H }, fills: white });
	const { bytes } = await renderSceneToPng(createGroup([ground, node]), {
		width: W,
		height: H,
		ck,
	});
	const pixels = decodePixels(ck, bytes);
	if (!pixels) throw new Error("decode failed");
	return (x: number, y: number) => {
		const i = (y * pixels.width + x) * 4;
		return [...pixels.data.subarray(i, i + 3)];
	};
}

// What a fill with the same gradient paints over the same box.
const reference = (gradient: GradientFill) =>
	paint(createRect({ pos, size, fills: [gradient] }));

const close = (a: number[], b: number[], tolerance = 2) =>
	a.every((v, i) => Math.abs(v - (b[i] as number)) <= tolerance);

// Pixels two to five in from the middle of each side, wholly inside an 8 wide
// inside stroke of every shape.
function insideSamples(): [number, number][] {
	const out: [number, number][] = [];
	const cx = pos.x + size.width / 2;
	const cy = pos.y + size.height / 2;
	for (const d of [2, 3, 4, 5]) {
		out.push([pos.x + d, cy], [pos.x + size.width - 1 - d, cy]);
		out.push([cx, pos.y + d], [cx, pos.y + size.height - 1 - d]);
		out.push([cx - 15, pos.y + d], [cx + 15, pos.y + size.height - 1 - d]);
	}
	return out.filter(([x, y]) => x !== cx - 15 || y < pos.y + 6);
}

describe("gradient strokes", () => {
	describe.each(KINDS)("%s", (kind) => {
		const gradient = GRADIENTS[kind];

		test.each(SHAPE_NAMES)(
			"an inside stroke on a %s paints the gradient a fill would",
			async (shape) => {
				const want = await reference(gradient);
				const at = await paint(
					SHAPES[shape](gradientStroke(gradient, { align: "inside" })),
				);
				const samples =
					shape === "ellipse"
						? insideSamples().filter(
								([x, y]) => x === pos.x + size.width / 2 || y === pos.y + size.height / 2,
							)
						: insideSamples();
				for (const [x, y] of samples) {
					const got = at(x, y);
					if (!close(got, want(x, y)))
						throw new Error(`${shape} at ${x},${y}: ${got} vs ${want(x, y)}`);
				}
				if (shape !== "image") expect(at(50, 50)).toEqual(WHITE);
			},
		);

		test.each(["center", "outside"] as const)(
			"a %s stroke paints the gradient inside the box too",
			async (align) => {
				const want = await reference(gradient);
				for (const shape of ["rect", "path", "ellipse"] as const) {
					const at = await paint(SHAPES[shape](gradientStroke(gradient, { align })));
					const x = align === "center" ? pos.x + 1 : pos.x - 3;
					const y = pos.y + size.height / 2;
					if (align === "center") expect(close(at(x, y), want(x, y))).toBe(true);
					else expect(at(x, y)).not.toEqual(WHITE);
					expect(at(50, 50)).toEqual(WHITE);
				}
			},
		);
	});

	test("an outside linear stroke clamps to its end stops beyond the box", async () => {
		for (const shape of ["rect", "path", "ellipse", "image"] as const) {
			const at = await paint(
				SHAPES[shape](gradientStroke(GRADIENTS.linear, { align: "outside" })),
			);
			const y = pos.y + size.height / 2;
			expect(at(pos.x - 4, y)).toEqual(RED);
			expect(at(pos.x + size.width + 3, y)).toEqual(BLUE);
		}
	});

	test("a dashed gradient stroke leaves gaps and samples the gradient in its dashes", async () => {
		const want = await reference(GRADIENTS.linear);
		for (const shape of ["rect", "path"] as const) {
			const at = await paint(
				SHAPES[shape](
					gradientStroke(GRADIENTS.linear, { align: "inside", dash: [10, 10] }),
				),
			);
			const y = pos.y + 2;
			const row = Array.from({ length: size.width - 8 }, (_, i) => pos.x + 4 + i);
			const painted = row.filter((x) => !close(at(x, y), WHITE, 0));
			const gaps = row.filter((x) => close(at(x, y), WHITE, 0));
			expect(painted.length).toBeGreaterThan(10);
			expect(gaps.length).toBeGreaterThan(10);
			for (const x of painted.filter((x) => painted.includes(x - 1) && painted.includes(x + 1)))
				expect(close(at(x, y), want(x, y))).toBe(true);
		}
	});

	test("the gradient follows the box, not the stroke's outset outline", async () => {
		const at = await paint(
			createRect({
				pos,
				size,
				stroke: gradientStroke(GRADIENTS.linear, { align: "outside", width: 10 }),
			}),
		);
		const want = await reference(GRADIENTS.linear);
		const x = pos.x + size.width / 2;
		expect(close(at(x, pos.y - 3), want(x, pos.y + 3))).toBe(true);
	});

	test("without a gradient the stroke keeps its colour", async () => {
		const at = await paint(
			createRect({ pos, size, stroke: { color: "#0000ff", width: 8, align: "inside" } }),
		);
		expect(at(pos.x + 3, 50)).toEqual(BLUE);
	});

	test("validation checks the stroke's gradient", () => {
		const cmds = (gradient: unknown) =>
			compileScene(
				createRect({ pos, size, stroke: { color: "#000", width: 2, gradient } as Stroke }),
				{ width: W, height: H },
			);
		const codes = (gradient: unknown) =>
			validateCommands(cmds(gradient)).map((i) => i.code);
		expect(codes(GRADIENTS.radial)).toEqual([]);
		expect(codes({ kind: "solid", color: "#fff" })).toEqual(["bad_stroke_gradient"]);
		expect(codes({ ...GRADIENTS.linear, stops: [] })).toEqual(["empty_gradient"]);
		expect(codes({ ...GRADIENTS.radial, radius: 0 })).toEqual(["bad_radius"]);
	});
});
