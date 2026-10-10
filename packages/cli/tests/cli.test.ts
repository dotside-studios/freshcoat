import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { packTemplate } from "@freshcoat-js/coatfile/coat";
import { decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { unzipSync } from "fflate";
import { version } from "../src/main";
import {
	card,
	type Sandbox,
	sandbox,
	solidPng,
	workspaceBytes,
	workspaceOf,
} from "./helpers";

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

describe("render a template", () => {
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
		expect(run.stderr).toContain("warning: front: Couldn't load image: missing.png");
	});

	test("refuses bad input", async () => {
		const cases: [string[], number, string][] = [
			[["render"], 2, "missing required argument 'file'"],
			[["render", "a.json", "b.json"], 2, "too many arguments for 'render'"],
			[["render", "badge.json", "--format", "gif"], 2, "Allowed choices are png, jpeg, jpg, webp"],
			[["render", "badge.json", "--scale", "0"], 2, "Expected a positive number"],
			[["render", "badge.json", "--set", "name"], 2, "Expected key=value"],
			[["render", "badge.json", "--bogus"], 2, "unknown option '--bogus'"],
			[["render", "badge.json", "--out"], 2, "option '--out <path>' argument missing"],
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

	test("points a workspace at render", async () => {
		for (const command of ["inspect", "validate"]) {
			const run = await box.run(command, "club.coatworkspace");
			expect(run.code).toBe(1);
			expect(run.stderr).toBe(
				"freshcoat: club.coatworkspace is a workspace; this command takes a .coat file or template JSON\n",
			);
		}
	});

	test("fails on an invalid template", async () => {
		const run = await box.run("inspect", "invalid.json");
		expect(run.code).toBe(1);
		expect(run.stdout).toBe("");
	});
});

describe("render a template to a zip or PDF", () => {
	test("writes a zip named by frame", async () => {
		const run = await box.run("render", "badge.json", "--out", "one/badge.zip");
		expect(run.code).toBe(0);
		expect(run.stdout).toMatch(/^2 of 2 items exported to one\/badge\.zip /);
		const zip = unzipSync(new Uint8Array(await readFile(box.path("one", "badge.zip"))));
		expect(Object.keys(zip).sort()).toEqual(["back.png", "export-report.csv", "front.png"]);
		expect(decodePixels(ck, zip["front.png"] as Uint8Array)?.width).toBe(200);
	});

	test("writes a PDF", async () => {
		const run = await box.run("render", "badge.json", "--frame", "front", "--out", "badge.pdf", "-q");
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
		const bytes = await readFile(box.path("badge.pdf"));
		expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
	});

	test("checks the values as a directory render does", async () => {
		const run = await box.run("render", "badge.json", "--set", "name=", "--out", "x.zip");
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("name is required");
	});
});

describe("render image values", () => {
	beforeAll(async () => {
		const photo = card({ fonts: undefined });
		photo.fields.properties.photo = { type: "string", format: "image" } as never;
		for (const frame of photo.template_data)
			for (const element of frame.elements)
				if (element.type === "image") element.properties.src = "{{photo}}";
		await mkdir(box.path("templates"), { recursive: true });
		await box.write("templates/photo.json", JSON.stringify(photo));
		await box.write("red.png", await solidPng(4, 4, [200, 20, 20]));
		await mkdir(box.path("vals"), { recursive: true });
		await box.write("vals/green.png", await solidPng(4, 4, [20, 200, 20]));
		await box.write("vals/values.json", JSON.stringify({ photo: "green.png" }));
	});

	async function logoPixel(path: string): Promise<number[]> {
		const pixels = decodePixels(ck, new Uint8Array(await readFile(path)));
		const at = (170 + 70 * 200) * 4;
		return [...(pixels?.data.slice(at, at + 3) ?? [])];
	}

	test("reads a --set photo from the working directory", async () => {
		const run = await box.run("render", "templates/photo.json", "--set", "photo=red.png", "--frame", "front", "--out", "set", "-q");
		expect(run.code).toBe(0);
		expect(await logoPixel(box.path("set", "front.png"))).toEqual([200, 20, 20]);
	});

	test("reads a --values photo from the values file's directory", async () => {
		const run = await box.run("render", "templates/photo.json", "--values", "vals/values.json", "--frame", "front", "--out", "vals-out", "-q");
		expect(run.code).toBe(0);
		expect(await logoPixel(box.path("vals-out", "front.png"))).toEqual([20, 200, 20]);
	});

	test("reads a --set photo into a zip", async () => {
		const run = await box.run("render", "templates/photo.json", "--set", "photo=red.png", "--frame", "front", "--out", "photo.zip", "-q");
		expect(run.code).toBe(0);
		const zip = unzipSync(new Uint8Array(await readFile(box.path("photo.zip"))));
		const pixels = decodePixels(ck, zip["front.png"] as Uint8Array);
		const at = (170 + 70 * 200) * 4;
		expect([...(pixels?.data.slice(at, at + 3) ?? [])]).toEqual([200, 20, 20]);
	});

	test("refuses a photo that is not there", async () => {
		const run = await box.run("render", "templates/photo.json", "--set", "photo=gone.png", "--out", "gone");
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("cannot read gone.png: no such file");
	});

	test("says nothing about an empty optional photo", async () => {
		const run = await box.run("render", "templates/photo.json", "--out", "empty");
		expect(run.code).toBe(0);
		expect(run.stderr).not.toContain("image");
	});
});

describe("render glyph warnings", () => {
	test("names the characters the fonts cannot draw", async () => {
		const run = await box.run("render", "badge.json", "--set", "name=김민준", "--out", "hangul");
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: the fonts have no glyphs for U+AE40 U+BBFC U+C900 in front, back; they print as boxes",
		);
	});
});

describe("render a template with --data", () => {
	beforeAll(async () => {
		await box.write("people.csv", "Name,Motto,Team\nAna,Hi,Red\nBen,Yo,Blue\n");
	});

	async function unzip(path: string): Promise<Record<string, Uint8Array>> {
		return unzipSync(new Uint8Array(await readFile(path)));
	}

	test("writes a zip with an image per row and frame", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--out",
			"batch/people.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toMatch(/^4 of 4 items exported to batch\/people\.zip /);
		expect(run.stderr).toContain("warning: people.csv: no field matches the column Team");
		expect(Object.keys(await unzip(box.path("batch", "people.zip"))).sort()).toEqual([
			"badge-1-back.png",
			"badge-1-front.png",
			"badge-2-back.png",
			"badge-2-front.png",
			"export-report.csv",
		]);
	});

	test("takes frames, a variant, a scale, a format and constants", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--frame",
			"front",
			"--variant",
			"wide",
			"--scale",
			"2",
			"--format",
			"webp",
			"--set",
			"motto=Same",
			"--out",
			"wide.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
		const zip = await unzip(box.path("wide.zip"));
		expect(Object.keys(zip).filter((name) => name.endsWith(".webp")).sort()).toEqual([
			"badge-1-front@2x.webp",
			"badge-2-front@2x.webp",
		]);
		expect(decodePixels(ck, zip["badge-1-front@2x.webp"] as Uint8Array)?.width).toBe(800);
	});

	test("writes a PDF", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--out",
			"people.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		const bytes = await readFile(box.path("people.pdf"));
		expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
	});

	test("loads photos named in the data from its directory", async () => {
		const photo = card();
		photo.fields.properties.photo = { type: "string", format: "image" } as never;
		for (const frame of photo.template_data)
			for (const element of frame.elements)
				if (element.type === "image") element.properties.src = "{{photo}}";
		await box.write("photo.json", JSON.stringify(photo));
		await mkdir(box.path("rows", "pics"), { recursive: true });
		await writeFile(
			box.path("rows", "pics", "blue.png"),
			await solidPng(4, 4, [20, 40, 200]),
		);
		await box.write("rows/people.csv", "name,photo\nAna,pics/blue.png\nBen,pics/gone.png\n");
		const run = await box.run(
			"render",
			"photo.json",
			"--data",
			"rows/people.csv",
			"--frame",
			"front",
			"--out",
			"photos.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain("rows/people.csv: row 3, photo: No photo named pics/gone.png");
		const zip = await unzip(box.path("photos.zip"));
		const pixels = decodePixels(ck, zip["badge-1-front.png"] as Uint8Array);
		const at = (170 + 70 * 200) * 4;
		expect([...(pixels?.data.slice(at, at + 3) ?? [])]).toEqual([20, 40, 200]);
	});

	test("warns about required fields no column fills", async () => {
		await box.write("mottos.csv", "motto\nHi\n");
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"mottos.csv",
			"--out",
			"mottos.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"no column or --set fills the required field name; it uses its default",
		);
	});

	test("refuses bad data and options", async () => {
		await box.write("empty.csv", "name\n");
		await box.write("people.dat", "name\nAna\n");
		const data = ["render", "badge.json", "--data"];
		const cases: [string[], number, string][] = [
			[[...data, "people.csv"], 2, "--data needs --out <file.zip|file.pdf>"],
			[[...data, "people.csv", "--out", "dir"], 2, "--data needs --out <file.zip|file.pdf>"],
			[[...data, "people.csv", "--out", "x.zip", "--scale", "1", "--scale", "2"], 2, "a .zip or .pdf takes one --scale"],
			[[...data, "people.csv", "--out", "x.pdf", "--format", "jpeg"], 2, "--format applies only to a zip"],
			[["render", "a.coatworkspace", "--data", "people.csv", "--preset", "p", "--out", "x.zip"], 2, "--data applies only to templates"],
			[[...data, "none.csv", "--out", "x.zip"], 1, "cannot read none.csv: no such file"],
			[[...data, "empty.csv", "--out", "x.zip"], 1, "empty.csv has no records"],
			[[...data, "people.dat", "--out", "x.zip"], 1, "people.dat: .dat is not a table"],
		];
		for (const [argv, code, message] of cases) {
			const run = await box.run(...argv);
			expect({ argv, code: run.code }).toEqual({ argv, code });
			expect(run.stderr).toContain(message);
			expect(run.stdout).toBe("");
		}
	});
});

