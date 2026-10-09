import { createHash } from "node:crypto";
import type { Template } from "@freshcoat-js/coatfile";
import { fixtures } from "@freshcoat-js/coatfile/fixtures";
import { encodeHandoff as encode } from "@freshcoat-js/coatfile/handoff";
import { describe, expect, test } from "vitest";
import { readHandoff } from "../app/handoff";

const fixtureTemplate = fixtures.minimalCard as Template;

function noise(length: number): Uint8Array {
	const out = new Uint8Array(length);
	let x = 7;
	for (let i = 0; i < length; i++) {
		x = (Math.imul(x, 1103515245) + 12345) >>> 0;
		out[i] = x >>> 24;
	}
	return out;
}

describe("readHandoff", () => {
	test("opens a template as a validated template named by its id", async () => {
		const result = await readHandoff(encode(JSON.stringify(fixtureTemplate)));
		if (!result.ok) throw new Error(result.reason);
		expect(result.template.name).toBe(fixtureTemplate.name);
		expect(result.fileName).toBe("minimal-card.coat");
		expect(result.notices).toEqual([]);
	});

	test("opens a 1 MB template", async () => {
		const bytes = noise(750_000);
		const template = {
			...fixtureTemplate,
			assets: [
				{
					sha256: createHash("sha256").update(bytes).digest("hex"),
					contentType: "image/png",
					base64: Buffer.from(bytes).toString("base64"),
				},
			],
		};
		const json = JSON.stringify(template);
		expect(json.length).toBeGreaterThan(1_000_000);
		const result = await readHandoff(encode(json));
		if (!result.ok) throw new Error(result.reason);
		expect(result.template.assets?.[0]?.base64).toBe(
			template.assets[0]?.base64,
		);
	});

	test("heals duplicate layer ids and says so", async () => {
		const [front] = fixtureTemplate.template_data;
		if (!front) throw new Error("fixture has no side");
		const element = front.elements[0];
		const result = await readHandoff(
			encode(
				JSON.stringify({
					...fixtureTemplate,
					template_data: [{ ...front, elements: [element, { ...element }] }],
				}),
			),
		);
		if (!result.ok) throw new Error(result.reason);
		expect(result.notices[0]).toMatch(/^Renamed duplicate layer ids: /);
	});

	test("names the first problem with an invalid template", async () => {
		const { width: _, ...noWidth } = fixtureTemplate;
		const result = await readHandoff(encode(JSON.stringify(noWidth)));
		expect(result).toEqual({
			ok: false,
			reason: "Invalid input: expected number, received undefined at /width",
		});
	});

	test("passes on why a link could not be decoded", async () => {
		expect(await readHandoff("abc+def")).toEqual({
			ok: false,
			reason: "the link is incomplete or damaged",
		});
	});

	test("refuses data that is not JSON", async () => {
		expect(await readHandoff(encode("not json"))).toEqual({
			ok: false,
			reason: "it isn't template JSON",
		});
	});
});
