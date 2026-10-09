import type { Template } from "@freshcoat-js/coatfile";
import type { Binding, Dataset } from "@freshcoat-js/workspace";
import { describe, expect, test } from "vitest";
import {
	cellFocus,
	movedFocus,
	photoFraming,
	visibleCrop,
} from "~/data/photo-framing";
import { photoWatermark } from "~/samples/photo-watermark";
import { produce } from "~/state/immer";

const dataset = (width: number, height: number): Dataset => ({
	id: "d_photos",
	name: "Photos",
	columns: [
		{ key: "photo", type: "image" },
		{ key: "photo_focus", type: "text" },
	],
	records: [
		{
			id: "r_1",
			values: { photo: "ws:abc", photo_focus: "0.2,0.5" },
			status: "pending",
		},
	],
	assets: [
		{
			sha256: "abc",
			contentType: "image/jpeg",
			name: "a.jpg",
			size: 1,
			width,
			height,
			blob: new Blob([]),
		},
	],
});

const binding: Binding = {
	datasetId: "d_photos",
	fields: {
		photo: { kind: "column", column: "photo" },
		photo_focus: { kind: "column", column: "photo_focus" },
	},
	variant: { kind: "image", field: "photo" },
};

describe("photoFraming", () => {
	test("reads the cover image's box in the record's variant", () => {
		const t: Template = photoWatermark();
		const wide = dataset(3000, 2000);
		const tall = dataset(2000, 3000);
		const record = wide.records[0] as Dataset["records"][number];
		const land = photoFraming(t, binding, wide, record, "photo");
		const port = photoFraming(t, binding, tall, record, "photo");
		expect(land?.focusColumn).toBe("photo_focus");
		expect(land && land.aspect > 1).toBe(true);
		expect(port && port.aspect < 1).toBe(true);
	});

	test("frames an unbound focus around the field's default or the fixed point", () => {
		const t = photoWatermark();
		const data = dataset(3000, 2000);
		const record = data.records[0] as Dataset["records"][number];
		const { photo_focus: _f, ...fields } = binding.fields;
		const unbound = photoFraming(
			t,
			{ ...binding, fields },
			data,
			record,
			"photo",
		);
		expect(unbound?.focusColumn).toBeUndefined();
		expect(unbound?.image).toEqual({
			id: "photo",
			srcField: "photo",
			focusField: "photo_focus",
		});
		expect(unbound?.fallback).toEqual({ x: 0.5, y: 0.5 });
		const fixed = produce(t, (d) => {
			const photo = d.template_data[0]?.elements[0];
			if (photo?.type === "image") photo.properties.focus = "0.2,0.4";
		});
		const framed = photoFraming(fixed, binding, data, record, "photo");
		expect(framed?.image.focusField).toBeUndefined();
		expect(framed?.fallback).toEqual({ x: 0.2, y: 0.4 });
		expect(photoFraming(t, binding, data, record, "logo")).toBeUndefined();
	});
});

describe("the crop", () => {
	test("is what cover shows, kept inside the photo", () => {
		expect(visibleCrop(2, 1, { x: 0.5, y: 0.5 })).toEqual({
			x: 0.25,
			y: 0,
			width: 0.5,
			height: 1,
		});
		expect(visibleCrop(2, 1, { x: 0, y: 0.5 }).x).toBe(0);
		expect(visibleCrop(0.5, 1, { x: 0.5, y: 1 }).y).toBe(0.5);
	});

	test("moving it gives the focus at its centre", () => {
		const crop = visibleCrop(2, 1, { x: 0.5, y: 0.5 });
		expect(movedFocus(crop, { x: 0.5, y: 0.3 }, 0.1, 0.4)).toEqual({
			x: 0.6,
			y: 0.3,
		});
		expect(movedFocus(crop, { x: 0.5, y: 0.5 }, 1, 0).x).toBe(0.75);
	});

	test("a cell without a point is the centre", () => {
		expect(cellFocus(null)).toEqual({ x: 0.5, y: 0.5 });
		expect(cellFocus("0.2,0.8")).toEqual({ x: 0.2, y: 0.8 });
	});
});
