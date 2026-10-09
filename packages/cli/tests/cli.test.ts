import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { packTemplate } from "@freshcoat-js/coatfile/coat";
import { decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { unzipSync } from "fflate";
import { version } from "../src/main";
import { card, type Sandbox, sandbox, workspaceBytes, workspaceOf } from "./helpers";

let box: Sandbox;
let ck: Awaited<ReturnType<typeof loadCanvasKit>>;

beforeAll(async () => {
	box = await sandbox();
	ck = await loadCanvasKit("full");
	await box.write("badge.json", JSON.stringify(card()));
});

afterAll(() => box.cleanup());

async function size(path: string): Promise<[number, number]> {
	const pixels = decodePixels(ck, new Uint8Array(await readFile(path)));
	if (!pixels) throw new Error(`${path} did not decode`);
	return [pixels.width, pixels.height];
}

describe("render", () => {
	test("writes a file per frame at the template's size", async () => {
		const run = await box.run("render", "badge.json", "--out", "png");
		expect(run.code).toBe(0);
		expect(run.stdout.split("\n").filter(Boolean)).toEqual([
			"png/front.png",
			"png/back.png",
		]);
		expect(run.stderr).toBe("");
		expect(await size(box.path("png", "front.png"))).toEqual([200, 100]);
		expect(await size(box.path("png", "back.png"))).toEqual([200, 100]);
	});

	test("reads relative images and the font through the fake network", async () => {
		const run = await box.run("render", "badge.json", "--out", "imgs");
		expect(run.stderr).not.toContain("image_load_failed");
		expect(box.fetch.urls).toContain("https://fonts.example/inter.ttf");
		const pixels = decodePixels(
			ck,
			new Uint8Array(await readFile(box.path("imgs", "front.png"))),
		);
		const at = (170 + 70 * 200) * 4;
		expect([...(pixels?.data.slice(at, at + 3) ?? [])]).toEqual([20, 160, 60]);
	});

	test("scales, picks frames and names files by suffix", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--frame",
			"back",
			"--scale",
			"1",
			"--scale",
			"2",
			"--out",
			"scaled",
		);
		expect(run.code).toBe(0);
		expect((await readdir(box.path("scaled"))).sort()).toEqual([
			"back.png",
			"back@2x.png",
		]);
		expect(await size(box.path("scaled", "back@2x.png"))).toEqual([400, 200]);
	});

	test("encodes jpeg and webp", async () => {
		for (const [format, extension] of [
			["jpeg", "jpg"],
			["webp", "webp"],
		] as const) {
			const run = await box.run(
				"render",
				"badge.json",
				"--format",
				format,
				"--frame",
				"front",
				"--out",
				format,
			);
			expect(run.code).toBe(0);
			expect(await size(box.path(format, `front.${extension}`))).toEqual([
				200, 100,
			]);
		}
	});

	test("renders a variant at its own size", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--variant",
			"wide",
			"--frame",
			"front",
			"--out",
			"wide",
		);
		expect(run.code).toBe(0);
		expect(await size(box.path("wide", "front.png"))).toEqual([400, 200]);
	});

	test("takes values from a file and --set over it", async () => {
		await box.write("values.json", JSON.stringify({ name: "Ben", motto: "Hi" }));
		const run = await box.run(
			"render",
			"badge.json",
			"--values",
			"values.json",
			"--set",
			"name=Cleo",
			"--frame",
			"front",
			"--out",
			"values",
		);
		expect(run.code).toBe(0);
		expect(await size(box.path("values", "front.png"))).toEqual([200, 100]);
	});

	test("renders a .coat package", async () => {
		await box.write("badge.coat", await packTemplate(card()));
		const run = await box.run("render", "badge.coat", "--out", "packaged");
		expect(run.code).toBe(0);
		expect(await readdir(box.path("packaged"))).toHaveLength(2);
	});

	test("warns about guessed and missing fonts, and hides it when quiet", async () => {
		const undeclared = card({ fonts: undefined });
		await box.write("guess.json", JSON.stringify(undeclared));
		const run = await box.run("render", "guess.json", "--out", "guess");
		expect(run.code).toBe(0);
		expect(run.stderr).toContain("warning: no font data for Inter");
		const quiet = await box.run("render", "guess.json", "--out", "guess", "-q");
		expect(quiet.stderr).toBe("");
		expect(quiet.stdout).toContain("guess/front.png");
	});

	test("loads a declared local font without the network", async () => {
		await box.write("Geist.ttf", testFontBytes("Geist-Regular.ttf"));
		const local = card({
			fonts: [
				{
					kind: "local",
					family: "Inter",
					files: [{ weight: 400, src: "Geist.ttf" }],
				},
			],
		});
		await box.write("local.json", JSON.stringify(local));
		const before = box.fetch.urls.length;
		const run = await box.run("render", "local.json", "--out", "local");
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
		expect(box.fetch.urls).toHaveLength(before);
	});

	test("warns when an image cannot load", async () => {
		const broken = card();
		for (const frame of broken.template_data)
			for (const element of frame.elements)
				if (element.type === "image") element.properties.src = "missing.png";
		await box.write("broken.json", JSON.stringify(broken));
		const run = await box.run("render", "broken.json", "--out", "broken");
		expect(run.code).toBe(0);
		expect(run.stderr).toContain("warning: front: image_load_failed");
	});

	test("refuses bad input", async () => {
		const cases: [string[], number, string][] = [
			[["render"], 2, "missing required argument 'template'"],
			[["render", "a.json", "b.json"], 2, "too many arguments for 'render'"],
			[["render", "badge.json", "--format", "gif"], 2, "Allowed choices are png, jpeg, jpg, webp"],
			[["render", "badge.json", "--scale", "0"], 2, "Expected a positive number"],
			[["render", "badge.json", "--set", "name"], 2, "Expected key=value"],
			[["render", "badge.json", "--bogus"], 2, "unknown option '--bogus'"],
			[["render", "badge.json", "--out"], 2, "option '--out <dir>' argument missing"],
			[["render", "nope.json"], 1, "cannot read nope.json: no such file"],
			[["render", "badge.json", "--variant", "tall"], 1, 'no variant "tall"; the template has wide'],
			[["render", "badge.json", "--frame", "side"], 1, 'no frame "side"; the template has front, back'],
			[["render", "badge.json", "--set", "age=3"], 1, 'no field "age"; its fields are name, motto'],
			[["render", "badge.json", "--set", "name="], 1, "name is required"],
		];
		for (const [argv, code, message] of cases) {
			const run = await box.run(...argv);
			expect({ argv, code: run.code }).toEqual({ argv, code });
			expect(run.stderr).toContain(message);
			expect(run.stdout).toBe("");
		}
	});

	test("rejects values that are not a JSON object", async () => {
		await box.write("list.json", "[1]");
		await box.write("bad.json", "{");
		const list = await box.run("render", "badge.json", "--values", "list.json");
		expect(list.code).toBe(1);
		expect(list.stderr).toContain("must hold a JSON object");
		const bad = await box.run("render", "badge.json", "--values", "bad.json");
		expect(bad.code).toBe(1);
		expect(bad.stderr).toContain("bad.json is not valid JSON");
	});
});

