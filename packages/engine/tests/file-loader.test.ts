import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { afterAll, describe, expect, test } from "vitest";
import { fileLoader } from "../src/file-loader";
import { createHeadlessEnv } from "../src/headless";
import type { Command, EncodedPaintResult } from "../src/types";

const root = mkdtempSync(join(tmpdir(), "file-loader-"));
mkdirSync(join(root, "fonts"));
writeFileSync(join(root, "fonts", "a.bin"), new Uint8Array([1, 2, 3]));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("fileLoader", () => {
	test("reads relative paths and file: URLs under the root", async () => {
		const load = fileLoader({ root });
		expect([...(await load("fonts/a.bin"))]).toEqual([1, 2, 3]);
		expect([...(await load("./fonts/../fonts/a.bin"))]).toEqual([1, 2, 3]);
		const url = pathToFileURL(join(root, "fonts", "a.bin")).href;
		expect([...(await load(url))]).toEqual([1, 2, 3]);
	});

	test("refuses paths outside the root", async () => {
		const load = fileLoader({ root: join(root, "fonts") });
		await expect(load("../outside.bin")).rejects.toThrow(/outside the loader root/);
		await expect(load(pathToFileURL(join(root, "x.bin")).href)).rejects.toThrow(
			/outside the loader root/,
		);
	});

	test("passes other URLs to the next loader", async () => {
		const seen: string[] = [];
		const load = fileLoader({
			root,
			next: async (src) => {
				seen.push(src);
				return new Uint8Array([9]);
			},
		});
		await load("https://example.com/a.png");
		await load("data:,x");
		expect(seen).toEqual(["https://example.com/a.png", "data:,x"]);
	});

	test("decodes data: URLs through the default next loader", async () => {
		const load = fileLoader({ root });
		expect([...(await load("data:;base64,AQID"))]).toEqual([1, 2, 3]);
	});

	test("a headless env paints a local font file", async () => {
		const ck = await loadCanvasKit();
		const env = createHeadlessEnv({
			load: fileLoader({ root: dirname(testFontPath("Geist-Regular.ttf")) }),
		});
		const commands: Command[] = [
			{ op: "createCanvas", width: 4, height: 4 },
			{
				op: "loadFonts",
				requests: [
					{
						family: "Geist",
						descriptor: {
							kind: "local",
							family: "Geist",
							files: [
								{ src: "Geist-Regular.ttf", weight: 400, style: "normal" },
							],
						},
					},
				],
			},
		];
		const result = (await env.paint(commands, ck)) as EncodedPaintResult;
		expect(result.warnings).toEqual([]);
	});
});
