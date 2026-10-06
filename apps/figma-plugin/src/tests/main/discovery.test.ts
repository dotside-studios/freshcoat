import { describe, expect, it } from "vitest";
import {
	collectColorways,
	colorwayInstances,
	detectCards,
	isCard,
	mapSides,
} from "~/main/discovery";

const SIDES = ["front", "back"];

describe("mapSides", () => {
	it("maps children by side name (case-insensitive)", () => {
		const node = {
			id: "c",
			name: "Card",
			type: "COMPONENT",
			children: [
				{ id: "f", name: "Front", type: "FRAME" },
				{ id: "b", name: "back", type: "FRAME" },
			],
		};
		const r = mapSides(node, SIDES, SIDES);
		expect(r.sides).toEqual({ front: "f", back: "b" });
		expect(r.missingRequired).toEqual([]);
	});
	it("reports a missing required side as null", () => {
		const node = {
			id: "c",
			name: "Card",
			type: "COMPONENT",
			children: [{ id: "f", name: "front", type: "FRAME" }],
		};
		const r = mapSides(node, SIDES, SIDES);
		expect(r.sides).toEqual({ front: "f", back: null });
		expect(r.missingRequired).toEqual(["back"]);
	});
});

describe("isCard", () => {
	it("is true when all required sides are present", () => {
		expect(
			isCard(
				{
					id: "c",
					name: "Card",
					type: "COMPONENT",
					children: [
						{ id: "f", name: "front", type: "FRAME" },
						{ id: "b", name: "back", type: "FRAME" },
					],
				},
				SIDES,
			),
		).toBe(true);
	});
	it("is false when a required side is missing", () => {
		expect(
			isCard(
				{
					id: "c",
					name: "Card",
					type: "FRAME",
					children: [{ id: "f", name: "front", type: "FRAME" }],
				},
				SIDES,
			),
		).toBe(false);
	});
});

describe("collectColorways", () => {
	const card = { id: "c:base", name: "Aurora Card" };
	it("collects instances of the base named `<Card> / <Label>`", () => {
		const r = collectColorways(card, [
			{ id: "i1", name: "Aurora Card / Amber", mainComponentId: "c:base" },
			{ id: "i2", name: "Aurora Card / Sky", mainComponentId: "c:base" },
		]);
		expect(r.colorways).toEqual([
			{ instanceId: "i1", label: "Amber" },
			{ instanceId: "i2", label: "Sky" },
		]);
		expect(r.unmatchedInstances).toBe(0);
	});
	it("ignores instances of other components", () => {
		const r = collectColorways(card, [
			{ id: "x", name: "Aurora Card / Amber", mainComponentId: "c:other" },
		]);
		expect(r.colorways).toEqual([]);
		expect(r.unmatchedInstances).toBe(0);
	});
	it("counts instances of the base that don't match the name format", () => {
		const r = collectColorways(card, [
			{ id: "m", name: "Aurora Card", mainComponentId: "c:base" },
			{ id: "n", name: "Mockup preview", mainComponentId: "c:base" },
		]);
		expect(r.colorways).toEqual([]);
		expect(r.unmatchedInstances).toBe(2);
	});
});

describe("detectCards", () => {
	it("returns each card with its sides + colorways", () => {
		const cards = detectCards(
			[
				{
					id: "c:base",
					name: "Aurora Card",
					type: "COMPONENT",
					children: [
						{ id: "f", name: "front", type: "FRAME" },
						{ id: "b", name: "back", type: "FRAME" },
					],
				},
				{ id: "junk", name: "notes", type: "FRAME", children: [] },
			],
			[{ id: "i1", name: "Aurora Card / Amber", mainComponentId: "c:base" }],
			SIDES,
			SIDES,
		);
		expect(cards).toHaveLength(1);
		expect(cards[0].id).toBe("c:base");
		expect(cards[0].sides).toEqual({ front: "f", back: "b" });
		expect(cards[0].colorways).toEqual([{ instanceId: "i1", label: "Amber" }]);
	});
});

describe("colorwayInstances", () => {
	const view = {
		nodes: [
			{
				id: "c1",
				colorways: [
					{ instanceId: "i1", label: "Amber" },
					{ instanceId: "i2", label: "Slate" },
					{ instanceId: "gone", label: "Gone" },
				],
			},
			{ id: "c2", colorways: [{ instanceId: "i3", label: "Rose" }] },
		],
	};
	const nodes = new Map([
		["i1", { id: "i1", type: "INSTANCE" }],
		["i2", { id: "i2", type: "INSTANCE" }],
		["i3", { id: "i3", type: "INSTANCE" }],
	]);

	it("looks up only the card's cached instance ids", async () => {
		const looked: string[] = [];
		const found = await colorwayInstances(view, "c1", async (id) => {
			looked.push(id);
			return nodes.get(id) ?? null;
		});
		expect(looked).toEqual(["i1", "i2", "gone"]);
		expect(found.map((n) => n.id)).toEqual(["i1", "i2"]);
	});

	it("finds none for a card the view does not list", async () => {
		const found = await colorwayInstances(view, "nope", async () => {
			throw new Error("no lookup expected");
		});
		expect(found).toEqual([]);
	});
});