describe("validate", () => {
	test("accepts a valid template", async () => {
		const run = await box.run("validate", "badge.json");
		expect(run).toEqual({ code: 0, stdout: "badge.json is valid\n", stderr: "" });
		expect((await box.run("validate", "badge.json", "-q")).stdout).toBe("");
	});

	test("lists each issue of an invalid one and exits 1", async () => {
		await box.write(
			"invalid.json",
			JSON.stringify({ ...card(), width: -1, template_data: [] }),
		);
		const run = await box.run("validate", "invalid.json");
		expect(run.code).toBe(1);
		expect(run.stdout).toBe("");
		expect(run.stderr).toContain("invalid.json is not a valid template (");
		expect(run.stderr).toMatch(/\n {2}\/width: .*\(.+\)/);
		expect(run.stderr).toContain("/template_data");
	});

	test("reports a file that is not JSON", async () => {
		await box.write("garbage.json", "not json");
		const run = await box.run("validate", "garbage.json");
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("garbage.json:");
	});
});

describe("inspect", () => {
	test("prints a JSON summary", async () => {
		const run = await box.run("inspect", "badge.json", "--json");
		expect(run.code).toBe(0);
		expect(JSON.parse(run.stdout)).toEqual({
			file: "badge.json",
			id: "badge",
			name: "Badge",
			formatVersion: "1.6",
			width: 200,
			height: 100,
			frames: [
				{ name: "front", width: 200, height: 100, elements: 2 },
				{ name: "back", width: 200, height: 100, elements: 2 },
			],
			fields: [
				{ key: "name", type: "string", title: "Name", required: true, default: "Ana" },
				{ key: "motto", type: "string", required: false },
			],
			variants: [{ id: "wide", label: "Wide", width: 400, height: 200 }],
			fonts: [{ family: "Inter", declared: true, weights: [400], italic: false }],
		});
	});

	test("prints readable text", async () => {
		const run = await box.run("inspect", "badge.json");
		expect(run.stdout).toContain("Badge (badge)");
		expect(run.stdout).toContain("  front  200 x 100  2 elements");
		expect(run.stdout).toContain('  name  string, required, default "Ana"');
		expect(run.stdout).toContain("  wide  Wide  400 x 200");
		expect(run.stdout).toContain("  Inter  400  declared");
	});

	test("fails on an invalid template", async () => {
		const run = await box.run("inspect", "invalid.json");
		expect(run.code).toBe(1);
		expect(run.stdout).toBe("");
	});
});

