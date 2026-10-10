import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import { defineTemplate } from "../src/define";
import type { Template } from "../src/types";

describe("defineTemplate", () => {
	test("returns what it is given", async () => {
		const template: Template = fixtures.minimalCard;
		const build = async () => template;
		expect(defineTemplate(template)).toBe(template);
		expect(defineTemplate(build)).toBe(build);
		expect(await defineTemplate(build)()).toBe(template);
	});

	test("types an inline template", () => {
		const template = defineTemplate({
			format_version: "1.6",
			id: "badge",
			name: "Badge",
			width: 200,
			height: 100,
			fields: { type: "object", properties: {}, required: [] },
			template_data: [
				{
					name: "front",
					background: {
						id: "bg",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: 200, height: 100 },
						properties: { fill: "#ffffff" },
					},
					elements: [],
				},
			],
		});
		expect(template.template_data[0]?.name).toBe("front");
		// @ts-expect-error a template needs a width
		defineTemplate({ id: "badge" });
	});
});
