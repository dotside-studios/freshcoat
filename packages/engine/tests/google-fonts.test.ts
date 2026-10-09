import { describe, expect, test } from "vitest";
import { fontRequestKey, googleCss2Url } from "../src/font-bytes";

describe("googleCss2Url", () => {
	test("joins the words of a family with +", () => {
		expect(googleCss2Url(" Open  Sans ", [700, 400, 700])).toBe(
			"https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap",
		);
	});

	test("lists every upright weight before the italics", () => {
		expect(googleCss2Url("Playfair Display", [700, 400], true)).toBe(
			"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap",
		);
	});

	test("asks for 400 with no weights, and the default face without a list", () => {
		expect(googleCss2Url("Inter", [])).toBe(
			"https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap",
		);
		expect(googleCss2Url("Bebas Neue")).toBe(
			"https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap",
		);
	});
});

describe("fontRequestKey", () => {
	test("tells local faces apart by style", () => {
		const local = (style?: "italic") =>
			fontRequestKey({
				family: "Inter",
				descriptor: {
					kind: "local",
					family: "Inter",
					files: [{ weight: 400, ...(style ? { style } : {}), src: "a.ttf" }],
				},
			});
		expect(local()).not.toBe(local("italic"));
		expect(fontRequestKey({ family: "Inter" })).toBe("Inter:none");
	});
});