describe("export", () => {
	let workspace: string;
	beforeAll(async () => {
		workspace = await box.write(
			"badges.coatworkspace",
			await workspaceBytes(workspaceOf(card())),
		);
	});

	test("writes a zip and prints a summary", async () => {
		const run = await box.run(
			"export",
			"badges.coatworkspace",
			"--preset",
			"All badges",
			"--out",
			"exports/badges.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toMatch(
			/^4 of 4 items exported to exports\/badges\.zip \(.+ KB, \d+\.\ds\)\n$/,
		);
		expect(run.stderr).toContain("rendered 4/4");
		const zip = unzipSync(
			new Uint8Array(await readFile(box.path("exports", "badges.zip"))),
		);
		expect(Object.keys(zip).filter((name) => name.endsWith(".png")).sort()).toEqual([
			"1-back.png",
			"1-front.png",
			"2-back.png",
			"2-front.png",
		]);
		expect(Object.keys(zip)).toHaveLength(5);
		expect(decodePixels(ck, zip["1-front.png"] as Uint8Array)?.width).toBe(200);
	});

	test("writes a PDF by preset id", async () => {
		const run = await box.run(
			"export",
			"badges.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"proof.pdf",
			"--quiet",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
		const bytes = await readFile(box.path("proof.pdf"));
		expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
	});

	test("warns about characters the fonts cannot draw", async () => {
		const workspace = workspaceOf(card());
		const [dataset] = workspace.datasets;
		if (dataset) dataset.records[1]!.values.name = "김민준";
		await box.write("hangul.coatworkspace", await workspaceBytes(workspace));
		const run = await box.run(
			"export",
			"hangul.coatworkspace",
			"--preset",
			"p_png",
			"--out",
			"hangul.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: the fonts have no glyphs for U+AE40 U+BBFC U+C900 in 1 record",
		);
	});

	test("lists the presets when one is not found", async () => {
		const run = await box.run(
			"export",
			workspace,
			"--preset",
			"Nope",
			"--out",
			"x.zip",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain('no preset "Nope"');
		expect(run.stderr).toContain("All badges  (p_png)");
		await expect(readFile(box.path("x.zip"))).rejects.toThrow();
	});

	test("reports unreadable and missing workspaces", async () => {
		await box.write("junk.coatworkspace", "not a zip");
		const junk = await box.run("export", "junk.coatworkspace", "--preset", "a", "--out", "x.zip");
		expect(junk.code).toBe(1);
		expect(junk.stderr).toContain("junk.coatworkspace:");
		const missing = await box.run("export", "gone.coatworkspace", "--preset", "a", "--out", "x.zip");
		expect(missing.code).toBe(1);
		expect(missing.stderr).toContain("cannot read gone.coatworkspace: no such file");
	});

	test("requires a preset and an output", async () => {
		const noPreset = await box.run("export", "badges.coatworkspace", "--out", "x.zip");
		expect(noPreset.code).toBe(2);
		expect(noPreset.stderr).toContain("required option '--preset <name|id>' not specified");
		const noOut = await box.run("export", "badges.coatworkspace", "--preset", "p_png");
		expect(noOut.code).toBe(2);
		expect(noOut.stderr).toContain("required option '--out <path>' not specified");
	});
});

describe("the command line", () => {
	test("prints the package version", async () => {
		const run = await box.run("--version");
		expect(run).toEqual({ code: 0, stdout: `${version()}\n`, stderr: "" });
		expect(version()).toMatch(/^\d+\.\d+\.\d+/);
	});

	test("prints help for the tool and each command", async () => {
		const overview = await box.run("--help");
		expect(overview.code).toBe(0);
		for (const name of ["render", "validate", "inspect", "export"])
			expect(overview.stdout).toContain(`  ${name}`);
		for (const name of ["render", "validate", "inspect", "export"]) {
			const flag = await box.run(name, "--help");
			const word = await box.run("help", name);
			expect(flag.code).toBe(0);
			expect(flag.stdout).toStartWith(`Usage: freshcoat ${name}`);
			expect(word.stdout).toBe(flag.stdout);
		}
	});

	test("rejects a missing or unknown command", async () => {
		const none = await box.run();
		expect(none.code).toBe(2);
		expect(none.stderr).toContain("Usage: freshcoat <command>");
		const unknown = await box.run("paint");
		expect(unknown.code).toBe(2);
		expect(unknown.stderr).toContain("unknown command 'paint'");
		const topic = await box.run("help", "paint");
		expect(topic.code).toBe(2);
	});

	test("points a usage error at the command's help", async () => {
		const run = await box.run("inspect");
		expect(run.code).toBe(2);
		expect(run.stderr).toContain("freshcoat: missing required argument 'template'");
		expect(run.stderr).toContain("Run freshcoat inspect --help for usage.");
	});
});
