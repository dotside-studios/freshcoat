import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { Template } from "@freshcoat-js/coatfile";
import { decodeTemplate, packTemplate } from "@freshcoat-js/coatfile/coat";
import { decodePixels } from "@freshcoat-js/engine";
import { SRGB_PROFILE } from "@freshcoat-js/engine/icc";
import { PRINT_TARGETS } from "@freshcoat-js/for-print";
import {
	iccProfile,
	loadCanvasKit,
	testFontBytes,
} from "@freshcoat-js/test-utils";
import { DEFAULT_SHEET_LAYOUT, type Workspace } from "@freshcoat-js/workspace";
import { REPORT_FILE_NAME } from "@freshcoat-js/workspace/export";
import { unzipSync } from "fflate";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	type PDFHexString,
	PDFName,
	PDFRawStream,
} from "pdf-lib";
import { version } from "../src/main";
import { poolSize } from "../src/worker-pool";
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

	test("keeps the alpha channel of an opaque frame with --png-alpha keep", async () => {
		await box.write("icon.coat", await packTemplate(card()));
		const colourType = async (path: string) => (await readFile(path))[25];
		const plain = await box.run(
			"render",
			"icon.coat",
			"--frame",
			"front",
			"--out",
			"plain",
		);
		expect(plain.code).toBe(0);
		expect(await colourType(box.path("plain", "front.png"))).toBe(2);
		const kept = await box.run(
			"render",
			"icon.coat",
			"--png-alpha",
			"keep",
			"--frame",
			"front",
			"--out",
			"kept",
		);
		expect(kept.code).toBe(0);
		expect(await colourType(box.path("kept", "front.png"))).toBe(6);
		const zipped = await box.run(
			"render",
			"icon.coat",
			"--png-alpha",
			"keep",
			"--frame",
			"front",
			"--out",
			"kept.zip",
			"-q",
		);
		expect(zipped.code).toBe(0);
		const unzipped = unzipSync(
			new Uint8Array(await readFile(box.path("kept.zip"))),
		);
		expect(unzipped["front.png"]?.[25]).toBe(6);
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
		await box.write(
			"values.json",
			JSON.stringify({ name: "Ben", motto: "Hi" }),
		);
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
		expect(run.stderr).toContain(
			"warning: front: Couldn't load image: missing.png",
		);
	});

	test("refuses bad input", async () => {
		const cases: [string[], number, string][] = [
			[["render"], 2, "missing required argument 'file'"],
			[["render", "a.json", "b.json"], 2, "too many arguments for 'render'"],
			[
				["render", "badge.json", "--format", "gif"],
				2,
				"Allowed choices are png, jpeg, jpg, webp",
			],
			[
				["render", "badge.json", "--scale", "0"],
				2,
				"Expected a number from 1 to 4",
			],
			[
				["render", "badge.json", "--scale", "0.5"],
				2,
				"Expected a number from 1 to 4",
			],
			[["render", "badge.json", "--set", "name"], 2, "Expected key=value"],
			[["render", "badge.json", "--bogus"], 2, "unknown option '--bogus'"],
			[
				["render", "badge.json", "--out"],
				2,
				"option '--out <path>' argument missing",
			],
			[["render", "nope.json"], 1, "cannot read nope.json: no such file"],
			[
				["render", "badge.json", "--variant", "tall"],
				1,
				'no variant "tall"; the template has wide',
			],
			[
				["render", "badge.json", "--frame", "side"],
				1,
				'no frame "side"; the template has front, back',
			],
			[
				["render", "badge.json", "--set", "age=3"],
				1,
				'no field "age"; its fields are name, motto',
			],
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
		expect(run).toEqual({
			code: 0,
			stdout: "badge.json is valid\n",
			stderr: "",
		});
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

describe("a template module", () => {
	const source = `import { defineTemplate } from "${import.meta.resolve("@freshcoat-js/coatfile")}";
const base = ${JSON.stringify(card())};
console.log("building");
export default defineTemplate(async () => ({ ...base, name: "Scripted" }));
`;

	test("renders what its default export resolves to", async () => {
		await box.write("scripted.coat.ts", source);
		const run = await box.run(
			"render",
			"scripted.coat.ts",
			"--frame",
			"front",
			"--out",
			"scripted",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toBe("scripted/front.png\n");
		expect(run.stderr).toContain("building");
		expect(await size(box.path("scripted", "front.png"))).toEqual([200, 100]);
		const inspected = await box.run("inspect", "scripted.coat.ts");
		expect(inspected.stdout).toContain("Scripted (badge)");
	});

	test("takes a template export from another runtime", async () => {
		await box.write(
			"named.mjs",
			`export const template = ${JSON.stringify(card())};`,
		);
		const before = process.env.FRESHCOAT_RUNTIME;
		process.env.FRESHCOAT_RUNTIME = "node";
		try {
			const run = await box.run("validate", "named.mjs");
			expect(run).toEqual({
				code: 0,
				stdout: "named.mjs is valid\n",
				stderr: "",
			});
		} finally {
			if (before === undefined) delete process.env.FRESHCOAT_RUNTIME;
			else process.env.FRESHCOAT_RUNTIME = before;
		}
	});

	test("reports a module without a template", async () => {
		await box.write("empty.mjs", "export const x = 1;");
		const run = await box.run("validate", "empty.mjs");
		expect(run.code).toBe(1);
		expect(run.stderr).toBe(
			"freshcoat: empty.mjs: the module has no default or template export\n",
		);
		await box.write("array.mjs", "export default [];");
		expect((await box.run("validate", "array.mjs")).stderr).toContain(
			"the module's export is not a template object",
		);
	});

	test("reports what the script threw", async () => {
		await box.write("throws.mjs", 'throw new Error("no data");');
		const run = await box.run("validate", "throws.mjs");
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			"throws.mjs: evaluating the module failed with code 1",
		);
		expect(run.stderr).toContain("no data");
	});

	test("validates the JSON it produces", async () => {
		await box.write(
			"invalid.mjs",
			`export default { ...${JSON.stringify(card())}, width: -1 };`,
		);
		const run = await box.run("validate", "invalid.mjs");
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("invalid.mjs is not a valid template (");
	});
});

describe("reading a template as Studio opens it", () => {
	function duplicated(): Template {
		const base = card();
		return {
			...base,
			template_data: base.template_data.map((frame) => ({
				...frame,
				elements: frame.elements.map((el) => ({ ...el, id: "shared" })),
			})),
		} as Template;
	}

	test("heals duplicate element ids and warns", async () => {
		await box.write("dupes.json", JSON.stringify(duplicated()));
		for (const argv of [
			["render", "dupes.json", "--out", "dupes"],
			["inspect", "dupes.json"],
			["validate", "dupes.json"],
			["pack", "dupes.json", "--out", "dupes.coat"],
		]) {
			const run = await box.run(...argv);
			expect(run.code).toBe(0);
			expect(run.stderr).toMatch(
				/warning: dupes\.json: renamed duplicate element ids? /,
			);
			expect((await box.run(...argv, "-q")).stderr).toBe("");
		}
	});

	test("still refuses a file that does not validate healed", async () => {
		await box.write(
			"worse.json",
			JSON.stringify({ ...duplicated(), width: -1 }),
		);
		const run = await box.run("render", "worse.json", "--out", "worse");
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("worse.json is not a valid template (");
	});

	test("warns about a newer format on every command that reads a template", async () => {
		await box.write(
			"newer.json",
			JSON.stringify(card({ format_version: "1.99" } as never)),
		);
		for (const argv of [
			["render", "newer.json", "--out", "newer"],
			["inspect", "newer.json"],
			["pack", "newer.json", "--out", "newer.coat"],
		]) {
			const run = await box.run(...argv);
			expect(run.stderr).toContain(
				"warning: newer.json: format_version 1.99 is newer than this freshcoat reads; fields it adds are ignored",
			);
		}
		const checked = await box.run("validate", "newer.json");
		expect(
			checked.stderr.match(/is newer than this freshcoat reads/g),
		).toHaveLength(1);
	});

	test("warns about assets not keyed by their bytes", async () => {
		const mis = card({
			assets: [
				{ sha256: "deadbeef", base64: "AAAA", contentType: "image/png" },
			],
		} as never);
		await box.write("miskeyed.json", JSON.stringify(mis));
		const run = await box.run("inspect", "miskeyed.json");
		expect(run.stderr).toContain(
			"warning: miskeyed.json: asset deadbeef is not keyed by the hash of its bytes",
		);
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
				{
					key: "name",
					type: "string",
					title: "Name",
					required: true,
					default: "Ana",
				},
				{ key: "motto", type: "string", required: false },
			],
			variants: [{ id: "wide", label: "Wide", width: 400, height: 200 }],
			fonts: [
				{ family: "Inter", declared: true, weights: [400], italic: false },
			],
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

describe("render a template to a zip or PDF", () => {
	test("writes a zip named by frame", async () => {
		const run = await box.run("render", "badge.json", "--out", "one/badge.zip");
		expect(run.code).toBe(0);
		expect(run.stdout).toMatch(/^2 of 2 items exported to one\/badge\.zip /);
		const zip = unzipSync(
			new Uint8Array(await readFile(box.path("one", "badge.zip"))),
		);
		expect(Object.keys(zip).sort()).toEqual([
			"back.png",
			"export-report.csv",
			"front.png",
		]);
		expect(decodePixels(ck, zip["front.png"] as Uint8Array)?.width).toBe(200);
	});

	test("writes a PDF", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--frame",
			"front",
			"--out",
			"badge.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
		const bytes = await readFile(box.path("badge.pdf"));
		expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
	});

	test("checks the values as a directory render does", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--set",
			"name=",
			"--out",
			"x.zip",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("name is required");
	});
});

describe("render image values", () => {
	beforeAll(async () => {
		const photo = card({ fonts: undefined });
		photo.fields.properties.photo = {
			type: "string",
			format: "image",
		} as never;
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
		const run = await box.run(
			"render",
			"templates/photo.json",
			"--set",
			"photo=red.png",
			"--frame",
			"front",
			"--out",
			"set",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(await logoPixel(box.path("set", "front.png"))).toEqual([
			200, 20, 20,
		]);
	});

	test("reads a --values photo from the values file's directory", async () => {
		const run = await box.run(
			"render",
			"templates/photo.json",
			"--values",
			"vals/values.json",
			"--frame",
			"front",
			"--out",
			"vals-out",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(await logoPixel(box.path("vals-out", "front.png"))).toEqual([
			20, 200, 20,
		]);
	});

	test("reads a --set photo into a zip", async () => {
		const run = await box.run(
			"render",
			"templates/photo.json",
			"--set",
			"photo=red.png",
			"--frame",
			"front",
			"--out",
			"photo.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		const zip = unzipSync(
			new Uint8Array(await readFile(box.path("photo.zip"))),
		);
		const pixels = decodePixels(ck, zip["front.png"] as Uint8Array);
		const at = (170 + 70 * 200) * 4;
		expect([...(pixels?.data.slice(at, at + 3) ?? [])]).toEqual([200, 20, 20]);
	});

	test("refuses a photo that is not there", async () => {
		const run = await box.run(
			"render",
			"templates/photo.json",
			"--set",
			"photo=gone.png",
			"--out",
			"gone",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("cannot read gone.png: no such file");
	});

	test("says nothing about an empty optional photo", async () => {
		const run = await box.run(
			"render",
			"templates/photo.json",
			"--out",
			"empty",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).not.toContain("image");
	});

	test("warns for a photo that prints below the minimum DPI", async () => {
		const run = await box.run(
			"render",
			"templates/photo.json",
			"--set",
			"photo=red.png",
			"--frame",
			"front",
			"--out",
			"low-dpi",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: front: Image prints at 30 DPI, under 300: front_logo",
		);
		const off = await box.run(
			"render",
			"templates/photo.json",
			"--set",
			"photo=red.png",
			"--frame",
			"front",
			"--out",
			"low-dpi",
			"--min-dpi",
			"0",
		);
		expect(off.stderr).not.toContain("DPI");
		const lower = await box.run(
			"render",
			"templates/photo.json",
			"--set",
			"photo=red.png",
			"--frame",
			"front",
			"--out",
			"low-dpi",
			"--min-dpi",
			"20",
		);
		expect(lower.stderr).not.toContain("DPI");
	});

	test("measures a photo at --dpi", async () => {
		const base = [
			"render",
			"templates/photo.json",
			"--set",
			"photo=red.png",
			"--frame",
			"front",
			"--out",
			"dpi",
		];
		expect((await box.run(...base, "--dpi", "150")).stderr).toContain(
			"warning: front: Image prints at 15 DPI, under 300: front_logo",
		);
		expect((await box.run(...base, "--dpi", "3000")).stderr).not.toContain(
			"DPI",
		);
	});

	test("sizes each file as its photo with --size-from and --max-edge", async () => {
		const base = [
			"render",
			"templates/photo.json",
			"--set",
			"photo=red.png",
			"--frame",
			"front",
			"-q",
		];
		const front = async (zip: string) => {
			const pixels = decodePixels(
				ck,
				unzipSync(new Uint8Array(await readFile(box.path(zip))))[
					"front.png"
				] as Uint8Array,
			);
			return [pixels?.width, pixels?.height];
		};
		expect(
			(await box.run(...base, "--size-from", "photo", "--out", "sized.zip"))
				.code,
		).toBe(0);
		expect(await front("sized.zip")).toEqual([4, 4]);
		expect(
			(
				await box.run(
					...base,
					"--size-from",
					"photo",
					"--max-edge",
					"2",
					"--out",
					"capped.zip",
				)
			).code,
		).toBe(0);
		expect(await front("capped.zip")).toEqual([2, 2]);
	});

	test("lists a low-DPI photo in an export's warnings and report", async () => {
		const run = await box.run(
			"render",
			"templates/photo.json",
			"--set",
			"photo=red.png",
			"--frame",
			"front",
			"--out",
			"low-dpi.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: front.png: Image prints at 30 DPI, under 300: front_logo",
		);
		const zip = unzipSync(
			new Uint8Array(await readFile(box.path("low-dpi.zip"))),
		);
		expect(new TextDecoder().decode(zip[REPORT_FILE_NAME])).toContain(
			"Image prints at 30 DPI, under 300: front_logo",
		);
	});
});

describe("render glyph warnings", () => {
	test("names the characters the fonts cannot draw", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--set",
			"name=김민준",
			"--out",
			"hangul",
		);
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
		expect(run.stderr).toContain(
			"warning: people.csv: no field matches the column Team",
		);
		expect(
			Object.keys(await unzip(box.path("batch", "people.zip"))).sort(),
		).toEqual([
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
		expect(
			Object.keys(zip)
				.filter((name) => name.endsWith(".webp"))
				.sort(),
		).toEqual(["badge-1-front@2x.webp", "badge-2-front@2x.webp"]);
		expect(
			decodePixels(ck, zip["badge-1-front@2x.webp"] as Uint8Array)?.width,
		).toBe(800);
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
		photo.fields.properties.photo = {
			type: "string",
			format: "image",
		} as never;
		for (const frame of photo.template_data)
			for (const element of frame.elements)
				if (element.type === "image") element.properties.src = "{{photo}}";
		await box.write("photo.json", JSON.stringify(photo));
		await mkdir(box.path("rows", "pics"), { recursive: true });
		await writeFile(
			box.path("rows", "pics", "blue.png"),
			await solidPng(4, 4, [20, 40, 200]),
		);
		await box.write(
			"rows/people.csv",
			"name,photo\nAna,pics/blue.png\nBen,pics/gone.png\n",
		);
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
		expect(run.stderr).toContain(
			"rows/people.csv: row 3, photo: No photo named pics/gone.png",
		);
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

	describe("starts where Studio's import does", () => {
		async function csvNames(path: string): Promise<string[]> {
			const zip = unzipSync(new Uint8Array(await readFile(box.path(path))));
			return Object.keys(zip)
				.filter((name) => name.endsWith(".png"))
				.sort();
		}

		test("finds a header that is not on the first row", async () => {
			await box.write(
				"report.csv",
				"Staff badges,,\n,,\nname,motto,team\nAna,Hi,Red\nBen,Yo,Blue\n",
			);
			const run = await box.run(
				"render",
				"badge.json",
				"--data",
				"report.csv",
				"--frame",
				"front",
				"--name",
				"{{name}}",
				"--out",
				"report.zip",
			);
			expect(run.code).toBe(0);
			expect(run.stderr).toContain(
				"warning: report.csv: no field matches the column team",
			);
			expect(await csvNames("report.zip")).toEqual(["Ana.png", "Ben.png"]);
		});
	});

	test("refuses bad data and options", async () => {
		await box.write("empty.csv", "name\n");
		await box.write("people.dat", "name\nAna\n");
		const data = ["render", "badge.json", "--data"];
		const cases: [string[], number, string][] = [
			[
				[...data, "people.csv"],
				2,
				"--data needs --out <dir|file.zip|file.pdf>",
			],
			[
				[
					"render",
					"a.coatworkspace",
					"--data",
					"people.csv",
					"--preset",
					"p",
					"--out",
					"x.zip",
				],
				2,
				"--data applies only to templates",
			],
			[
				[...data, "none.csv", "--out", "x.zip"],
				1,
				"cannot read none.csv: no such file",
			],
			[[...data, "empty.csv", "--out", "x.zip"], 1, "empty.csv has no records"],
			[
				[...data, "people.dat", "--out", "x.zip"],
				1,
				"people.dat: .dat is not a table",
			],
		];
		for (const [argv, code, message] of cases) {
			const run = await box.run(...argv);
			expect({ argv, code: run.code }).toEqual({ argv, code });
			expect(run.stderr).toContain(message);
			expect(run.stdout).toBe("");
		}
	});
});

describe("render export options", () => {
	beforeAll(async () => {
		await box.write("crew.csv", "name\nAna\nBen\n");
		await box.write("bled.json", JSON.stringify(card({ bleed: 10 } as never)));
	});

	async function zipOf(path: string): Promise<Record<string, Uint8Array>> {
		return unzipSync(new Uint8Array(await readFile(box.path(path))));
	}

	async function mediaBoxes(bytes: Uint8Array): Promise<string[]> {
		const pdf = await PDFDocument.load(bytes);
		return pdf.getPages().map((page) => {
			const { width, height } = page.getMediaBox();
			return `0 0 ${Math.round(width)} ${Math.round(height)}`;
		});
	}

	test("writes images and the report into a directory", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"crew.csv",
			"--out",
			"crew-dir",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toMatch(
			/^4 of 4 items exported to crew-dir \(\d+\.\ds\)\n$/,
		);
		expect((await readdir(box.path("crew-dir"))).sort()).toEqual([
			"badge-1-back.png",
			"badge-1-front.png",
			"badge-2-back.png",
			"badge-2-front.png",
			"export-report.csv",
		]);
	});

	test("names files from a pattern", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"crew.csv",
			"--name",
			"{{name}}-{{side}}",
			"--frame",
			"front",
			"--out",
			"named.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(Object.keys(await zipOf("named.zip")).sort()).toEqual([
			"Ana-front.png",
			"Ben-front.png",
			"export-report.csv",
		]);
	});

	test("refuses a pattern token the template does not have", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--name",
			"{{age}}",
			"--out",
			"x.zip",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			"--name has no {{age}}; it takes {{template}}",
		);
	});

	test("sets the JPEG quality", async () => {
		const sizes: number[] = [];
		for (const quality of ["10", "100"]) {
			const run = await box.run(
				"render",
				"badge.json",
				"--frame",
				"front",
				"--format",
				"jpeg",
				"--quality",
				quality,
				"--out",
				`q${quality}.zip`,
				"-q",
			);
			expect(run.code).toBe(0);
			sizes.push(
				((await zipOf(`q${quality}.zip`))["front.jpg"] as Uint8Array).length,
			);
		}
		expect(sizes[0]).toBeLessThan(sizes[1] as number);
	});

	test("includes the bleed", async () => {
		const run = await box.run(
			"render",
			"bled.json",
			"--bleed",
			"--frame",
			"front",
			"--out",
			"bled.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		const zip = await zipOf("bled.zip");
		const pixels = decodePixels(ck, zip["front.png"] as Uint8Array);
		expect([pixels?.width, pixels?.height]).toEqual([220, 120]);
	});

	test("refuses --bleed for a template without one", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--bleed",
			"--out",
			"x.zip",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("--bleed needs a template with a bleed");
	});

	test("sizes PDF pages from the dpi", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--frame",
			"front",
			"--dpi",
			"72",
			"--out",
			"dpi.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(await mediaBoxes(await readFile(box.path("dpi.pdf")))).toEqual([
			"0 0 200 100",
		]);
	});

	test("draws vector pages' text as outlines, with no font", async () => {
		const fonts = async (path: string) => {
			const pdf = await PDFDocument.load(await readFile(box.path(path)));
			return pdf.context
				.enumerateIndirectObjects()
				.filter(
					([, obj]) =>
						obj instanceof PDFDict &&
						obj.get(PDFName.of("Type")) === PDFName.of("Font"),
				).length;
		};
		const base = [
			"render",
			"badge.json",
			"--frame",
			"front",
			"--dpi",
			"300",
			"--pdf-pages",
			"vector",
		];
		expect((await box.run(...base, "--out", "embedded.pdf", "-q")).code).toBe(
			0,
		);
		expect(await fonts("embedded.pdf")).toBeGreaterThan(0);
		const run = await box.run(
			...base,
			"--pdf-text",
			"outline",
			"--out",
			"outlined.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
		expect(await fonts("outlined.pdf")).toBe(0);
	});

	test("warns when a vector page loses a spot, and lists the other rasterized layers once", async () => {
		const shadow = { type: "shadow", color: "#0008", dx: 2, dy: 3, blur: 4 };
		const base = card();
		await box.write(
			"spotted.json",
			JSON.stringify({
				...base,
				format_version: "1.7",
				template_data: base.template_data.map((frame) => ({
					...frame,
					elements: [
						...frame.elements,
						{
							id: `${frame.name}_pink`,
							type: "rect",
							pos: { x: 10, y: 50 },
							size: { width: 40, height: 40 },
							properties: {
								fill: "#ff3399",
								spot: { fill: { spot: "Pink", overprint: true } },
							},
							effects: [shadow],
						},
						{
							id: `${frame.name}_soft`,
							type: "rect",
							pos: { x: 60, y: 50 },
							size: { width: 40, height: 40 },
							properties: { fill: "#333333" },
							effects: [{ type: "grain", amount: 0.4 }],
						},
					],
				})),
			}),
		);
		const run = await box.run(
			"render",
			"spotted.json",
			"--frame",
			"front",
			"--pdf-pages",
			"vector",
			"--out",
			"spotted.pdf",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: front.png: Spot colour Pink lost: the fill of front_pink is drawn as an image in the PDF (shadow)",
		);
		expect(
			run.stderr.split("\n").filter((l) => l.includes("Drawn as images")),
		).toEqual(["front: Drawn as images in the PDF: front_soft (grain)"]);
	});

	test("lays cards out on sheets", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"crew.csv",
			"--sheets",
			"a4",
			"--duplex",
			"long",
			"--margin",
			"5",
			"--gap",
			"2",
			"--out",
			"sheets.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		const boxes = await mediaBoxes(await readFile(box.path("sheets.pdf")));
		expect(boxes).toHaveLength(2);
		for (const page of boxes)
			expect(["0 0 595 842", "0 0 842 595"]).toContain(page);
	});

	test("draws the printer's marks --marks names", async () => {
		const marked = async (...flags: string[]) => {
			const run = await box.run(
				"render",
				"badge.json",
				"--sheets",
				"a4",
				...flags,
				"--out",
				"marks.pdf",
				"-q",
			);
			expect(run.code).toBe(0);
			const page = (
				await PDFDocument.load(await readFile(box.path("marks.pdf")))
			).getPage(0);
			const contents = page.node.Contents();
			const streams =
				contents instanceof PDFArray
					? contents.asArray().map((ref) => page.doc.context.lookup(ref))
					: [contents];
			const text = streams
				.map((stream) =>
					stream instanceof PDFRawStream
						? new TextDecoder("latin1").decode(
								decodePDFRawStream(stream).decode(),
							)
						: "",
				)
				.join("\n");
			const tokens = text.split(/\s+/);
			return {
				strokes: tokens.filter((t) => t === "S").length,
				fills: tokens.filter((t) => t === "f").length,
				slug: tokens.includes("Tj"),
			};
		};
		const crop = await marked();
		expect(crop.strokes).toBeGreaterThan(0);
		expect(crop).toMatchObject({ fills: 0, slug: false });
		expect(await marked("--marks", "none")).toEqual({
			strokes: 0,
			fills: 0,
			slug: false,
		});
		expect(await marked("--marks", "colorbar,slug", "--no-crop-marks")).toEqual(
			{
				strokes: 1,
				fills: 12,
				slug: true,
			},
		);
		const all = await marked("--marks", "registration,colorbar,slug");
		expect(all).toEqual({ strokes: 4 * 3 + 1, fills: 12, slug: true });
	});

	test("fills a sheet with copies of one card", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--frame",
			"front",
			"--sheets",
			"a4",
			"--copies",
			"fill",
			"--out",
			"filled.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		const pdf = await PDFDocument.load(await readFile(box.path("filled.pdf")));
		expect(pdf.getPageCount()).toBe(1);
		const dry = await box.run(
			"render",
			"badge.json",
			"--frame",
			"front",
			"--sheets",
			"a4",
			"--copies",
			"fill",
			"--out",
			"filled.pdf",
			"--dry-run",
		);
		expect(dry.stdout).toMatch(
			/, (\d+) per sheet · 1 sheet · \1 copies each\n$/,
		);
	});

	test("lays cards out on a5 and a6 paper", async () => {
		for (const [paper, page] of [
			["a5", /^0 0 (420 595|595 420)$/],
			["a6", /^0 0 (298 420|420 298)$/],
		] as const) {
			const run = await box.run(
				"render",
				"badge.json",
				"--sheets",
				paper,
				"--out",
				`${paper}.pdf`,
				"-q",
			);
			expect(run.code).toBe(0);
			expect(
				(await mediaBoxes(await readFile(box.path(`${paper}.pdf`))))[0],
			).toMatch(page);
		}
	});

	test("takes a custom paper size and says when the cards do not fit", async () => {
		const fits = await box.run(
			"render",
			"badge.json",
			"--sheets",
			"100x50",
			"--no-crop-marks",
			"--out",
			"custom.pdf",
			"-q",
		);
		expect(fits.code).toBe(0);
		expect(
			(await mediaBoxes(await readFile(box.path("custom.pdf"))))[0],
		).toMatch(/^0 0 (283 142|142 283)$/);
		const tight = await box.run(
			"render",
			"badge.json",
			"--sheets",
			"20x20",
			"--out",
			"tight.pdf",
		);
		expect(tight.code).toBe(1);
		expect(tight.stderr).toContain("cannot lay out the sheets:");
	});

	test("declares an output intent: sRGB, a profile file, or none", async () => {
		const intents = async (path: string) => {
			const pdf = await PDFDocument.load(await readFile(box.path(path)));
			const list = pdf.catalog.lookupMaybe(
				PDFName.of("OutputIntents"),
				PDFArray,
			);
			return (list?.asArray() ?? []).map((ref) => {
				const intent = pdf.context.lookup(ref, PDFDict);
				const text = (key: string) =>
					(intent.lookup(PDFName.of(key)) as PDFHexString).decodeText();
				const dest = pdf.context.lookup(
					intent.get(PDFName.of("DestOutputProfile")),
				) as PDFRawStream;
				return {
					id: text("OutputConditionIdentifier"),
					info: text("Info"),
					n: dest.dict.get(PDFName.of("N"))?.toString(),
					bytes: decodePDFRawStream(dest).decode(),
				};
			});
		};
		const base = ["render", "badge.json", "--frame", "front", "-q", "--out"];
		expect((await box.run(...base, "srgb.pdf")).code).toBe(0);
		expect(await intents("srgb.pdf")).toEqual([
			{
				id: "sRGB IEC61966-2.1",
				info: "sRGB IEC61966-2.1",
				n: "3",
				bytes: SRGB_PROFILE,
			},
		]);

		const fogra = iccProfile({
			description: "Coated FOGRA39 (ISO 12647-2:2004)",
		});
		await box.write("fogra.icc", fogra);
		const run = await box.run(
			...base,
			"fogra.pdf",
			"--output-intent",
			"fogra.icc",
			"--output-intent-id",
			"FOGRA39",
		);
		expect(run.code).toBe(0);
		expect(await intents("fogra.pdf")).toEqual([
			{
				id: "FOGRA39",
				info: "Coated FOGRA39 (ISO 12647-2:2004)",
				n: "4",
				bytes: fogra,
			},
		]);

		expect(
			(await box.run(...base, "none.pdf", "--no-output-intent")).code,
		).toBe(0);
		expect(await intents("none.pdf")).toEqual([]);
	});

	test("refuses a file that is not an output profile", async () => {
		await box.write("lab.icc", iccProfile({ space: "Lab " }));
		const run = await box.run(
			"render",
			"badge.json",
			"--out",
			"lab.pdf",
			"--output-intent",
			"lab.icc",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			'--output-intent lab.icc: its colour space "Lab" is not gray, RGB or CMYK',
		);
		await box.write("text.icc", "not a profile");
		const text = await box.run(
			"render",
			"badge.json",
			"--out",
			"text.pdf",
			"--output-intent",
			"text.icc",
		);
		expect(text.stderr).toContain(
			"--output-intent text.icc: too short to be an ICC profile",
		);
	});

	test("writes a workspace preset into a directory", async () => {
		await box.write(
			"crew.coatworkspace",
			await workspaceBytes(workspaceOf(card())),
		);
		const run = await box.run(
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_png",
			"--out",
			"ws-dir",
			"-q",
		);
		expect(run.code).toBe(0);
		expect((await readdir(box.path("ws-dir"))).sort()).toEqual([
			"1-back.png",
			"1-front.png",
			"2-back.png",
			"2-front.png",
			"export-report.csv",
		]);
	});

	test("names the template and the CLI in a PDF's metadata and slug", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--sheets",
			"a4",
			"--marks",
			"slug",
			"--out",
			"named.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		const pdf = await PDFDocument.load(await readFile(box.path("named.pdf")), {
			updateMetadata: false,
		});
		expect(pdf.getTitle()).toBe("Badge");
		expect(pdf.getCreator()).toBe(`Freshcoat CLI ${version()}`);
		expect(pdf.getProducer()).toBe(`Freshcoat CLI ${version()} (pdf-lib)`);
		const page = pdf.getPage(0);
		const contents = page.node.Contents();
		const streams =
			contents instanceof PDFArray
				? contents.asArray().map((ref) => pdf.context.lookup(ref))
				: [contents];
		const content = streams
			.map((stream) =>
				stream instanceof PDFRawStream
					? new TextDecoder("latin1").decode(
							decodePDFRawStream(stream).decode(),
						)
					: "",
			)
			.join("\n");
		const hex = [...new TextEncoder().encode("Badge · Sheet 1 of 1")]
			.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
			.join("");
		expect(content.replace(/ /g, "")).toContain(hex.replace("C2B7", "B7"));

		await box.write("unnamed.json", JSON.stringify(card({ name: " " })));
		expect(
			(await box.run("render", "unnamed.json", "--out", "spring-run.pdf", "-q"))
				.code,
		).toBe(0);
		const unnamed = await PDFDocument.load(
			await readFile(box.path("spring-run.pdf")),
			{ updateMetadata: false },
		);
		expect(unnamed.getTitle()).toBe("spring-run");

		await box.write(
			"titled.coatworkspace",
			await workspaceBytes(workspaceOf(card())),
		);
		expect(
			(
				await box.run(
					"render",
					"titled.coatworkspace",
					"--preset",
					"p_pdf",
					"--out",
					"titled.pdf",
					"-q",
				)
			).code,
		).toBe(0);
		const preset = await PDFDocument.load(
			await readFile(box.path("titled.pdf")),
			{ updateMetadata: false },
		);
		expect([preset.getTitle(), preset.getCreator()]).toEqual([
			"Proof",
			`Freshcoat CLI ${version()}`,
		]);
	});

	test("says what the margins leave no room for", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--sheets",
			"a5",
			"--margin",
			"80",
			"--out",
			"wide.pdf",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			"cannot lay out the sheets: The margins (80 mm) leave no room on A5: 148 mm wide needs margins under 74 mm",
		);
	});

	test("counts cards, not pages, while assembling sheets", async () => {
		const sheets = await box.run(
			"render",
			"badge.json",
			"--data",
			"crew.csv",
			"--sheets",
			"a4",
			"--out",
			"counted.pdf",
		);
		expect(sheets.code).toBe(0);
		expect(sheets.stderr).toContain("assembling PDF: 4/4 cards");
		expect(sheets.stderr).not.toContain("pages");
		const single = await box.run(
			"render",
			"badge.json",
			"--out",
			"counted-pages.pdf",
		);
		expect(single.stderr).toContain("assembling PDF: 2/2 pages");
	});

	test("refuses options given twice, or that undo each other", async () => {
		const cases: [string[], string][] = [
			[
				["--output-intent", "p.icc", "--no-output-intent", "--out", "x.pdf"],
				"--output-intent and --no-output-intent do not go together",
			],
			[
				["--no-output-intent", "--output-intent", "p.icc", "--out", "x.pdf"],
				"--output-intent and --no-output-intent do not go together",
			],
			[
				[
					"--sheets",
					"a4",
					"--marks",
					"crop,slug",
					"--no-crop-marks",
					"--out",
					"x.pdf",
				],
				"--no-crop-marks does not go with --marks crop",
			],
			[
				["--dpi", "72", "--dpi", "96", "--out", "x.pdf"],
				"--dpi is given twice; give it once",
			],
			[
				["--format", "png", "--format", "jpeg", "--out", "x.zip"],
				"--format is given twice; give it once",
			],
		];
		for (const [argv, message] of cases) {
			const run = await box.run("render", "badge.json", ...argv);
			expect({ argv, code: run.code }).toEqual({ argv, code: 2 });
			expect(run.stderr).toContain(message);
		}
		const same = await box.run(
			"render",
			"badge.json",
			"--dpi",
			"72",
			"--dpi",
			"72",
			"--frame",
			"front",
			"--frame",
			"back",
			"--out",
			"twice.pdf",
			"-q",
		);
		expect(same.code).toBe(0);
	});

	test("refuses export options that do not fit", async () => {
		const cases: [string[], string][] = [
			[
				["badge.json", "--name", "x", "--out", "dir"],
				"--name needs --data or a .zip or .pdf --out",
			],
			[
				["badge.json", "--bleed", "--quality", "50"],
				"--bleed, --quality need --data or a .zip or .pdf --out",
			],
			[
				["badge.json", "--max-edge", "800", "--out", "x.zip"],
				"--max-edge needs --size-from",
			],
			[
				[
					"badge.json",
					"--orientation",
					"sideways",
					"--sheets",
					"a4",
					"--out",
					"x.pdf",
				],
				"Allowed choices are auto, portrait, landscape",
			],
			[
				["badge.json", "--no-analyze", "--out", "x.zip"],
				"--no-analyze needs --print-target or --print-profile",
			],
			[
				["badge.json", "--scale", "5", "--out", "x.zip"],
				"Expected a number from 1 to 4",
			],
			[
				["badge.json", "--pdf-text", "outline", "--out", "x.pdf"],
				"--pdf-text needs --pdf-pages vector",
			],
			[
				["badge.json", "--duplex", "long", "--out", "x.pdf"],
				"--duplex needs --sheets",
			],
			[
				["badge.json", "--no-crop-marks", "--margin", "2", "--out", "x.pdf"],
				"--no-crop-marks, --margin need --sheets",
			],
			[
				["badge.json", "--quality", "50", "--out", "x.zip"],
				"--quality needs --format jpeg or webp",
			],
			[
				["badge.json", "--quality", "50", "--out", "x.pdf"],
				"--quality needs --pdf-pages jpeg",
			],
			[
				["badge.json", "--format", "jpeg", "--out", "x.pdf"],
				"--format applies only to images; a PDF takes --pdf-pages",
			],
			[
				[
					"badge.json",
					"--png-alpha",
					"keep",
					"--format",
					"jpeg",
					"--out",
					"x.zip",
				],
				"--png-alpha needs --format png",
			],
			[
				["badge.json", "--png-alpha", "keep", "--out", "x.pdf"],
				"--png-alpha applies only to images; a PDF takes --pdf-pages",
			],
			[
				["badge.json", "--png-alpha", "always", "--out", "x.zip"],
				"Allowed choices are auto, keep",
			],
			[
				["badge.json", "--scale", "1", "--scale", "2", "--out", "x.zip"],
				"an export takes one --scale",
			],
			[
				["badge.json", "--quality", "101", "--out", "x.zip"],
				"Expected a whole number from 0 to 100",
			],
			[
				["badge.json", "--sheets", "b5", "--out", "x.pdf"],
				"Expected a4, a5, a6, letter, legal, a3, tabloid or <width>x<height> in millimetres",
			],
			[
				[
					"badges.coatworkspace",
					"--preset",
					"p_png",
					"--name",
					"x",
					"--out",
					"x.zip",
				],
				"--name applies only to templates",
			],
		];
		for (const [argv, message] of cases) {
			const run = await box.run("render", ...argv);
			expect({ argv, code: run.code }).toEqual({ argv, code: 2 });
			expect(run.stderr).toContain(message);
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
		expect(
			Object.keys(zip)
				.filter((name) => name.endsWith(".png"))
				.sort(),
		).toEqual(["1-back.png", "1-front.png", "2-back.png", "2-front.png"]);
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
		const junk = await box.run(
			"render",
			"junk.coatworkspace",
			"--preset",
			"a",
			"--out",
			"x.zip",
		);
		expect(junk.code).toBe(1);
		expect(junk.stderr).toContain("junk.coatworkspace:");
		const missing = await box.run(
			"render",
			"gone.coatworkspace",
			"--preset",
			"a",
			"--out",
			"x.zip",
		);
		expect(missing.code).toBe(1);
		expect(missing.stderr).toContain(
			"cannot read gone.coatworkspace: no such file",
		);
	});

	test("lists the presets when none is given", async () => {
		const run = await box.run(
			"render",
			"badges.coatworkspace",
			"--out",
			"x.zip",
		);
		expect(run.code).toBe(2);
		expect(run.stderr).toBe(
			"freshcoat: a .coatworkspace needs --preset <name|id>\nPresets:\n  All badges  (p_png)\n  Proof  (p_pdf)\nRun freshcoat render --help for usage.\n",
		);
	});

	test("refuses options that do not fit the file", async () => {
		const cases: [string[], string][] = [
			[
				["render", "badges.coatworkspace", "--preset", "p_png"],
				"a .coatworkspace needs --out <path>",
			],
			[
				[
					"render",
					"badges.coatworkspace",
					"--preset",
					"p_png",
					"--out",
					"x.zip",
					"--scale",
					"2",
					"--format",
					"webp",
				],
				"--scale, --format apply only to templates",
			],
			[
				["render", "badge.json", "--preset", "p_png"],
				"--preset needs a .coatworkspace file",
			],
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

describe("validate warnings", () => {
	test("lists Studio's issues as warnings and fails on them with --strict", async () => {
		const linted = card({ safeArea: 20, format_version: "1.2" } as never);
		linted.variants![0]!.overrides = [
			{
				name: "front",
				elements: [
					{ id: "ghost", properties: { color: "#000000" } },
					{ id: "front_name", properties: {} },
				],
			},
		] as never;
		await box.write("linted.json", JSON.stringify(linted));
		const run = await box.run("validate", "linted.json");
		expect(run.code).toBe(0);
		expect(run.stdout).toBe("linted.json is valid, with 7 warnings\n");
		for (const line of [
			'warning: variant "wide" changes "ghost", which is not on side "front" (variant_orphan_override)',
			'warning: variant "wide" has a change to "front_name" that changes nothing (variant_empty_override)',
			'warning: front: "front_name" has its left, top and right edges inside the safe area (safe_area)',
			'warning: back: "back_logo" has its right and bottom edges inside the safe area (safe_area)',
			"warning: uses fields from format 1.6 but declares 1.2; older readers drop them (format_low)",
		])
			expect(run.stderr).toContain(line);
		for (const line of run.stderr.trimEnd().split("\n"))
			expect(line).toMatch(/ \([a-z_]+\)$/);
		const strict = await box.run("validate", "linted.json", "--strict", "-q");
		expect(strict).toEqual({
			code: 1,
			stdout: "",
			stderr: "freshcoat: linted.json has 7 warnings\n",
		});
	});
});

describe("validate warnings for a CR80 card", () => {
	function printed(safeArea?: number): Template {
		const base = card({
			product: "card_cr80",
			...(safeArea ? { safeArea } : {}),
		} as never);
		const front = base.template_data[0]!;
		front.elements = [
			...front.elements,
			{
				id: "tight",
				type: "rect",
				pos: { x: 4, y: 40 },
				size: { width: 20, height: 20 },
				properties: { fill: "#000000" },
			},
		];
		return base;
	}

	test("checks the printer's 3 mm safe area when the template sets none", async () => {
		await box.write("cr80.json", JSON.stringify(printed()));
		const run = await box.run("validate", "cr80.json");
		expect(run.code).toBe(0);
		expect(run.stderr).toBe(
			'warning: front: "tight" has its left edge inside the safe area (safe_area)\n',
		);
		expect(run.stdout).toBe("cr80.json is valid, with 1 warning\n");
	});

	test("uses the template's own safe area over the printer's", async () => {
		await box.write("cr80-own.json", JSON.stringify(printed(2)));
		const run = await box.run("validate", "cr80-own.json");
		expect(run.stderr).toBe("");
		expect(run.stdout).toBe("cr80-own.json is valid\n");
	});
});

describe("validate warnings for image resolution", () => {
	beforeAll(async () => {
		const t = card({ width: 1012, height: 638 });
		for (const frame of t.template_data)
			frame.background.size = { width: 1012, height: 638 };
		const logo = t.template_data[0]!.elements[1]!;
		logo.pos = { x: 0, y: 0 };
		logo.size = { width: 900, height: 600 };
		if (logo.type === "image")
			logo.properties = { src: "photo.png", fit: "fill" };
		await box.write("photo.png", await solidPng(600, 400, [20, 40, 200]));
		await box.write("low-dpi.json", JSON.stringify(t));
	});

	test("warns for a 600 px image placed 3 in wide at 300 DPI", async () => {
		const run = await box.run("validate", "low-dpi.json");
		expect(run.code).toBe(0);
		expect(run.stderr).toBe(
			'warning: front: "front_logo" prints at 200 DPI, under 300 (image_dpi)\n',
		);
		expect(run.stdout).toBe("low-dpi.json is valid, with 1 warning\n");
		const strict = await box.run("validate", "low-dpi.json", "--strict", "-q");
		expect(strict.code).toBe(1);
		expect(strict.stderr).toBe("freshcoat: low-dpi.json has 1 warning\n");
	});

	test("follows --min-dpi and --dpi", async () => {
		expect(
			(await box.run("validate", "low-dpi.json", "--min-dpi", "150")).stderr,
		).toBe("");
		expect(
			(await box.run("validate", "low-dpi.json", "--min-dpi", "0", "--strict"))
				.code,
		).toBe(0);
		expect(
			(await box.run("validate", "low-dpi.json", "--dpi", "450")).stderr,
		).not.toContain("DPI");
		expect(
			(await box.run("validate", "low-dpi.json", "--dpi", "150")).stderr,
		).toBe(
			'warning: front: "front_logo" prints at 100 DPI, under 300 (image_dpi)\nwarning: back: "back_logo" prints at 150 DPI, under 300 (image_dpi)\n',
		);
	});
});

describe("print checks", () => {
	beforeAll(async () => {
		const t = card({ bleed: 10 } as never);
		const front = t.template_data[0]!;
		front.elements = [
			{
				id: "band",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 200, height: 20 },
				properties: { fill: "#0f766e", stroke: { color: "#000000", width: 2 } },
			},
			{
				id: "rule",
				type: "rect",
				pos: { x: 10, y: 60 },
				size: { width: 100, height: 1 },
				properties: {
					fill: "#ffffff",
					stroke: { color: "#000000", width: 0.5 },
				},
			},
			{
				id: "fine",
				type: "text",
				pos: { x: 10, y: 70 },
				size: { width: 180, height: 20 },
				properties: {
					value: "Terms",
					font: { family: "Inter", size: 12 },
					color: "#000000",
				},
			},
			{
				id: "ink",
				type: "text",
				pos: { x: 10, y: 30 },
				size: { width: 180, height: 30 },
				properties: {
					value: "{{name}}",
					font: { family: "Inter", size: 26 },
					color: "{{motto}}",
				},
			},
		];
		await box.write("print.json", JSON.stringify(t));
	});

	test("validate warns for small text, hairlines and art short of bleed", async () => {
		const run = await box.run("validate", "print.json");
		expect(run.code).toBe(0);
		for (const line of [
			'warning: front: "band": Runs to the trim on the left, top and right but not into the bleed; a cut that drifts shows a white edge (short_of_bleed)',
			'warning: front: "rule": Stroke is 0.12 pt at print size, below 0.25 pt; it may not print (hairline_stroke)',
			'warning: front: "fine": Text is 2.88 pt at print size, below 6 pt (small_text)',
		])
			expect(run.stderr).toContain(line);
		expect(run.stderr).not.toContain('"ink"');
		const strict = await box.run("validate", "print.json", "--strict", "-q");
		expect(strict.code).toBe(1);
	});

	test("render checks field-bound text with its values", async () => {
		const run = await box.run(
			"render",
			"print.json",
			"--frame",
			"front",
			"--set",
			"motto=#101828",
			"--out",
			"print-out",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: front: 6.24 pt text in #101828 may print as rich black and blur if plates are out of register; pure black (#000000) is safer: ink",
		);
		expect(run.stderr).toContain(
			"warning: front: Text is 2.88 pt at print size, below 6 pt: fine",
		);
		const plain = await box.run(
			"render",
			"print.json",
			"--frame",
			"front",
			"--set",
			"motto=#000000",
			"--out",
			"print-out",
		);
		expect(plain.stderr).not.toContain("rich black");
	});
	test("render reports the QR checks validate does, in its report too", async () => {
		const t = card();
		t.template_data[0]!.elements = [
			{
				id: "code",
				type: "qr_code",
				pos: { x: 10, y: 10 },
				size: { width: 80, height: 80 },
				properties: {
					value: "https://example.com",
					foreground: "{{motto}}",
					background: "#ffffff",
				},
			},
		] as never;
		await box.write("qr.json", JSON.stringify(t));
		const message =
			"QR colours have a contrast of 1.36:1, under 3:1; scanners may not read it: code";
		const dir = await box.run(
			"render",
			"qr.json",
			"--frame",
			"front",
			"--set",
			"motto=#dddddd",
			"--out",
			"qr-out",
		);
		expect(dir.code).toBe(0);
		expect(dir.stderr).toContain(`warning: front: ${message}`);
		const dark = await box.run(
			"render",
			"qr.json",
			"--frame",
			"front",
			"--set",
			"motto=#000000",
			"--out",
			"qr-out",
		);
		expect(dark.stderr).not.toContain("QR colours");
		const zip = await box.run(
			"render",
			"qr.json",
			"--frame",
			"front",
			"--set",
			"motto=#dddddd",
			"--out",
			"qr.zip",
		);
		expect(zip.code).toBe(0);
		expect(zip.stderr).toContain(`warning: front.png: ${message}`);
		const report = new TextDecoder().decode(
			unzipSync(new Uint8Array(await readFile(box.path("qr.zip"))))[
				REPORT_FILE_NAME
			],
		);
		expect(report).toContain(message);
	});
});

describe("validate warnings for slices", () => {
	test("warns that an open path slice exports as a cut line only", async () => {
		const t = card({ format_version: "1.7" });
		const front = t.template_data[0]!;
		front.elements = [
			...front.elements,
			{
				id: "fold",
				type: "vector",
				pos: { x: 10, y: 50 },
				size: { width: 100, height: 2 },
				properties: { d: "M0 1L100 1", slice: { edge: "score" } },
			},
		];
		await box.write("open-slice.json", JSON.stringify(t));
		const run = await box.run("validate", "open-slice.json");
		expect(run.code).toBe(0);
		expect(run.stderr).toBe(
			'warning: front: "fold" is an open path, so it exports as a cut line, not a piece (slice_open_piece)\n',
		);
		expect(run.stdout).toBe("open-slice.json is valid, with 1 warning\n");
	});
});

describe("workspaces in inspect and validate", () => {
	beforeAll(async () => {
		await box.write(
			"club.coatworkspace",
			await workspaceBytes(workspaceOf(card())),
		);
		const unbound = workspaceOf(card());
		unbound.templates[0]!.binding!.fields = {};
		await box.write("unbound.coatworkspace", await workspaceBytes(unbound));
		const broken = workspaceOf(card());
		broken.presets[1]!.layout = {
			...DEFAULT_SHEET_LAYOUT,
			paper: { widthMm: 20, heightMm: 20 },
		};
		broken.presets.push({
			...broken.presets[0]!,
			id: "p_gone",
			name: "Gone",
			templateId: "t_gone",
		});
		await box.write("broken.coatworkspace", await workspaceBytes(broken));
	});

	test("inspects a workspace as JSON", async () => {
		const run = await box.run("inspect", "club.coatworkspace", "--json");
		expect(run.code).toBe(0);
		const info = JSON.parse(run.stdout);
		expect(info).toMatchObject({
			file: "club.coatworkspace",
			name: "Badges",
			formatVersion: "1.0",
			templates: [
				{
					id: "t_badge",
					fileName: "Badge.coat",
					dataset: "d_people",
					unfilled: [],
					template: { id: "badge", width: 200, height: 100 },
				},
			],
			datasets: [
				{
					id: "d_people",
					name: "People",
					records: 2,
					statuses: { pending: 2 },
					columns: [{ key: "name", type: "text" }],
				},
			],
			presets: [
				{
					id: "p_png",
					name: "All badges",
					template: "Badge.coat",
					format: "png-zip",
					records: "all",
					items: 4,
				},
				{
					id: "p_pdf",
					name: "Proof",
					template: "Badge.coat",
					format: "pdf",
					records: "all",
					items: 2,
				},
			],
		});
	});

	test("inspects a workspace as text", async () => {
		const run = await box.run("inspect", "unbound.coatworkspace");
		expect(run.code).toBe(0);
		for (const line of [
			"Badges (unbound.coatworkspace)",
			"  Badge.coat  Badge (badge)  200 x 100  2 frames, 1 variant  bound to People",
			"    no column fills name",
			"  People (d_people)  2 records: 2 pending  1 column",
			"  All badges (p_png)  Badge.coat  png-zip, all records  4 items",
		])
			expect(run.stdout).toContain(line);
	});

	test("shows how a sheet preset lays out, or why it cannot", async () => {
		const run = await box.run("inspect", "broken.coatworkspace", "--json");
		const { presets } = JSON.parse(run.stdout);
		expect(presets[1].error).toBeString();
		expect(presets[2]).toMatchObject({
			template: "t_gone",
			error: "its template is not in the workspace",
		});
	});

	test("validates a workspace", async () => {
		const run = await box.run("validate", "club.coatworkspace");
		expect(run).toEqual({
			code: 0,
			stdout: "club.coatworkspace is valid\n",
			stderr: "",
		});
		const unbound = await box.run("validate", "unbound.coatworkspace");
		expect(unbound.code).toBe(0);
		expect(unbound.stderr).toBe(
			"warning: Badge.coat: no column fills the required field name\n",
		);
		expect(unbound.stdout).toBe(
			"unbound.coatworkspace is valid, with 1 warning\n",
		);
		expect(
			(await box.run("validate", "unbound.coatworkspace", "--strict")).code,
		).toBe(1);
	});

	test("fails a workspace whose presets cannot run", async () => {
		const run = await box.run("validate", "broken.coatworkspace");
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			"broken.coatworkspace is not valid (2 issues)",
		);
		expect(run.stderr).toContain('  preset "Proof": ');
		expect(run.stderr).toContain(
			'  preset "Gone": its template is not in the workspace',
		);
	});
});

describe("render --dry-run", () => {
	beforeAll(async () => {
		await box.write("dry.csv", "name\nAna\nBen\n");
	});

	test("lists a directory render's files without writing them", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--scale",
			"1",
			"--scale",
			"2",
			"--out",
			"dry",
			"--dry-run",
		);
		expect(run).toEqual({
			code: 0,
			stdout:
				"dry/front.png\ndry/front@2x.png\ndry/back.png\ndry/back@2x.png\n",
			stderr: "",
		});
		await expect(readdir(box.path("dry"))).rejects.toThrow();
	});

	test("lists an export's files without fetching fonts or writing", async () => {
		const before = box.fetch.urls.length;
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"dry.csv",
			"--frame",
			"front",
			"--out",
			"dry.zip",
			"--dry-run",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toBe(
			"badge-1-front.png\nbadge-2-front.png\n2 items would be exported to dry.zip\n",
		);
		expect(box.fetch.urls).toHaveLength(before);
		await expect(readFile(box.path("dry.zip"))).rejects.toThrow();
	});

	test("shows how sheets lay out, or why they cannot", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"dry.csv",
			"--sheets",
			"a4",
			"--out",
			"dry.pdf",
			"--dry-run",
		);
		expect(run.stdout).toMatch(
			/^4 items would be exported to dry\.pdf, \d+ per sheet · 1 sheet\n$/,
		);
		const tight = await box.run(
			"render",
			"badge.json",
			"--sheets",
			"20x20",
			"--out",
			"dry.pdf",
			"--dry-run",
		);
		expect(tight.code).toBe(1);
		expect(tight.stderr).toContain("cannot lay out the sheets:");
	});

	test("lists a workspace preset's files", async () => {
		await box.write(
			"dry.coatworkspace",
			await workspaceBytes(workspaceOf(card())),
		);
		const run = await box.run(
			"render",
			"dry.coatworkspace",
			"--preset",
			"p_png",
			"--out",
			"dry-ws.zip",
			"--dry-run",
		);
		expect(run.stdout).toBe(
			"1-front.png\n1-back.png\n2-front.png\n2-back.png\n4 items would be exported to dry-ws.zip\n",
		);
	});
});

