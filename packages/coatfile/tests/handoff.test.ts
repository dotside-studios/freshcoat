import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "fflate";
import { describe, expect, test } from "vitest";
import {
	decodeHandoff,
	encodeHandoff,
	HANDOFF_MAX_CHARS,
	HANDOFF_MAX_JSON_BYTES,
	isHandoffOrigin,
} from "../src/handoff";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (name: string) =>
	readFileSync(join(fixtures, name), "utf8").trim();
const fixtureJson = JSON.stringify(JSON.parse(read("handoff-template.json")));

/** Bytes deflate cannot shrink, the way a PNG raster behaves. */
function noise(length: number): Uint8Array {
	const out = new Uint8Array(length);
	let x = 7;
	for (let i = 0; i < length; i++) {
		x = (Math.imul(x, 1103515245) + 12345) >>> 0;
		out[i] = x >>> 24;
	}
	return out;
}

function encodeBytes(bytes: Uint8Array): string {
	return Buffer.from(deflateSync(bytes, { level: 9 }))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

describe("encodeHandoff", () => {
	test("writes exactly the checked-in fixture", () => {
		expect(encodeHandoff(fixtureJson)).toBe(read("handoff-fflate.txt"));
	});

	test("round-trips template JSON, including text outside ASCII", () => {
		const data = encodeHandoff(fixtureJson);
		expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeHandoff(data)).toEqual({ ok: true, json: fixtureJson });
	});

	test("round-trips a 1 MB template and fits it in a link", () => {
		const json = JSON.stringify({
			...JSON.parse(fixtureJson),
			assets: [{ base64: Buffer.from(noise(750_000)).toString("base64") }],
		});
		expect(json.length).toBeGreaterThan(1_000_000);
		const data = encodeHandoff(json);
		expect(data.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
		expect(decodeHandoff(data)).toEqual({ ok: true, json });
	});
});

describe("decodeHandoff", () => {
	test("reads raw deflate from another implementation (zlib)", () => {
		expect(decodeHandoff(read("handoff-zlib.txt"))).toEqual({
			ok: true,
			json: fixtureJson,
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
		const bomb = encodeBytes(new Uint8Array(HANDOFF_MAX_JSON_BYTES + 1));
		expect(bomb.length).toBeLessThan(200_000);
		expect(decodeHandoff(bomb)).toEqual({
			ok: false,
			reason: "it is too large to open from a link",
		});
	});
});

describe("isHandoffOrigin", () => {
	test.each([
		"https://freshcoat.example",
		"https://example.com/tools/freshcoat/edit?x=1#coat=abc",
		"http://localhost:3010",
		"http://127.0.0.1:3010/",
	])("accepts %s", (url) => {
		expect(isHandoffOrigin(url)).toBe(true);
		expect(isHandoffOrigin(new URL(url))).toBe(true);
	});

	test.each([
		"",
		"freshcoat.example",
		"http://freshcoat.example",
		"ftp://localhost",
		"javascript:alert(1)",
		"https://me:secret@freshcoat.example",
		"http://me@localhost",
	])("rejects %j", (url) => {
		expect(isHandoffOrigin(url)).toBe(false);
	});
});
