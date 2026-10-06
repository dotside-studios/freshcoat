import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkLinks, slugOf } from "./check-links.ts";

let root: string;

function write(path: string, text: string) {
	const full = join(root, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, text);
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "check-links-"));
	write(
		"README.md",
		[
			"# Title",
			"",
			"See [the guide](docs/guide.md), [its setup](docs/guide.md#set-up-bun),",
			"[the format](docs/guide.md#the-coatworkspace-format), [here](#title),",
			"![a picture](docs/shot.png), <https://example.com> and [the web](https://example.com/x.md).",
			"",
			"```md",
			"[an example](nowhere.md)",
			"```",
			"",
			"Inline `[code](nowhere.md)` is not a link.",
			"",
			"[ref]: docs/guide.md",
		].join("\n"),
	);
	write(
		"docs/guide.md",
		"# Guide\n\n## Set up Bun\n\n## The `.coatworkspace` format\n\nBack to [the readme](../README.md).\n",
	);
	write("docs/shot.png", "");
	write("node_modules/pkg/README.md", "[broken](missing.md)\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("check-links", () => {
	test("accepts files, anchors, images and reference links that resolve", () => {
		expect(checkLinks(root)).toEqual([]);
	});

	test("reports a missing file and a missing heading, with the line", () => {
		write(
			"docs/broken.md",
			"# Broken\n\n[gone](moved.md)\n[no anchor](guide.md#nowhere)\n",
		);
		try {
			expect(checkLinks(root)).toEqual([
				{
					file: join("docs", "broken.md"),
					line: 3,
					target: "moved.md",
					reason: "no such file",
				},
				{
					file: join("docs", "broken.md"),
					line: 4,
					target: "guide.md#nowhere",
					reason: "no heading #nowhere",
				},
			]);
		} finally {
			rmSync(join(root, "docs/broken.md"));
		}
	});

	test("slugs headings as GitHub does", () => {
		expect(slugOf("The `.coatworkspace` format")).toBe(
			"the-coatworkspace-format",
		);
		expect(slugOf("1. A5 paper for sheets")).toBe("1-a5-paper-for-sheets");
		expect(slugOf("Add a UI kit component")).toBe("add-a-ui-kit-component");
		expect(slugOf("Half ½ size")).toBe("half--size");
	});

	test("every relative link in Freshcoat's own docs resolves", () => {
		expect(checkLinks(join(import.meta.dir, ".."))).toEqual([]);
	});
});
