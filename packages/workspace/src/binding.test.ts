import type { Template, Variant } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import {
	autoBinding,
	imagesFor,
	isEmptyVariant,
	resolveValues,
	serialValue,
	variantFor,
	variantsFor,
} from "./binding";
import { deepFreeze, memberCard, members, photoSha } from "./test-fixtures";
import type { Binding, Dataset } from "./types";

const template = deepFreeze(memberCard);
const dataset: Dataset = deepFreeze(members);
const [ana, ben, cy] = dataset.records;

describe("autoBinding", () => {
	it("binds fields to same-key columns, exactly then ignoring case", () => {
		const ds: Dataset = {
			...dataset,
			columns: [
				{ key: "NAME", type: "text" },
				{ key: "photo", type: "image" },
				{ key: "Photo", type: "image" },
			],
		};
		expect(autoBinding(template, ds)).toEqual({
			datasetId: "d_members",
			fields: {
				name: { kind: "column", column: "NAME" },
				photo: { kind: "column", column: "photo" },
			},
		});
	});
});

describe("resolveValues", () => {
	const binding: Binding = {
		datasetId: "d_members",
		fields: {
			name: { kind: "column", column: "name" },
			number: {
				kind: "serial",
				start: 7,
				step: 5,
				pad: 4,
				prefix: "M-",
				suffix: "/X",
			},
			photo: { kind: "column", column: "photo" },
			vip: { kind: "column", column: "vip" },
		},
	};

	it("resolves column, serial and default sources", () => {
		expect(resolveValues(template, binding, dataset, ana, 0)).toEqual({
			name: "Ana Cruz",
			number: "M-0007/X",
			photo: `ws:${photoSha}`,
			vip: "true",
		});
		expect(resolveValues(template, binding, dataset, ben, 2)).toEqual({
			name: "Ben Uy",
			number: "M-0017/X",
			photo: "",
			vip: "false",
		});
		expect(resolveValues(template, binding, dataset, cy, 1)).toMatchObject({
			vip: "false",
		});
	});

	it("gives constants, and defaults for unbound or missing columns", () => {
		const b: Binding = {
			datasetId: "d_members",
			fields: {
				name: { kind: "constant", value: "Guest" },
				number: { kind: "column", column: "gone" },
			},
		};
		expect(resolveValues(template, b, dataset, ana, 0)).toEqual({
			name: "Guest",
			number: "0000",
			photo: "",
			vip: "false",
		});
	});

	it("gives every default without a binding", () => {
		expect(resolveValues(template, undefined, undefined, undefined, 0)).toEqual(
			{
				name: "Member",
				number: "0000",
				photo: "",
				vip: "false",
			},
		);
	});

	it("pads serials without a prefix, and keeps the sign in front", () => {
		const serial = { kind: "serial", start: 1, step: 1, pad: 3 } as const;
		expect(serialValue(serial, 0)).toBe("001");
		expect(serialValue(serial, 1233)).toBe("1234");
		expect(serialValue({ ...serial, start: -5 }, 0)).toBe("-005");
		expect(serialValue({ ...serial, pad: 0 }, 9)).toBe("10");
	});
});

describe("variantFor", () => {
	const byTier: Binding = {
		datasetId: "d_members",
		fields: {},
		variant: { kind: "column", column: "tier" },
	};

	it("matches the cell against id, then label, ignoring case", () => {
		expect(variantFor(template, byTier, dataset, ana)).toBe("gold");
		expect(variantFor(template, byTier, dataset, ben)).toBe("gold");
		expect(
			variantFor(template, byTier, dataset, {
				id: "r",
				status: "pending",
				values: { tier: " SILVER " },
			}),
		).toBe("silver");
	});

	it("gives undefined for an unknown or empty value", () => {
		expect(variantFor(template, byTier, dataset, cy)).toBeUndefined();
		expect(
			variantFor(template, byTier, dataset, dataset.records[3]),
		).toBeUndefined();
		expect(variantFor(template, undefined, dataset, ana)).toBeUndefined();
	});

	it("gives a fixed variant only when the template has it", () => {
		const fixed = (id?: string): Binding => ({
			datasetId: "d_members",
			fields: {},
			variant: { kind: "fixed", ...(id ? { id } : {}) },
		});
		expect(variantFor(template, fixed("silver"), dataset, ana)).toBe("silver");
		expect(variantFor(template, fixed("bronze"), dataset, ana)).toBeUndefined();
		expect(variantFor(template, fixed(), dataset, ana)).toBeUndefined();
	});
});

