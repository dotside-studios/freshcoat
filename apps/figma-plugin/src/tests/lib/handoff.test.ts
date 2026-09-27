import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Template } from "@freshcoat-js/coatfile";
import { unpackTemplate } from "@freshcoat-js/coatfile/coat";
import { sha256 } from "js-sha256";
import { describe, expect, it, vi } from "vitest";
import {
	checkFreshcoatAddress,
	decodeHandoff,
	encodeHandoff,
	HANDOFF_MAX_CHARS,
	handoffUrl,
	openFileUrl,
	openInFreshcoat,
	TOO_LARGE_MESSAGE,
} from "~/lib/handoff";
import type { UiToMain } from "~/shared/protocol";

const fixtures = resolve(__dirname, "fixtures");
const read = (name: string) =>
	readFileSync(resolve(fixtures, name), "utf8").trim();
const fixtureTemplate = JSON.parse(read("handoff-template.json")) as Template;

/** Bytes deflate cannot shrink, the way a PNG raster behaves. */
function noise(length: number, seed = 1): Uint8Array {
	const out = new Uint8Array(length);
	let x = seed;
	for (let i = 0; i < length; i++) {
		x = (Math.imul(x, 1103515245) + 12345) >>> 0;
		out[i] = x >>> 24;
	}
	return out;
}

/** A template carrying `bytes` of incompressible raster as an inline asset. */
function templateWithRaster(bytes: number): Template {
	const data = noise(bytes);
	return {
		...fixtureTemplate,
		assets: [
			{
				sha256: sha256(data),
				contentType: "image/png",
				base64: Buffer.from(data).toString("base64"),
			},
		],
	} as Template;
}

function io() {
	const posted: UiToMain[] = [];
	const downloads: { fileName: string; file: Blob }[] = [];
	return {
		posted,
		downloads,
		post: vi.fn((m: UiToMain) => posted.push(m)),
		download: vi.fn((fileName: string, file: Blob) =>
			downloads.push({ fileName, file }),
		),
	};
}

describe("encodeHandoff", () => {
	it("round-trips template JSON, including text outside ASCII", () => {
		const json = JSON.stringify(fixtureTemplate);
		const data = encodeHandoff(json);
		expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeHandoff(data)).toBe(json);
	});

	it("writes exactly the checked-in fixture the editor decodes", () => {
		expect(encodeHandoff(JSON.stringify(fixtureTemplate))).toBe(
			read("handoff-fflate.txt"),
		);
	});

	it("reads raw deflate from another implementation (zlib)", () => {
		expect(decodeHandoff(read("handoff-zlib.txt"))).toBe(
			JSON.stringify(fixtureTemplate),
		);
	});

	it("keeps its fixtures identical to the editor's copies", () => {
		const editor = resolve(__dirname, "../../../../editor/src/tests/fixtures");
		for (const name of [
			"handoff-template.json",
			"handoff-fflate.txt",
			"handoff-zlib.txt",
		]) {
			expect(readFileSync(resolve(editor, name), "utf8")).toBe(
				readFileSync(resolve(fixtures, name), "utf8"),
			);
		}
	});

	it("round-trips a 1 MB template and fits it in a link", () => {
		const json = JSON.stringify(templateWithRaster(750_000));
		expect(json.length).toBeGreaterThan(1_000_000);
		const data = encodeHandoff(json);
		expect(data.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
		expect(decodeHandoff(data)).toBe(json);
	});
});

describe("checkFreshcoatAddress", () => {
	it.each([
		["https://freshcoat.example", "https://freshcoat.example"],
		["  https://freshcoat.example/  ", "https://freshcoat.example"],
		["https://freshcoat.example/edit", "https://freshcoat.example"],
		[
			"https://example.com/tools/freshcoat/",
			"https://example.com/tools/freshcoat",
		],
		[
			"https://freshcoat.example/edit?x=1#coat=abc",
			"https://freshcoat.example",
		],
		["http://localhost:3010", "http://localhost:3010"],
		["http://127.0.0.1:3010/", "http://127.0.0.1:3010"],
	])("accepts %s", (input, base) => {
		expect(checkFreshcoatAddress(input)).toEqual({ ok: true, base });
	});

	it.each([
		["", "Enter the Freshcoat address"],
		["freshcoat.example", "Not a web address"],
		["http://freshcoat.example", "Use an https address"],
		["ftp://localhost", "Use an http or https address"],
		["javascript:alert(1)", "Use an https address"],
		[
			"https://me:secret@freshcoat.example",
			"Leave the sign-in out of the address",
		],
	])("rejects %j", (input, reason) => {
		expect(checkFreshcoatAddress(input)).toEqual({ ok: false, reason });
	});
});

