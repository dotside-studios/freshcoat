import type { Template, Variant } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import {
	autoBinding,
	imageFields,
	imagesFor,
	matchVariant,
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
	it("matches names ignoring case and punctuation, then field titles", () => {
		const loose: Template = {
			...template,
			fields: {
				type: "object",
				properties: {
					firstName: { type: "string" },
					surname: { type: "string", title: "Last name" },
					city: { type: "string" },
				},
			},
		};
		const ds: Dataset = {
			...dataset,
			columns: [
				{ key: "First Name", type: "text" },
				{ key: "last_name", type: "text" },
				{ key: "town", type: "text", title: "City" },
			],
		};
		expect(autoBinding(loose, ds).fields).toEqual({
			firstName: { kind: "column", column: "First Name" },
			surname: { kind: "column", column: "last_name" },
			city: { kind: "column", column: "town" },
		});
	});

	it("gives each loosely matched column to one field", () => {
		const loose: Template = {
			...template,
			fields: {
				type: "object",
				properties: {
					first_name: { type: "string" },
					firstName: { type: "string" },
				},
			},
		};
		const ds: Dataset = {
			...dataset,
			columns: [{ key: "First Name", type: "text" }],
		};
		expect(autoBinding(loose, ds).fields).toEqual({
			first_name: { kind: "column", column: "First Name" },
		});
	});

	it("keeps exact matches ahead of loose ones", () => {
		const ds: Dataset = {
			...dataset,
			columns: [
				{ key: "Name!", type: "text" },
				{ key: "name", type: "text" },
			],
		};
		expect(autoBinding(template, ds).fields.name).toEqual({
			kind: "column",
			column: "name",
		});
	});
});

describe("autoBinding with shaped variants", () => {
	it("lets the variant follow the bound photo", () => {
		const shaped: Template = {
			...template,
			variants: [
				{
					id: "tall",
					label: "Tall",
					size: { width: 638, height: 1012 },
					overrides: [],
				},
			],
		};
		expect(autoBinding(shaped, dataset).variant).toEqual({
			kind: "image",
			field: "photo",
		});
		expect(autoBinding(template, dataset).variant).toBeUndefined();
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

	it("falls back when the cell names no variant, unless it says default", () => {
		const withFallback: Binding = {
			...byTier,
			variant: {
				kind: "column",
				column: "tier",
				fallback: { kind: "fixed", id: "silver" },
			},
		};
		const tier = (value: string | null) => ({
			id: "r",
			status: "pending" as const,
			values: { tier: value },
		});
		expect(variantFor(template, withFallback, dataset, ana)).toBe("gold");
		expect(variantFor(template, withFallback, dataset, cy)).toBe("silver");
		expect(variantFor(template, withFallback, dataset, tier(null))).toBe(
			"silver",
		);
		expect(
			variantFor(template, withFallback, dataset, tier(" Default ")),
		).toBeUndefined();
	});
});

describe("variant from the photo's shape", () => {
	const shaped: Template = {
		...template,
		variants: [
			{ id: "gold", label: "Gold", overrides: [] },
			{
				id: "portrait",
				label: "Portrait",
				size: { width: 638, height: 1012 },
				overrides: [],
			},
			{
				id: "square",
				label: "Square",
				size: { width: 800, height: 800 },
				overrides: [],
			},
		],
	};
	const byPhoto: Binding = {
		datasetId: "d_members",
		fields: { photo: { kind: "column", column: "photo" } },
		variant: { kind: "image", field: "photo" },
	};
	const withPhoto = (width: number, height: number, orientation?: number) => {
		const [asset] = dataset.assets;
		if (!asset) throw new Error("no photo");
		return {
			...dataset,
			assets: [
				{
					...asset,
					width,
					height,
					...(orientation ? { orientation } : {}),
				},
			],
		};
	};

	it("reads the photo's shape for a variant column's empty cells", () => {
		const byColumn: Binding = {
			...byPhoto,
			variant: {
				kind: "column",
				column: "tier",
				fallback: { kind: "image", field: "photo" },
			},
		};
		const tall = withPhoto(2000, 3000);
		expect(variantFor(shaped, byColumn, tall, ana)).toBe("gold");
		expect(
			variantFor(shaped, byColumn, tall, {
				...ana,
				values: { ...ana.values, tier: null },
			}),
		).toBe("portrait");
	});

	it("reads the bound photo as seen", () => {
		expect(variantFor(shaped, byPhoto, withPhoto(3000, 2000), ana)).toBe(
			undefined,
		);
		expect(variantFor(shaped, byPhoto, withPhoto(2000, 3000), ana)).toBe(
			"portrait",
		);
		expect(variantFor(shaped, byPhoto, withPhoto(3000, 2000, 6), ana)).toBe(
			"portrait",
		);
		expect(variantFor(shaped, byPhoto, withPhoto(2000, 2000), ana)).toBe(
			"square",
		);
	});

	it("is Default without a readable photo", () => {
		expect(variantFor(shaped, byPhoto, withPhoto(2000, 3000), ben)).toBe(
			undefined,
		);
		expect(variantFor(shaped, byPhoto, withPhoto(0, 0), ana)).toBeUndefined();
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

describe("imageFields", () => {
	it("lists the fields with format image", () => {
		expect(imageFields(template).map((f) => f.key)).toEqual(["photo"]);
		const none = { ...template, fields: { type: "object", properties: {} } };
		expect(imageFields(none as Template)).toEqual([]);
	});
});

describe("imagesFor", () => {
	it("maps ws: references to Blobs", () => {
		const images = imagesFor(dataset);
		expect([...images.keys()]).toEqual([`ws:${photoSha}`]);
		expect(images.get(`ws:${photoSha}`)).toBe(dataset.assets[0]?.blob);
	});
});

describe("matchVariant", () => {
	const options = [
		{ id: "dark", label: "Night" },
		{ id: "portrait", label: " Tall " },
	];
	const id = (o: { id: string }) => o.id;

	it("matches by id, then label, ignoring case and surrounding space", () => {
		expect(matchVariant(options, "DARK", id)?.id).toBe("dark");
		expect(matchVariant(options, " tall ", id)?.id).toBe("portrait");
		expect(matchVariant(options, "nope", id)).toBeUndefined();
	});
});