describe("variantsFor", () => {
	const changes = (id: string): Variant => ({
		id,
		label: id,
		overrides: [
			{
				name: "front",
				elements: [{ id: "name", properties: { color: "#f00" } }],
			},
		],
	});
	const variants: Variant[] = [
		changes("gold"),
		{ id: "empty", label: "Empty", overrides: [] },
		changes("silver"),
	];
	const t: Template = { ...template, variants };
	const bind = (variant?: Binding["variant"]): Binding => ({
		datasetId: "d_members",
		fields: {},
		...(variant ? { variant } : {}),
	});

	it("lists Default, then every variant that changes something, under all", () => {
		const all = bind({ kind: "all" });
		expect(variantsFor(t, all, dataset, ana)).toEqual([
			undefined,
			"gold",
			"silver",
		]);
		expect(variantsFor(t, all, undefined, undefined)).toEqual([
			undefined,
			"gold",
			"silver",
		]);
		expect(variantsFor(template, all, dataset, ana)).toEqual([undefined]);
		expect(
			variantsFor({ ...t, variants: undefined }, all, dataset, ana),
		).toEqual([undefined]);
	});

	it("gives Default from variantFor under all", () => {
		expect(variantFor(t, bind({ kind: "all" }), dataset, ana)).toBeUndefined();
	});

	it("gives the one variantFor gives under any other source", () => {
		expect(variantsFor(t, bind(), dataset, ana)).toEqual([undefined]);
		expect(variantsFor(t, undefined, undefined, undefined)).toEqual([
			undefined,
		]);
		expect(
			variantsFor(
				t,
				bind({ kind: "fixed", id: "silver" }),
				undefined,
				undefined,
			),
		).toEqual(["silver"]);
		expect(
			variantsFor(t, bind({ kind: "column", column: "tier" }), dataset, ana),
		).toEqual(["gold"]);
	});
});

describe("isEmptyVariant", () => {
	const variant = (overrides: Variant["overrides"]): Variant => ({
		id: "v",
		label: "V",
		overrides,
	});

	it("is empty with no overrides, or only empty deltas", () => {
		expect(isEmptyVariant(variant([]))).toBe(true);
		expect(isEmptyVariant(variant([{ name: "front" }]))).toBe(true);
		expect(
			isEmptyVariant(
				variant([
					{ name: "front", elements: [] },
					{ name: "back", elements: [{ id: "name", properties: {} }] },
				]),
			),
		).toBe(true);
	});

	it("is not empty with a background, a property or a shell field", () => {
		expect(
			isEmptyVariant(
				variant([
					{
						name: "front",
						background: {
							id: "bg",
							type: "rect",
							pos: { x: 0, y: 0 },
							size: { width: 1, height: 1 },
							properties: { fill: "#000" },
						},
					},
				]),
			),
		).toBe(false);
		expect(
			isEmptyVariant(
				variant([
					{ name: "front", elements: [{ id: "name", properties: { a: 1 } }] },
				]),
			),
		).toBe(false);
		// format 1.4 deltas: a shell field or hidden alone is a change
		const shell = (extra: Record<string, unknown>) =>
			variant([
				{
					name: "front",
					elements: [{ id: "name", properties: {}, ...extra }],
				},
			] as Variant["overrides"]);
		expect(isEmptyVariant(shell({ pos: { x: 1, y: 2 } }))).toBe(false);
		expect(isEmptyVariant(shell({ hidden: true }))).toBe(false);
		expect(isEmptyVariant(shell({ opacity: undefined }))).toBe(true);
	});
});

describe("imagesFor", () => {
	it("maps ws: references to Blobs", () => {
		const images = imagesFor(dataset);
		expect([...images.keys()]).toEqual([`ws:${photoSha}`]);
		expect(images.get(`ws:${photoSha}`)).toBe(dataset.assets[0]?.blob);
	});
});
