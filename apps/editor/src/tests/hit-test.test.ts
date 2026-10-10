import type { Template } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { hitLayer } from "~/app/controller";
import type { LayerGeometry } from "~/doc/geometry";
import { isAncestor, walkLayers } from "~/doc/path";
import { booleanDoc, doc, geometryOf } from "./doc-fixture";

function containsPoint(
	rect: { x: number; y: number; width: number; height: number },
	rotation: number,
	p: { x: number; y: number },
): boolean {
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	const rad = (-rotation * Math.PI) / 180;
	const dx = p.x - cx;
	const dy = p.y - cy;
	const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
	const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
	return Math.abs(lx) <= rect.width / 2 && Math.abs(ly) <= rect.height / 2;
}

/** The implementation `hitLayer` replaced. */
function previousHit(
	t: Template,
	side: number,
	geometry: LayerGeometry,
	locked: ReadonlySet<string>,
	hidden: ReadonlySet<string>,
	point: { x: number; y: number },
): string | null {
	const entries = [...walkLayers(t, side)].filter(
		(e) => !e.key.endsWith("/bg") && !e.key.split("/").includes("-1"),
	);
	let hit: string | null = null;
	for (const e of entries) {
		if (locked.has(e.key) || hidden.has(e.key)) continue;
		if ([...locked].some((l) => isAncestor(l, e.key))) continue;
		const box = geometry.get(e.key);
		if (!box || !containsPoint(box.rect, box.worldRotation, point)) continue;
		hit = e.key;
	}
	return hit;
}

describe("hitLayer", () => {
	const t = doc();
	const geometry = geometryOf(t);
	const cases: [string, string[], string[]][] = [
		["nothing locked", [], []],
		["a locked frame", ["0/1"], []],
		["a locked nested frame", ["0/1/2"], []],
		["a locked leaf", ["0/1/0", "0/0"], []],
		["a locked mask", ["0/2"], []],
		["hidden layers", [], ["0/1", "0/1/2/0", "0/6/0"]],
		["locked and hidden", ["0/1/2", "0/6"], ["0/1", "0/3/0"]],
	];

	for (const [name, locked, hidden] of cases) {
		it(`matches the previous hit test with ${name}`, () => {
			const l = new Set(locked);
			const h = new Set(hidden);
			const expected: (string | null)[] = [];
			const actual: (string | null)[] = [];
			for (let x = -10; x <= 1010; x += 5) {
				for (let y = -10; y <= 610; y += 5) {
					expected.push(previousHit(t, 0, geometry, l, h, { x, y }));
					actual.push(hitLayer(t, 0, geometry, l, h, { x, y }));
				}
			}
			expect(actual).toEqual(expected);
			expect(new Set(expected).size).toBeGreaterThan(3);
		});
	}

	it("finds nested layers and skips the background and mask sources", () => {
		const none = new Set<string>();
		const deep = geometry.get("0/1/2/0")?.rect;
		expect(deep).toBeDefined();
		if (!deep) return;
		const centre = { x: deep.x + deep.width / 2, y: deep.y + deep.height / 2 };
		expect(hitLayer(t, 0, geometry, none, none, centre)).toBe("0/1/2/0");
		expect(hitLayer(t, 0, geometry, new Set(["0/1"]), none, centre)).toBe(null);
		expect(hitLayer(t, 0, geometry, none, none, { x: 990, y: 590 })).toBe(null);
	});

	it("hits a boolean as one shape, and its operands only when asked", () => {
		const b = booleanDoc();
		const g = geometryOf(b);
		const none = new Set<string>();
		const inDot = { x: 190, y: 430 };
		expect(hitLayer(b, 0, g, none, none, inDot)).toBe("0/7");
		expect(hitLayer(b, 0, g, none, none, inDot, { operands: () => true })).toBe(
			"0/7/1",
		);
		expect(
			hitLayer(
				b,
				0,
				g,
				none,
				none,
				{ x: 110, y: 430 },
				{
					operands: (key) => key === "0/7",
				},
			),
		).toBe("0/7/0");
		expect(
			hitLayer(b, 0, g, none, new Set(["0/7/1"]), inDot, {
				operands: () => true,
			}),
		).toBe("0/7");
	});

	it("returns null for a missing side", () => {
		const none = new Set<string>();
		expect(hitLayer(t, 9, geometry, none, none, { x: 0, y: 0 })).toBe(null);
	});
});
