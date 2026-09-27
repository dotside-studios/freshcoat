import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Template } from "@freshcoat-js/coatfile";
import { deflateSync, strToU8 } from "fflate";
import { describe, expect, test } from "vitest";
import {
	decodeHandoff,
	HANDOFF_MAX_JSON_BYTES,
	readHandoff,
} from "../app/handoff";

const fixtures = resolve(__dirname, "fixtures");
const read = (name: string) =>
	readFileSync(resolve(fixtures, name), "utf8").trim();
const fixtureTemplate = JSON.parse(read("handoff-template.json")) as Template;

/** The plugin's encoding, restated here only to build inputs for the
 *  decoder. The fixtures are what hold the two implementations together. */
function encode(json: string | Uint8Array): string {
	const bytes = typeof json === "string" ? strToU8(json) : json;
	return Buffer.from(deflateSync(bytes, { level: 9 }))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function noise(length: number): Uint8Array {
	const out = new Uint8Array(length);
	let x = 7;
	for (let i = 0; i < length; i++) {
		x = (Math.imul(x, 1103515245) + 12345) >>> 0;
		out[i] = x >>> 24;
	}
	return out;
}

describe("decodeHandoff", () => {
	test("reads what the plugin's encoder wrote", () => {
		expect(decodeHandoff(read("handoff-fflate.txt"))).toEqual({
			ok: true,
			json: JSON.stringify(fixtureTemplate),
		});
	});

	test("reads raw deflate from another implementation (zlib)", () => {
		expect(decodeHandoff(read("handoff-zlib.txt"))).toEqual({
			ok: true,
			json: JSON.stringify(fixtureTemplate),
		});
	});

	test("refuses characters outside base64url", () => {
		expect(decodeHandoff("abc+def")).toEqual({
			ok: false,
			reason: "the link is incomplete or damaged",
		});
		expect(decodeHandoff("")).toMatchObject({ ok: false });
	});

	test("refuses a link cut short", () => {
		const data = read("handoff-fflate.txt");
		expect(decodeHandoff(data.slice(0, data.length >> 1))).toEqual({
			ok: false,
			reason: "the link is incomplete or damaged",
		});
	});

	test("refuses data that is not deflate", () => {
		expect(decodeHandoff("AAAAAAAAAAAAAAAA")).toMatchObject({ ok: false });
	});

	test("refuses a link that inflates past the limit", () => {
		const bomb = encode(new Uint8Array(HANDOFF_MAX_JSON_BYTES + 1));
		expect(bomb.length).toBeLessThan(200_000);
		expect(decodeHandoff(bomb)).toEqual({
			ok: false,
			reason: "it is too large to open from a link",
		});
	});
});

describe("readHandoff", () => {
	test("opens the fixture as a validated template named by its id", async () => {
		const result = await readHandoff(read("handoff-fflate.txt"));
		if (!result.ok) throw new Error(result.reason);
		expect(result.template.name).toBe("Café card from Figma");
		expect(result.template.description).toBe("Straße ✓ 日本");
		expect(result.fileName).toBe("figma-handoff.coat");
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

	test("refuses data that is not JSON", async () => {
		expect(await readHandoff(encode("not json"))).toEqual({
			ok: false,
			reason: "it isn't template JSON",
		});
	});
});
