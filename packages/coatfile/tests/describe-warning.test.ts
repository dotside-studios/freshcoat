import { describe, expect, it } from "vitest";
import { describeWarning } from "../src/render";

describe("describeWarning", () => {
	it("names what failed to load", () => {
		expect(
			describeWarning({
				kind: "image_load_failed",
				src: "https://example.com/a.png",
				error: "404",
			}),
		).toBe("Couldn't load image: https://example.com/a.png");
		expect(
			describeWarning({
				kind: "image_load_failed",
				src: "data:image/png;base64,AAAA",
				error: "decode",
			}),
		).toBe("Couldn't load image: inline data");
		expect(
			describeWarning({ kind: "font_load_failed", family: "Inter", error: "" }),
		).toBe("Couldn't load font: Inter");
	});

	it("names the layer when the warning carries one", () => {
		expect(describeWarning({ kind: "text_path_overflow", layer: "title" })).toBe(
			"Text runs past the end of its path: title",
		);
		expect(describeWarning({ kind: "text_path_overflow" })).toBe(
			"Text runs past the end of its path",
		);
	});

	it("describes the painter's other warnings", () => {
		expect(describeWarning({ kind: "unhandled_op", op: "blur" })).toBe(
			"Unhandled draw op: blur",
		);
		expect(
			describeWarning({ kind: "adjust_unsupported", component: "lut" }),
		).toBe("Adjustment skipped: lut");
		expect(
			describeWarning({
				kind: "pattern_unsupported",
				pattern: "dots",
				error: "",
			}),
		).toBe("Pattern shader failed, painted solid: dots");
	});

	it("gives a refused barcode the encoder's reason", () => {
		expect(
			describeWarning({
				kind: "barcode_invalid",
				symbology: "ean13",
				value: "12",
				message: "too short",
			}),
		).toBe("Barcode: too short");
	});

	it("gives gamut compression as a share", () => {
		expect(
			describeWarning({
				kind: "gamut_compressed",
				layer: "photo",
				clipped: 0.123,
				pullback: 0.5,
			}),
		).toBe("Colour pulled into printer range: 12% of photo");
	});
});