describe("render --records and --save", () => {
	beforeEach(async () => {
		const workspace = workspaceOf(card());
		workspace.datasets[0]!.records[1]!.status = "failed";
		await box.write("status.coatworkspace", await workspaceBytes(workspace));
	});

	async function statuses(): Promise<Record<string, number>> {
		const run = await box.run("inspect", "status.coatworkspace", "--json");
		return JSON.parse(run.stdout).datasets[0].statuses;
	}

	test("exports only the records asked for", async () => {
		const run = await box.run(
			"render",
			"status.coatworkspace",
			"--preset",
			"p_png",
			"--records",
			"failed",
			"--out",
			"failed.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toStartWith("2 of 2 items exported");
		const zip = unzipSync(
			new Uint8Array(await readFile(box.path("failed.zip"))),
		);
		expect(
			Object.keys(zip)
				.filter((name) => name.endsWith(".png"))
				.sort(),
		).toEqual(["1-back.png", "1-front.png"]);
		expect(await statuses()).toEqual({ pending: 1, failed: 1 });
	});

	test("writes the statuses back with --save", async () => {
		const run = await box.run(
			"render",
			"status.coatworkspace",
			"--preset",
			"p_png",
			"--records",
			"failed",
			"--save",
			"--out",
			"saved.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"saved the record statuses to status.coatworkspace",
		);
		expect(await statuses()).toEqual({ pending: 1, exported: 1 });
	});

	test("refuses them outside a workspace or with --dry-run", async () => {
		const template = await box.run(
			"render",
			"badge.json",
			"--records",
			"all",
			"--out",
			"x.zip",
		);
		expect(template.code).toBe(2);
		expect(template.stderr).toContain("--records needs a .coatworkspace file");
		const dry = await box.run(
			"render",
			"status.coatworkspace",
			"--preset",
			"p_png",
			"--save",
			"--dry-run",
			"--out",
			"x.zip",
		);
		expect(dry.code).toBe(2);
		expect(dry.stderr).toContain("--save and --dry-run do not go together");
	});
});

describe("render --where and records views", () => {
	function viewWorkspace(): Workspace {
		const workspace = workspaceOf(card());
		const people = workspace.datasets[0]!;
		people.columns.push(
			{ key: "team", type: "text" },
			{ key: "age", type: "integer" },
		);
		people.records = [
			{
				id: "r_00000001",
				values: { name: "Ana", team: "red", age: 30 },
				status: "pending",
			},
			{
				id: "r_00000002",
				values: { name: "Ben", team: "blue", age: 17 },
				status: "pending",
			},
			{
				id: "r_00000003",
				values: { name: "Cy", team: "red", age: 12 },
				status: "pending",
			},
		];
		workspace.datasets.push({
			id: "d_teams",
			name: "Teams",
			columns: [
				{ key: "code", type: "text" },
				{ key: "city", type: "text" },
			],
			records: [
				{
					id: "t1",
					values: { code: "red", city: "Manila" },
					status: "pending",
				},
				{ id: "t2", values: { code: "red", city: "Cebu" }, status: "pending" },
			],
			assets: [],
		});
		return workspace;
	}

	async function itemNames(path: string): Promise<string[]> {
		const zip = unzipSync(new Uint8Array(await readFile(box.path(path))));
		return Object.keys(zip)
			.filter((name) => name.endsWith(".png"))
			.sort();
	}

	test("exports only matching records, and --save keeps the saved view", async () => {
		await box.write(
			"where.coatworkspace",
			await workspaceBytes(viewWorkspace()),
		);
		const run = await box.run(
			"render",
			"where.coatworkspace",
			"--preset",
			"p_png",
			"--where",
			"team=RED",
			"--where",
			"age>=18",
			"--save",
			"--out",
			"where.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toStartWith("2 of 2 items exported");
		expect(await itemNames("where.zip")).toEqual(["1-back.png", "1-front.png"]);
		const inspected = JSON.parse(
			(await box.run("inspect", "where.coatworkspace", "--json")).stdout,
		);
		expect(inspected.templates[0].view).toBeUndefined();
		expect(inspected.datasets[0].statuses).toEqual({ pending: 2, exported: 1 });
	});

	test("reads a saved view with a join, and names it in inspect and validate", async () => {
		const workspace = viewWorkspace();
		workspace.templates[0]!.binding = {
			...workspace.templates[0]!.binding!,
			fields: { name: { kind: "column", column: "team_city" } },
			view: {
				filters: [{ column: "age", op: "lt", value: "18" }],
				join: {
					datasetId: "d_teams",
					on: "team",
					key: "code",
					prefix: "team_",
					inner: true,
				},
			},
		};
		await box.write("joined.coatworkspace", await workspaceBytes(workspace));
		const dry = await box.run(
			"render",
			"joined.coatworkspace",
			"--preset",
			"p_png",
			"--dry-run",
			"--out",
			"x.zip",
		);
		expect(dry.stdout).toBe(
			"1-front.png\n1-back.png\n2 items would be exported to x.zip\n",
		);
		const inspected = await box.run("inspect", "joined.coatworkspace");
		expect(inspected.stdout).toContain(
			"    view: inner joined to Teams on team = code as team_*, where age<18: 1 record (1 unmatched; duplicate keys red)",
		);
		const json = JSON.parse(
			(await box.run("inspect", "joined.coatworkspace", "--json")).stdout,
		);
		expect(json.templates[0].view).toEqual({
			filters: ["age<18"],
			join: {
				dataset: "d_teams",
				on: "team",
				key: "code",
				prefix: "team_",
				inner: true,
			},
			records: 1,
			unmatched: 1,
			duplicateKeys: ["red"],
			problems: [],
		});
		const valid = await box.run("validate", "joined.coatworkspace");
		expect(valid.code).toBe(0);
		expect(valid.stderr).toContain(
			'Badge.coat: records view: the joined dataset has more than one record for "red"; the first is used',
		);
	});

	test("refuses a view that cannot apply", async () => {
		await box.write("bad.coatworkspace", await workspaceBytes(viewWorkspace()));
		const run = await box.run(
			"render",
			"bad.coatworkspace",
			"--preset",
			"p_png",
			"--where",
			"name<b",
			"--out",
			"bad.zip",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			"cannot read the records: name is text; only numbers and dates compare",
		);
		const bad = await box.run(
			"render",
			"bad.coatworkspace",
			"--preset",
			"p_png",
			"--where",
			"name",
			"--out",
			"bad.zip",
		);
		expect(bad.code).toBe(2);
		expect(bad.stderr).toContain("Expected <column><op><value>");
		const workspace = viewWorkspace();
		workspace.templates[0]!.binding!.view = {
			filters: [],
			join: { datasetId: "d_gone", on: "team", key: "code", prefix: "" },
		};
		await box.write("gone.coatworkspace", await workspaceBytes(workspace));
		const invalid = await box.run("validate", "gone.coatworkspace");
		expect(invalid.code).toBe(1);
		expect(invalid.stderr).toContain(
			"Badge.coat: records view: The joined dataset is not in the workspace",
		);
	});

	test("filters --data rows by field key", async () => {
		await box.write("teams.csv", "name,motto\nAna,Hi\nBen,Yo\nCy,Hey\n");
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"teams.csv",
			"--where",
			"motto~h",
			"--frame",
			"front",
			"--out",
			"teams.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(run.stdout).toStartWith("2 of 2 items exported");
	});
});

describe("the font cache", () => {
	test("fetches each font once and skips the cache with --no-cache", async () => {
		const cached = await sandbox({ cache: true });
		try {
			await cached.write("badge.json", JSON.stringify(card()));
			const first = await cached.run(
				"render",
				"badge.json",
				"--frame",
				"front",
				"--out",
				"a",
				"-q",
			);
			expect(first.code).toBe(0);
			const fetched = cached.fetch.urls.length;
			expect(fetched).toBeGreaterThan(0);
			await cached.run(
				"render",
				"badge.json",
				"--frame",
				"front",
				"--out",
				"b.zip",
				"-q",
			);
			expect(cached.fetch.urls).toHaveLength(fetched);
			expect(await readdir(cached.path(".cache", "fonts"))).toHaveLength(
				fetched,
			);
			await cached.run(
				"render",
				"badge.json",
				"--frame",
				"front",
				"--out",
				"c",
				"-q",
				"--no-cache",
			);
			expect(cached.fetch.urls.length).toBeGreaterThan(fetched);
		} finally {
			await cached.cleanup();
		}
	});
});

describe("pack", () => {
	beforeAll(async () => {
		await box.write(
			"pack.coatworkspace",
			await workspaceBytes(workspaceOf(card())),
		);
	});

	test("embeds relative images in a .coat that renders anywhere", async () => {
		const run = await box.run(
			"pack",
			"badge.json",
			"--out",
			"packed/badge.coat",
		);
		expect(run).toEqual({ code: 0, stdout: "packed/badge.coat\n", stderr: "" });
		const decoded = await decodeTemplate(
			new Uint8Array(await readFile(box.path("packed", "badge.coat"))),
		);
		if (!decoded.ok) throw new Error(decoded.message);
		const template = decoded.document as Template;
		expect(template.assets).toHaveLength(1);
		const rendered = await box.run(
			"render",
			"packed/badge.coat",
			"--frame",
			"front",
			"--out",
			"packed",
			"-q",
		);
		expect(rendered.code).toBe(0);
		const pixels = decodePixels(
			ck,
			new Uint8Array(await readFile(box.path("packed", "front.png"))),
		);
		const at = (170 + 70 * 200) * 4;
		expect([...(pixels?.data.slice(at, at + 3) ?? [])]).toEqual([20, 160, 60]);
	});

	test("writes .coat.json and raises the format version", async () => {
		await box.write(
			"old-pack.json",
			JSON.stringify(card({ format_version: "1.2" } as never)),
		);
		const run = await box.run(
			"pack",
			"old-pack.json",
			"--out",
			"old.coat.json",
		);
		expect(run.code).toBe(0);
		const written = JSON.parse(
			await readFile(box.path("old.coat.json"), "utf8"),
		);
		expect(written.format_version).toBe("1.6");
		expect(written.assets[0].base64).toBeString();
	});

	test("packs a workspace's templates", async () => {
		const all = await box.run(
			"pack",
			"pack.coatworkspace",
			"--out",
			"templates.zip",
		);
		expect(all.code).toBe(0);
		const zip = unzipSync(
			new Uint8Array(await readFile(box.path("templates.zip"))),
		);
		expect(Object.keys(zip)).toEqual(["templates/Badge.coat"]);
		const one = await box.run(
			"pack",
			"pack.coatworkspace",
			"--template",
			"Badge.coat",
			"--out",
			"one.coat",
		);
		expect(one.code).toBe(0);
		expect(
			new TextDecoder().decode(
				(await readFile(box.path("one.coat"))).subarray(0, 2),
			),
		).toBe("PK");
	});

	test("validates and renders each template of a templates zip", async () => {
		const workspace = workspaceOf(card());
		const badge = workspace.templates[0] as Workspace["templates"][number];
		workspace.templates.push({
			...badge,
			id: "t_tight",
			fileName: "Tight.coat",
			template: card({ id: "tight", safeArea: 20 } as never),
		});
		await box.write("two.coatworkspace", await workspaceBytes(workspace));
		expect(
			(await box.run("pack", "two.coatworkspace", "--out", "two.zip")).code,
		).toBe(0);

		const checked = await box.run("validate", "two.zip");
		expect(checked.code).toBe(0);
		expect(checked.stdout).toBe("two.zip is valid, with 4 warnings\n");
		expect(checked.stderr).toContain(
			'warning: Tight.coat: front: "front_name" has its left, top and right edges inside the safe area (safe_area)',
		);
		expect((await box.run("validate", "two.zip", "--strict", "-q")).code).toBe(
			1,
		);

		const rendered = await box.run(
			"render",
			"two.zip",
			"--frame",
			"front",
			"--out",
			"unpacked",
		);
		expect(rendered.code).toBe(0);
		expect(rendered.stdout).toBe(
			"unpacked/Badge/front.png\nunpacked/Tight/front.png\n",
		);
		expect(await size(box.path("unpacked", "Tight", "front.png"))).toEqual([
			200, 100,
		]);

		const exported = await box.run(
			"render",
			"two.zip",
			"--data",
			"people.csv",
			"--out",
			"x",
		);
		expect(exported.code).toBe(2);
		expect(exported.stderr).toContain(
			"a templates .zip renders each template's frames into a directory",
		);

		await box.write("junk.zip", "not a zip");
		const junk = await box.run("validate", "junk.zip");
		expect(junk.code).toBe(1);
		expect(junk.stderr).toContain("junk.zip: not a readable zip");
		const empty = await box.run("render", "badges.zip");
		expect(empty.code).toBe(1);
		expect(empty.stderr).toContain("cannot read badges.zip: no such file");
	});

	test("refuses outputs and templates it cannot write", async () => {
		const cases: [string[], number, string][] = [
			[
				["badge.json", "--out", "badge.png"],
				2,
				"--out names a .coat or .coat.json file",
			],
			[
				["pack.coatworkspace", "--out", "x.coat"],
				2,
				"a workspace packs into a .zip, or one template with --template",
			],
			[
				["pack.coatworkspace", "--template", "Nope", "--out", "x.coat"],
				1,
				'no template "Nope"; the workspace has Badge.coat',
			],
			[
				["badge.json", "--template", "x", "--out", "x.coat"],
				2,
				"--template needs a .coatworkspace file",
			],
			[["badge.json"], 2, "required option '--out <file>' not specified"],
		];
		for (const [argv, code, message] of cases) {
			const run = await box.run("pack", ...argv);
			expect({ argv, code: run.code }).toEqual({ argv, code });
			expect(run.stderr).toContain(message);
			if (code === 2)
				expect(run.stderr).toContain("Run freshcoat pack --help for usage.");
		}
	});
});

describe("render --jobs", () => {
	beforeAll(async () => {
		const rows = [
			"name",
			...Array.from({ length: 6 }, (_, i) => `Person ${i + 1}`),
		];
		await box.write("threads.csv", `${rows.join("\n")}\n`);
	});

	async function images(path: string): Promise<Record<string, Uint8Array>> {
		const zip = unzipSync(new Uint8Array(await readFile(box.path(path))));
		delete zip[REPORT_FILE_NAME];
		return zip;
	}

	test("renders the same files on worker threads as on one", async () => {
		const one = await box.run(
			"render",
			"badge.json",
			"--data",
			"threads.csv",
			"--jobs",
			"1",
			"--out",
			"one-thread.zip",
			"-q",
		);
		const two = await box.run(
			"render",
			"badge.json",
			"--data",
			"threads.csv",
			"--jobs",
			"2",
			"--out",
			"two-threads.zip",
			"-q",
		);
		expect([one.code, two.code]).toEqual([0, 0]);
		expect(two.stdout).toStartWith(
			"12 of 12 items exported to two-threads.zip",
		);
		const [single, pooled] = [
			await images("one-thread.zip"),
			await images("two-threads.zip"),
		];
		expect(Object.keys(pooled).sort()).toEqual(Object.keys(single).sort());
		for (const [name, bytes] of Object.entries(single))
			expect(pooled[name]).toEqual(bytes);
	});

	test("sends photos and fonts to the threads", async () => {
		const run = await box.run(
			"render",
			"photo.json",
			"--data",
			"rows/people.csv",
			"--frame",
			"front",
			"--jobs",
			"2",
			"--out",
			"photo-threads.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		const zip = await images("photo-threads.zip");
		const pixels = decodePixels(ck, zip["badge-1-front.png"] as Uint8Array);
		const at = (170 + 70 * 200) * 4;
		expect([...(pixels?.data.slice(at, at + 3) ?? [])]).toEqual([20, 40, 200]);
	});

	test("runs a workspace preset and a PDF on threads", async () => {
		await box.write(
			"threads.coatworkspace",
			await workspaceBytes(workspaceOf(card())),
		);
		const zip = await box.run(
			"render",
			"threads.coatworkspace",
			"--preset",
			"p_png",
			"--jobs",
			"2",
			"--out",
			"ws-threads.zip",
			"-q",
		);
		expect(zip.code).toBe(0);
		expect(Object.keys(await images("ws-threads.zip")).sort()).toEqual([
			"1-back.png",
			"1-front.png",
			"2-back.png",
			"2-front.png",
		]);
		const pdf = await box.run(
			"render",
			"badge.json",
			"--data",
			"threads.csv",
			"--jobs",
			"3",
			"--out",
			"threads.pdf",
			"-q",
		);
		expect(pdf.code).toBe(0);
		expect(
			(
				await PDFDocument.load(await readFile(box.path("threads.pdf")))
			).getPageCount(),
		).toBe(12);
	});

	test("refuses --jobs outside an export", async () => {
		const plain = await box.run(
			"render",
			"badge.json",
			"--jobs",
			"2",
			"--out",
			"dir",
		);
		expect(plain.code).toBe(2);
		expect(plain.stderr).toContain(
			"--jobs needs --data or a .zip or .pdf --out",
		);
		const zero = await box.run(
			"render",
			"badge.json",
			"--jobs",
			"0",
			"--out",
			"x.zip",
		);
		expect(zero.code).toBe(2);
		expect(zero.stderr).toContain("Expected a whole number, 1 or more.");
	});
});

describe("poolSize", () => {
	test("takes --jobs up to the items, and otherwise needs a few items per thread", () => {
		expect(poolSize(12, 0, 2)).toBe(2);
		expect(poolSize(1, 0, 4)).toBe(1);
		expect(poolSize(7, 0)).toBe(1);
		expect(poolSize(1000, 0)).toBeGreaterThanOrEqual(1);
		expect(poolSize(1000, 0)).toBeLessThanOrEqual(4);
	});
});

describe("the command line", () => {
	test("prints the package version", async () => {
		const run = await box.run("--version");
		expect(run).toEqual({ code: 0, stdout: `${version()}\n`, stderr: "" });
		expect(version()).toMatch(/^\d+\.\d+\.\d+/);
	});

	test("lists the less common render options only with --help-all", async () => {
		const short = await box.run("render", "--help");
		const all = await box.run("render", "--help-all");
		expect([short.code, all.code]).toEqual([0, 0]);
		for (const flag of ["--png-alpha", "--no-crop-marks"]) {
			expect(short.stdout).not.toContain(flag);
			expect(all.stdout).toContain(flag);
		}
		for (const flag of [
			"--pdf-text",
			"--output-intent-id",
			"--back-offset",
			"--blank-backs",
		])
			expect(short.stdout).toContain(flag);
		expect(short.stdout).toContain("Run freshcoat render --help-all");
		expect(all.stdout).not.toContain("--help-all");
		expect(all.stdout).toContain("Sheet options, with --sheets:");
	});

	test("offers every print target for-print has, by id and short name", async () => {
		const help = (await box.run("render", "--help")).stdout.replace(
			/\s+/g,
			" ",
		);
		expect(PRINT_TARGETS.length).toBeGreaterThan(0);
		for (const target of PRINT_TARGETS)
			expect(help).toContain(
				`${target.id} (${target.shortName ?? target.name})`,
			);
		const run = await box.run("render", "badge.json", "--print-target", "nope");
		expect(run.code).toBe(2);
		expect(run.stderr).toContain(
			`Allowed choices are ${["none", ...PRINT_TARGETS.map((t) => t.id)].join(", ")}`,
		);
	});

	test("describes --dpi the same way for render and validate", async () => {
		const dpi =
			"--dpi <n> design units per inch, the print size that image resolution, print checks and PDF pages are measured at; default 300";
		for (const name of ["render", "validate"])
			expect(
				(await box.run(name, "--help")).stdout.replace(/\s+/g, " "),
			).toContain(dpi);
	});

	test("prints help for the tool and each command", async () => {
		const overview = await box.run("--help");
		expect(overview.code).toBe(0);
		for (const name of ["render", "validate", "inspect", "pack"])
			expect(overview.stdout).toContain(`  ${name}`);
		for (const name of ["render", "validate", "inspect", "pack"]) {
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
		expect(run.stderr).toContain("freshcoat: missing required argument 'file'");
		expect(run.stderr).toContain("Run freshcoat inspect --help for usage.");
	});
});

describe("render cut files", () => {
	const edged = (): Template => {
		const base = card({ format_version: "1.7" } as never);
		const rect = (
			id: string,
			x: number,
			slice: Record<string, unknown>,
			extra = {},
		) => ({
			id,
			type: "rect",
			pos: { x, y: 0 },
			size: { width: 100, height: 100 },
			properties: { fill: "#ff0000", slice: { name: id, ...slice } },
			...extra,
		});
		return {
			...base,
			template_data: base.template_data.map((frame) =>
				frame.name === "front"
					? {
							...frame,
							elements: [
								rect("left", 0, { edge: "through" }),
								rect("right", 100, { edge: "kiss" }),
								{
									...rect("fold", 20, { edge: "score", output: "none" }),
									size: { width: 40, height: 2 },
								},
								...frame.elements,
							],
						}
					: frame,
			),
		} as Template;
	};
	let workspace: Workspace;

	beforeAll(async () => {
		await box.write("edged.json", JSON.stringify(edged()));
		workspace = workspaceOf(edged());
		await box.write("edged.coatworkspace", await workspaceBytes(workspace));
	});

	async function zipOf(path: string): Promise<Record<string, Uint8Array>> {
		return unzipSync(new Uint8Array(await readFile(box.path(path))));
	}
	const text = (bytes: Uint8Array | undefined) =>
		new TextDecoder().decode(bytes);

	test("writes an SVG beside each piece that has lines", async () => {
		const run = await box.run(
			"render",
			"edged.json",
			"--pieces",
			"--cut",
			"svg",
			"--out",
			"cut-dir",
			"-q",
		);
		expect(run.code).toBe(0);
		expect((await readdir(box.path("cut-dir"))).sort()).toEqual([
			"back.png",
			"export-report.csv",
			"front-left.png",
			"front-left.svg",
			"front-right.png",
			"front-right.svg",
		]);
		const left = await readFile(box.path("cut-dir", "front-left.svg"), "utf8");
		expect(left).toContain('viewBox="0 0 100 100"');
		expect(left).toContain('<g id="through">');
		expect(left).toContain('<g id="score">');
	});

	test("writes a DXF of the whole frame into a zip", async () => {
		const run = await box.run(
			"render",
			"edged.json",
			"--cut",
			"dxf",
			"--frame",
			"front",
			"--out",
			"cut.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		const files = await zipOf("cut.zip");
		expect(Object.keys(files).sort()).toEqual([
			REPORT_FILE_NAME,
			"front.dxf",
			"front.png",
		]);
		const dxf = text(files["front.dxf"]);
		for (const layer of ["THROUGH", "KISS", "SCORE"])
			expect(dxf).toContain(layer);
		expect(dxf).toContain("$INSUNITS");
	});

	test("draws the cut lines of a PDF", async () => {
		const run = await box.run(
			"render",
			"edged.json",
			"--frame",
			"front",
			"--cut-lines",
			"--dpi",
			"72",
			"--out",
			"cut.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		const pdf = await PDFDocument.load(await readFile(box.path("cut.pdf")));
		const plain = await box.run(
			"render",
			"edged.json",
			"--frame",
			"front",
			"--dpi",
			"72",
			"--out",
			"plain.pdf",
			"-q",
		);
		expect(plain.code).toBe(0);
		const withLines = (await readFile(box.path("cut.pdf"))).length;
		const without = (await readFile(box.path("plain.pdf"))).length;
		expect(withLines).toBeGreaterThan(without);
		expect(pdf.catalog.has(PDFName.of("OCProperties"))).toBe(true);
	});

	test("takes --cut and --cut-lines for a workspace preset", async () => {
		const run = await box.run(
			"render",
			"edged.coatworkspace",
			"--preset",
			"p_png",
			"--cut",
			"svg",
			"--out",
			"ws-cut.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(
			Object.keys(await zipOf("ws-cut.zip"))
				.filter((name) => name.endsWith(".svg"))
				.sort(),
		).toEqual(["1-front.svg", "2-front.svg"]);
		const lines = await box.run(
			"render",
			"edged.coatworkspace",
			"--preset",
			"p_pdf",
			"--cut-lines",
			"--out",
			"ws-cut.pdf",
			"-q",
		);
		expect(lines.code).toBe(0);
		const pdf = await PDFDocument.load(await readFile(box.path("ws-cut.pdf")));
		expect(pdf.catalog.has(PDFName.of("OCProperties"))).toBe(true);
	});

	test("names the cut lines' spot colours, and implies --cut-lines", async () => {
		const spots = async (file: string) => {
			const pdf = await PDFDocument.load(await readFile(box.path(file)));
			return pdf.context
				.enumerateIndirectObjects()
				.map(([, obj]) => obj)
				.filter(
					(obj): obj is PDFArray =>
						obj instanceof PDFArray && obj.get(0) === PDFName.of("Separation"),
				)
				.map((obj) => obj.lookup(1, PDFName).decodeText())
				.sort();
		};
		const plain = await box.run(
			"render",
			"edged.json",
			"--frame",
			"front",
			"--cut-lines",
			"--dpi",
			"72",
			"--out",
			"spots.pdf",
			"-q",
		);
		expect(plain.code).toBe(0);
		expect(await spots("spots.pdf")).toEqual([
			"Crease",
			"CutContour",
			"KissCut",
		]);
		const named = await box.run(
			"render",
			"edged.json",
			"--frame",
			"front",
			"--cut-spot",
			"Thru",
			"--cut-spot",
			"kiss=Half Cut",
			"--dpi",
			"72",
			"--out",
			"named.pdf",
			"-q",
		);
		expect(named.code).toBe(0);
		expect(await spots("named.pdf")).toEqual(["Crease", "Half Cut", "Thru"]);
		const ws = await box.run(
			"render",
			"edged.coatworkspace",
			"--preset",
			"p_pdf",
			"--cut-spot",
			"score=Fold",
			"--out",
			"ws-spots.pdf",
			"-q",
		);
		expect(ws.code).toBe(0);
		expect(await spots("ws-spots.pdf")).toContain("Fold");
	});

	test("refuses a cut option the preset's format does not take", async () => {
		const png = await box.run(
			"render",
			"edged.coatworkspace",
			"--preset",
			"p_png",
			"--cut-lines",
			"--out",
			"x.zip",
			"-q",
		);
		expect(png.code).toBe(1);
		expect(png.stderr).toContain("--cut-lines applies only to a PDF preset");
		const spot = await box.run(
			"render",
			"edged.coatworkspace",
			"--preset",
			"p_png",
			"--cut-spot",
			"X",
			"--out",
			"x.zip",
			"-q",
		);
		expect(spot.code).toBe(1);
		expect(spot.stderr).toContain("--cut-spot applies only to a PDF preset");
		const pdf = await box.run(
			"render",
			"edged.coatworkspace",
			"--preset",
			"p_pdf",
			"--cut",
			"svg",
			"--out",
			"x.pdf",
			"-q",
		);
		expect(pdf.code).toBe(1);
		expect(pdf.stderr).toContain("--cut applies only to an image preset");
	});

	test("refuses an unknown cut format", async () => {
		const run = await box.run(
			"render",
			"edged.json",
			"--cut",
			"ai",
			"--out",
			"x.zip",
		);
		expect(run.code).toBe(2);
		expect(run.stderr).toContain("--cut");
	});

	test("warns when no slice has an edge to cut", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--cut",
			"svg",
			"--out",
			"no-edges.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain("warning: no slice has an edge to cut");
		expect(Object.keys(await zipOf("no-edges.zip")).sort()).toEqual([
			"back.png",
			REPORT_FILE_NAME,
			"front.png",
		]);
	});
});

describe("render slice pieces", () => {
	const sliced = (): Template => {
		const base = card({ format_version: "1.7" } as never);
		const rect = (id: string, x: number, fill: string) => ({
			id,
			type: "rect",
			pos: { x, y: 0 },
			size: { width: 100, height: 100 },
			properties: { fill, slice: { name: id } },
		});
		return {
			...base,
			template_data: base.template_data.map((frame) =>
				frame.name === "front"
					? {
							...frame,
							elements: [
								rect("left", 0, "#ff0000"),
								rect("right", 100, "#0000ff"),
								...frame.elements,
							],
						}
					: frame,
			),
		} as Template;
	};
	let workspace: Workspace;

	beforeAll(async () => {
		await box.write("sliced.json", JSON.stringify(sliced()));
		await box.write("pair.csv", "name\nAna\nBen\n");
		workspace = workspaceOf(sliced());
		await box.write("sliced.coatworkspace", await workspaceBytes(workspace));
	});

	async function zipOf(path: string): Promise<Record<string, Uint8Array>> {
		return unzipSync(new Uint8Array(await readFile(box.path(path))));
	}

	test("writes a file per piece beside the sides without slices", async () => {
		const run = await box.run(
			"render",
			"sliced.json",
			"--pieces",
			"--out",
			"pieces-dir",
			"-q",
		);
		expect(run.code).toBe(0);
		expect((await readdir(box.path("pieces-dir"))).sort()).toEqual([
			"back.png",
			"export-report.csv",
			"front-left.png",
			"front-right.png",
		]);
		expect(await size(box.path("pieces-dir", "front-left.png"))).toEqual([
			100, 100,
		]);
		expect(await size(box.path("pieces-dir", "back.png"))).toEqual([200, 100]);
	});

	test("names pieces of each row of --data with {{slice}}", async () => {
		const run = await box.run(
			"render",
			"sliced.json",
			"--data",
			"pair.csv",
			"--pieces",
			"--name",
			"{{name}}_{{slice}}",
			"--frame",
			"front",
			"--out",
			"pieces.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(Object.keys(await zipOf("pieces.zip")).sort()).toEqual([
			"Ana_left.png",
			"Ana_right.png",
			"Ben_left.png",
			"Ben_right.png",
			REPORT_FILE_NAME,
		]);
	});

	test("lists the files a dry run would write", async () => {
		const run = await box.run(
			"render",
			"sliced.json",
			"--pieces",
			"--dry-run",
			"--out",
			"nowhere",
		);
		expect(run.code).toBe(0);
		expect(run.stdout.split("\n")).toEqual([
			"front-left.png",
			"front-right.png",
			"back.png",
			"3 items would be exported to nowhere",
			"",
		]);
	});

	test("lays a PDF out with one page per piece", async () => {
		const run = await box.run(
			"render",
			"sliced.json",
			"--pieces",
			"--frame",
			"front",
			"--dpi",
			"72",
			"--out",
			"pieces.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		const pdf = await PDFDocument.load(await readFile(box.path("pieces.pdf")));
		expect(
			pdf.getPages().map((page) => [page.getWidth(), page.getHeight()]),
		).toEqual([
			[100, 100],
			[100, 100],
		]);
	});

	test("splits a workspace preset", async () => {
		const run = await box.run(
			"render",
			"sliced.coatworkspace",
			"--preset",
			"p_png",
			"--pieces",
			"--out",
			"ws-pieces.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		const names = Object.keys(await zipOf("ws-pieces.zip")).filter((name) =>
			name.endsWith(".png"),
		);
		expect(names.sort()).toEqual([
			"1-back.png",
			"1-front-left.png",
			"1-front-right.png",
			"2-back.png",
			"2-front-left.png",
			"2-front-right.png",
		]);
		const whole = await box.run(
			"render",
			"sliced.coatworkspace",
			"--preset",
			"p_png",
			"--out",
			"ws-whole.zip",
			"-q",
		);
		expect(whole.code).toBe(0);
		expect(
			Object.keys(await zipOf("ws-whole.zip")).filter((name) =>
				name.endsWith(".png"),
			),
		).toHaveLength(4);
	});

	test("warns when there is nothing to split and exports whole sides", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--pieces",
			"--out",
			"no-slices.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: no slices to split; exporting whole sides",
		);
		expect(Object.keys(await zipOf("no-slices.zip")).sort()).toEqual([
			"back.png",
			REPORT_FILE_NAME,
			"front.png",
		]);
	});

	test("lists only the warnings of the layers inside each piece", async () => {
		const t = sliced();
		t.template_data[0]!.elements.push({
			id: "tiny",
			type: "text",
			pos: { x: 110, y: 60 },
			size: { width: 50, height: 10 },
			properties: {
				value: "x",
				font: { family: "Inter", size: 4 },
				color: "#000000",
			},
		} as never);
		await box.write("tiny.json", JSON.stringify(t));
		const run = await box.run(
			"render",
			"tiny.json",
			"--pieces",
			"--frame",
			"front",
			"--out",
			"tiny-pieces",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: front-right.png: Text is 0.96 pt at print size, below 6 pt: tiny",
		);
		expect(run.stderr).not.toContain("front-left.png");
		const report = (
			await readFile(box.path("tiny-pieces", REPORT_FILE_NAME), "utf8")
		)
			.trim()
			.split("\r\n");
		expect(report.find((row) => row.startsWith("front-left.png"))).toEndWith(
			",",
		);
		expect(report.find((row) => row.startsWith("front-right.png"))).toEndWith(
			'"Text is 0.96 pt at print size, below 6 pt: tiny"',
		);
	});

	test("refuses pieces on double-sided sheets", async () => {
		const flags = await box.run(
			"render",
			"sliced.json",
			"--pieces",
			"--sheets",
			"a4",
			"--duplex",
			"long",
			"--out",
			"x.pdf",
		);
		expect(flags.code).toBe(2);
		expect(flags.stderr).toContain(
			"--pieces does not go with --duplex; a piece is not a side of a card",
		);
		const duplex: Workspace = {
			...workspace,
			presets: workspace.presets.map((p) =>
				p.id === "p_pdf"
					? {
							...p,
							layout: { ...DEFAULT_SHEET_LAYOUT, duplex: "long-edge" as const },
						}
					: p,
			),
		};
		await box.write("duplex.coatworkspace", await workspaceBytes(duplex));
		const preset = await box.run(
			"render",
			"duplex.coatworkspace",
			"--preset",
			"p_pdf",
			"--pieces",
			"--out",
			"x.pdf",
		);
		expect(preset.code).toBe(2);
		expect(preset.stderr).toContain(
			'--pieces does not go with double-sided sheets; "Proof" prints duplex',
		);
	});

	test("refuses vector PDF pages for a workspace preset", async () => {
		const vector: Workspace = {
			...workspace,
			presets: workspace.presets.map((p) =>
				p.id === "p_pdf" ? { ...p, pdfPageImage: "vector" as const } : p,
			),
		};
		await box.write("vector.coatworkspace", await workspaceBytes(vector));
		const run = await box.run(
			"render",
			"vector.coatworkspace",
			"--preset",
			"p_pdf",
			"--pieces",
			"--out",
			"v.pdf",
			"-q",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("Pieces need PNG or JPEG pages, not vector");
	});
});

describe("render print options", () => {
	const profile = {
		version: 1 as const,
		name: "Shop printer",
		target: "ymcko-dye-sub",
		balance: { r: 1.1, g: 1, b: 0.9 },
	};
	const layout = {
		...DEFAULT_SHEET_LAYOUT,
		paper: "a4" as const,
		duplex: "long-edge" as const,
	};

	beforeAll(async () => {
		await box.write("printing.csv", "name\nAna\nBen\n");
		await box.write("printer.json", JSON.stringify(profile));
		const workspace = workspaceOf(card());
		const base = workspace.presets[0] as Workspace["presets"][number];
		workspace.presets = [
			{ ...base, id: "p_print", print: { enabled: true, profile } },
			{
				...base,
				id: "p_offset",
				format: "pdf",
				layout: { ...layout, backOffsetMm: { x: 1.5, y: -2 } },
			},
			{
				...base,
				id: "p_blank",
				format: "pdf",
				sides: ["front"],
				layout: { ...layout, blankBacks: true },
			},
		];
		await box.write("printing.coatworkspace", await workspaceBytes(workspace));
	});

	async function images(path: string): Promise<Record<string, Uint8Array>> {
		const zip = unzipSync(new Uint8Array(await readFile(box.path(path))));
		delete zip[REPORT_FILE_NAME];
		return zip;
	}

	async function pages(path: string): Promise<string[]> {
		const pdf = await PDFDocument.load(await readFile(box.path(path)));
		return pdf.getPages().map((page) => {
			const { width, height } = page.getMediaBox();
			const contents = page.node.Contents();
			const streams =
				contents instanceof PDFArray
					? contents.asArray()
					: contents
						? [contents]
						: [];
			const text = streams
				.map((ref) => pdf.context.lookup(ref) as PDFRawStream)
				.map((stream) =>
					new TextDecoder().decode(decodePDFRawStream(stream).decode()),
				)
				.join("\n");
			return `${Math.round(width)}x${Math.round(height)}\n${text}`;
		});
	}

	const template = [
		"render",
		"badge.json",
		"--data",
		"printing.csv",
		"--name",
		"{{index}}-{{side}}",
		"-q",
	];
	const preset = (id: string, out: string) =>
		box.run(
			"render",
			"printing.coatworkspace",
			"--preset",
			id,
			"--out",
			out,
			"-q",
		);

	test("corrects for the printer as a preset's print target and profile do", async () => {
		const runs = [
			await box.run(
				...template,
				"--print-target",
				"ymcko-dye-sub",
				"--print-profile",
				"printer.json",
				"--out",
				"print.zip",
			),
			await preset("p_print", "print-preset.zip"),
			await box.run(
				...template,
				"--print-target",
				"none",
				"--out",
				"plain.zip",
			),
		];
		expect(runs.map((run) => run.code)).toEqual([0, 0, 0]);
		const [printed, fromPreset, plain] = [
			await images("print.zip"),
			await images("print-preset.zip"),
			await images("plain.zip"),
		];
		expect(Object.keys(printed).sort()).toEqual([
			"1-back.png",
			"1-front.png",
			"2-back.png",
			"2-front.png",
		]);
		for (const [name, bytes] of Object.entries(printed)) {
			expect(fromPreset[name]).toEqual(bytes);
			expect(plain[name]).not.toEqual(bytes);
		}
		const report = unzipSync(
			new Uint8Array(await readFile(box.path("print.zip"))),
		)[REPORT_FILE_NAME];
		expect(new TextDecoder().decode(report).split("\n")[1]).toContain(",on,");
	});

	test("writes corrected images into the --out directory on its own", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--frame",
			"front",
			"--print-target",
			"ymcko-dye-sub",
			"--out",
			"print-dir",
			"-q",
		);
		expect(run.code).toBe(0);
		expect((await readdir(box.path("print-dir"))).sort()).toEqual([
			"export-report.csv",
			"front.png",
		]);
	});

	test("moves the backs as a preset's back offset does", async () => {
		const sheets = ["--sheets", "a4", "--duplex", "long", "--out"];
		const runs = [
			await box.run(
				...template,
				...sheets,
				"offset.pdf",
				"--back-offset",
				"1.5,-2",
			),
			await preset("p_offset", "offset-preset.pdf"),
			await box.run(...template, ...sheets, "no-offset.pdf"),
		];
		expect(runs.map((run) => run.code)).toEqual([0, 0, 0]);
		const offset = await pages("offset.pdf");
		expect(offset).toHaveLength(2);
		expect(await pages("offset-preset.pdf")).toEqual(offset);
		const still = await pages("no-offset.pdf");
		expect(still[0]).toEqual(offset[0]);
		expect(still[1]).not.toEqual(offset[1]);
	});

	test("refuses a back offset past Studio's range or off the paper", async () => {
		const sheets = ["--sheets", "a4", "--duplex", "long", "--out", "drift.pdf"];
		const far = await box.run(...template, ...sheets, "--back-offset", "500,0");
		expect(far.code).toBe(2);
		expect(far.stderr).toContain(
			"Expected <x>,<y> each from -50 to 50 millimetres.",
		);
		const off = await box.run(...template, ...sheets, "--back-offset", "0,30");
		expect(off.code).toBe(2);
		expect(off.stderr).toMatch(
			/cannot lay out the sheets: The back offset \(0 mm, 30 mm\) moves the backs off the paper; it keeps them on with x from -[\d.]+ to [\d.]+ mm and y from -[\d.]+ to [\d.]+ mm\n/,
		);
		expect(off.stderr).toContain("Run freshcoat render --help for usage.");
		expect(
			(
				await box.run(
					...template,
					...sheets,
					"--back-offset",
					"0,30",
					"--dry-run",
				)
			).code,
		).toBe(2);
	});

	test("fails a workspace preset whose back offset is off the paper", async () => {
		const workspace = workspaceOf(card());
		const base = workspace.presets[0] as Workspace["presets"][number];
		workspace.presets = [
			{
				...base,
				id: "p_drift",
				format: "pdf",
				layout: { ...layout, backOffsetMm: { x: 0, y: 40 } },
			},
		];
		await box.write("drift.coatworkspace", await workspaceBytes(workspace));
		const run = await box.run(
			"render",
			"drift.coatworkspace",
			"--preset",
			"p_drift",
			"--out",
			"drift-preset.pdf",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("moves the backs off the paper");
	});

	test("gives a one-sided template blank backs as a preset does", async () => {
		const sheets = [
			"--frame",
			"front",
			"--sheets",
			"a4",
			"--duplex",
			"long",
			"--out",
		];
		const runs = [
			await box.run(...template, ...sheets, "blank.pdf", "--blank-backs"),
			await preset("p_blank", "blank-preset.pdf"),
			await box.run(...template, ...sheets, "fronts.pdf"),
		];
		expect(runs.map((run) => run.code)).toEqual([0, 0, 0]);
		const blank = await pages("blank.pdf");
		expect(blank).toHaveLength(2);
		expect(await pages("blank-preset.pdf")).toEqual(blank);
		expect(await pages("fronts.pdf")).toHaveLength(1);
	});

	test("warns when a print target turns vector pages into PNG", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--frame",
			"front",
			"--print-target",
			"ymcko-dye-sub",
			"--pdf-pages",
			"vector",
			"--dpi",
			"72",
			"--out",
			"printed-vector.pdf",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"warning: print target draws PDF pages as PNG, not vector",
		);
	});

	test("warns when spot inks print as plain color", async () => {
		const spotted = card();
		const background = spotted.template_data[0]?.background;
		if (background)
			background.properties = {
				...background.properties,
				spot: { fill: { spot: "White" } },
			};
		await box.write(
			"spotted.json",
			JSON.stringify({ ...spotted, format_version: "1.7" }),
		);
		const png = await box.run(
			"render",
			"spotted.json",
			"--frame",
			"front",
			"--dpi",
			"72",
			"--out",
			"spotted.pdf",
		);
		expect(png.code).toBe(0);
		expect(png.stderr).toContain(
			"warning: spot ink White prints as plain color",
		);
		const vector = await box.run(
			"render",
			"spotted.json",
			"--frame",
			"front",
			"--dpi",
			"72",
			"--pdf-pages",
			"vector",
			"--out",
			"spotted-vector.pdf",
		);
		expect(vector.code).toBe(0);
		expect(vector.stderr).not.toContain("plain color");
	});

	test("takes the target from the profile when --print-target is left out", async () => {
		const run = await box.run(
			...template,
			"--print-profile",
			"printer.json",
			"--out",
			"profile-only.zip",
		);
		expect(run.code).toBe(0);
		const [printed, implied] = [
			await images("print.zip"),
			await images("profile-only.zip"),
		];
		for (const [name, bytes] of Object.entries(printed))
			expect(implied[name]).toEqual(bytes);
	});

	test("refuses a profile alone whose target this build does not know", async () => {
		await box.write(
			"thermal.json",
			JSON.stringify({ ...profile, target: "thermal" }),
		);
		const run = await box.run(
			"render",
			"badge.json",
			"--print-profile",
			"thermal.json",
			"--out",
			"thermal.zip",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			"--print-profile thermal.json was measured on thermal, which this build cannot print to; add --print-target to use it anyway",
		);
	});

	test("warns about a profile measured on another target", async () => {
		await box.write(
			"other.json",
			JSON.stringify({ ...profile, target: "thermal" }),
		);
		const run = await box.run(
			"render",
			"badge.json",
			"--print-target",
			"ymcko-dye-sub",
			"--print-profile",
			"other.json",
			"--out",
			"other.zip",
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toContain(
			"--print-profile other.json was measured on thermal, not Card printer (YMCKO dye-sub)",
		);
	});

	test("refuses a file that is not a print profile", async () => {
		await box.write(
			"cast.json",
			JSON.stringify({ ...profile, balance: { r: 9, g: 1, b: 1 } }),
		);
		const run = await box.run(
			"render",
			"badge.json",
			"--print-target",
			"ymcko-dye-sub",
			"--print-profile",
			"cast.json",
			"--out",
			"cast.zip",
		);
		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			"--print-profile cast.json: balance.r is 9, outside the",
		);
	});

	test("turns off the per-photo analysis with --no-analyze", async () => {
		const run = await box.run(
			...template,
			"--print-target",
			"ymcko-dye-sub",
			"--no-analyze",
			"--out",
			"fixed.zip",
		);
		expect(run.code).toBe(0);
		expect(Object.keys(await images("fixed.zip"))).toEqual(
			Object.keys(await images("print.zip")),
		);
	});

	test("turns the sheets with --orientation", async () => {
		const sheets = [
			"render",
			"badge.json",
			"--frame",
			"front",
			"--sheets",
			"a5",
			"-q",
		];
		expect(
			(
				await box.run(
					...sheets,
					"--orientation",
					"landscape",
					"--out",
					"landscape.pdf",
				)
			).code,
		).toBe(0);
		expect(
			(
				await box.run(
					...sheets,
					"--orientation",
					"portrait",
					"--out",
					"portrait.pdf",
				)
			).code,
		).toBe(0);
		const [landscape, portrait] = [
			await pages("landscape.pdf"),
			await pages("portrait.pdf"),
		];
		expect(landscape[0]?.split("\n")[0]).toBe("595x420");
		expect(portrait[0]?.split("\n")[0]).toBe("420x595");
	});

	test("refuses print and back options that do not fit", async () => {
		const cases: [string[], string][] = [
			[
				["badge.json", "--back-offset", "1,2", "--out", "x.zip"],
				"--back-offset applies only to a .pdf",
			],
			[
				["badge.json", "--blank-backs", "--out", "x.pdf"],
				"--blank-backs needs --sheets",
			],
			[
				[
					"badge.json",
					"--back-offset",
					"1,2",
					"--blank-backs",
					"--sheets",
					"a4",
					"--out",
					"x.pdf",
				],
				"--back-offset, --blank-backs need --duplex",
			],
			[
				[
					"badge.json",
					"--back-offset",
					"1",
					"--sheets",
					"a4",
					"--duplex",
					"long",
					"--out",
					"x.pdf",
				],
				"Expected <x>,<y> in millimetres, such as 0.5,-1",
			],
			[
				["badge.json", "--blank-backs"],
				"--blank-backs needs --data or a .zip or .pdf --out",
			],
			[
				[
					"badge.json",
					"--print-target",
					"none",
					"--print-profile",
					"printer.json",
				],
				"--print-profile does not go with --print-target none",
			],
			[
				["badge.json", "--print-target", "cmyk"],
				"Allowed choices are none, ymcko-dye-sub",
			],
			[
				[
					"printing.coatworkspace",
					"--preset",
					"p_print",
					"--print-target",
					"ymcko-dye-sub",
					"--out",
					"x.zip",
				],
				"--print-target applies only to templates",
			],
		];
		for (const [argv, message] of cases) {
			const run = await box.run("render", ...argv);
			expect({ argv, code: run.code }).toEqual({ argv, code: 2 });
			expect(run.stderr).toContain(message);
		}
	});
});