describe("render a workspace", () => {
	let workspace: string;
	beforeAll(async () => {
		workspace = await box.write(
			"badges.coatworkspace",
			await workspaceBytes(workspaceOf(card())),
		);
	});

	test("writes a zip and prints a summary", async () => {
		const run = await box.run(
			"render",
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
			"render",
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
			"render",
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
			"render",
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
		const junk = await box.run("render", "junk.coatworkspace", "--preset", "a", "--out", "x.zip");
		expect(junk.code).toBe(1);
		expect(junk.stderr).toContain("junk.coatworkspace:");
		const missing = await box.run("render", "gone.coatworkspace", "--preset", "a", "--out", "x.zip");
		expect(missing.code).toBe(1);
		expect(missing.stderr).toContain("cannot read gone.coatworkspace: no such file");
	});

	test("lists the presets when none is given", async () => {
		const run = await box.run("render", "badges.coatworkspace", "--out", "x.zip");
		expect(run.code).toBe(2);
		expect(run.stderr).toBe(
			"freshcoat: a .coatworkspace needs --preset <name|id>\nPresets:\n  All badges  (p_png)\n  Proof  (p_pdf)\n",
		);
	});

	test("refuses options that do not fit the file", async () => {
		const cases: [string[], string][] = [
			[["render", "badges.coatworkspace", "--preset", "p_png"], "a .coatworkspace needs --out <path>"],
			[
				["render", "badges.coatworkspace", "--preset", "p_png", "--out", "x.zip", "--scale", "2", "--format", "webp"],
				"--scale, --format apply only to templates",
			],
			[["render", "badge.json", "--preset", "p_png"], "--preset needs a .coatworkspace file"],
		];
		for (const [argv, message] of cases) {
			const run = await box.run(...argv);
			expect({ argv, code: run.code }).toEqual({ argv, code: 2 });
			expect(run.stderr).toContain(`freshcoat: ${message}`);
			expect(run.stderr).toContain("Run freshcoat render --help for usage.");
			expect(run.stdout).toBe("");
		}
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
		for (const name of ["render", "validate", "inspect"])
			expect(overview.stdout).toContain(`  ${name}`);
		for (const name of ["render", "validate", "inspect"]) {
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