describe("URLs", () => {
	it("puts the template and the open request in the fragment", () => {
		expect(handoffUrl("https://f.example", "abc")).toBe(
			"https://f.example/edit#coat=abc",
		);
		expect(openFileUrl("http://localhost:3010")).toBe(
			"http://localhost:3010/edit#open=1",
		);
	});
});

describe("openInFreshcoat", () => {
	const options = {
		address: "https://f.example/",
		fileName: "custom-card.coat",
	};

	it("opens a link carrying the template", async () => {
		const sink = io();
		const outcome = await openInFreshcoat(fixtureTemplate, options, sink);
		const url = handoffUrl(
			"https://f.example",
			encodeHandoff(JSON.stringify(fixtureTemplate)),
		);
		expect(outcome).toEqual({ kind: "link", url });
		expect(sink.posted).toEqual([{ type: "open-external", url }]);
		expect(sink.download).not.toHaveBeenCalled();
	});

	it("downloads a template too large for a link and asks Freshcoat to open it", async () => {
		const template = templateWithRaster(1_200_000);
		expect(encodeHandoff(JSON.stringify(template)).length).toBeGreaterThan(
			HANDOFF_MAX_CHARS,
		);
		const sink = io();
		const outcome = await openInFreshcoat(template, options, sink);
		expect(outcome).toEqual({
			kind: "file",
			url: "https://f.example/edit#open=1",
			fileName: "custom-card.coat",
			message: TOO_LARGE_MESSAGE,
		});
		expect(TOO_LARGE_MESSAGE).toBe(
			"Too large for a link. Open the downloaded file in Freshcoat",
		);
		expect(sink.posted).toEqual([
			{ type: "open-external", url: "https://f.example/edit#open=1" },
		]);
		const [file] = sink.downloads;
		expect(file?.fileName).toBe("custom-card.coat");
		const unpacked = (await unpackTemplate(
			new Uint8Array(await (file as { file: Blob }).file.arrayBuffer()),
			{ sha256: async (b) => sha256(b) },
		)) as Template;
		expect(unpacked.name).toBe(fixtureTemplate.name);
		expect(unpacked.assets?.[0]?.base64).toBe(template.assets?.[0]?.base64);
	});

	it("cuts over at exactly HANDOFF_MAX_CHARS", async () => {
		// Find raster sizes either side of the limit, so the boundary itself is
		// what is tested rather than two templates far from it.
		const length = (bytes: number) =>
			encodeHandoff(JSON.stringify(templateWithRaster(bytes))).length;
		let lo = 1_000_000;
		let hi = 1_200_000;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (length(mid) <= HANDOFF_MAX_CHARS) lo = mid;
			else hi = mid;
		}
		expect(length(lo)).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
		expect(length(hi)).toBeGreaterThan(HANDOFF_MAX_CHARS);
		const under = await openInFreshcoat(templateWithRaster(lo), options, io());
		const over = await openInFreshcoat(templateWithRaster(hi), options, io());
		expect(under.kind).toBe("link");
		expect(over.kind).toBe("file");
	}, 60_000);

	it("asks for an address before doing anything", async () => {
		const sink = io();
		expect(
			await openInFreshcoat(
				fixtureTemplate,
				{ ...options, address: " " },
				sink,
			),
		).toEqual({ kind: "no-address" });
		expect(
			await openInFreshcoat(
				fixtureTemplate,
				{ ...options, address: "http://freshcoat.example" },
				sink,
			),
		).toEqual({ kind: "bad-address", reason: "Use an https address" });
		expect(sink.post).not.toHaveBeenCalled();
		expect(sink.download).not.toHaveBeenCalled();
	});
});
