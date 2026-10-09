import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	artifactRoot,
	manifest,
	packages,
	root,
	run,
	stagingRoot,
} from "./release-packages";

const consumer = mkdtempSync(join(tmpdir(), "freshcoat-release-consumer-"));
try {
	const tarballs: string[] = [];
	const imports: string[] = [];
	for (const directory of packages) {
		const data = manifest(`packages/${directory}`);
		const filename = `${data.name.replace(/^@/, "").replace("/", "-")}-${data.version}.tgz`;
		const tarball = join(artifactRoot, filename);
		if (!existsSync(tarball))
			throw new Error(`Missing ${filename}; run bun run release:pack first`);
		tarballs.push(tarball);
		const entries = run(["tar", "-tf", tarball]).trim().split("\n");
		if (
			entries.some((entry) => entry.endsWith(".ts") && !entry.endsWith(".d.ts"))
		) {
			throw new Error(`TypeScript source leaked into ${filename}`);
		}
		for (const required of [
			"package/package.json",
			"package/LICENSE",
			"package/NOTICE",
			"package/README.md",
			"package/src/index.js",
			"package/src/index.d.ts",
		]) {
			if (!entries.includes(required))
				throw new Error(`${filename} is missing ${required}`);
		}
		const staged = JSON.parse(
			readFileSync(join(stagingRoot, directory, "package.json"), "utf8"),
		);
		for (const [key, value] of Object.entries(staged.exports)) {
			if (key.includes("*")) continue;
			imports.push(key === "." ? data.name : `${data.name}/${key.slice(2)}`);
			for (const path of Object.values(value as Record<string, string>)) {
				if (!entries.includes(`package/${path.replace(/^\.\//, "")}`))
					throw new Error(`Missing export target ${path}`);
			}
		}
	}
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify({ private: true, type: "module" }),
	);
	run(
		[
			"npm",
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--package-lock=false",
			...tarballs,
		],
		consumer,
	);
	const font = join(
		root,
		"packages",
		"test-utils",
		"fonts",
		"Geist-Regular.ttf",
	);
	const smoke = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
const loaded = new Map();
for (const name of ${JSON.stringify(imports)}) loaded.set(name, await import(name));
const { compileScene, createRenderer, decodePixels } = loaded.get("@freshcoat-js/engine");
const { planScene, analyzePixels } = loaded.get("@freshcoat-js/for-print");
const { validate, compile } = loaded.get("@freshcoat-js/coatfile");
const { fixtures } = loaded.get("@freshcoat-js/coatfile/fixtures");
const { packTemplate, decodeTemplate } = loaded.get("@freshcoat-js/coatfile/coat");
const { renderTemplate } = loaded.get("@freshcoat-js/coatfile/render");
const require = createRequire(join(process.cwd(), "package.json"));
const { fileLoader, loadCanvasKit } = loaded.get("@freshcoat-js/engine/node");
const ck = await loadCanvasKit();
const renderer = await createRenderer({ ck, load: fileLoader({ root: dirname(${JSON.stringify(font)}) }), fonts: { Geist: [basename(${JSON.stringify(font)})] } });
const root = { kind: "rect", size: { width: 64, height: 36 }, fills: [{ kind: "solid", color: "#1f6fe8" }] };
assert.ok(compileScene(planScene(root), { width: 64, height: 36 }).length);
const output = await renderer.render(root, { width: 64, height: 36 });
assert.equal(output.format, "png");
const pixels = decodePixels(ck, output.bytes);
assert.equal(pixels.width, 64);
assert.ok(analyzePixels(pixels).recommendation);
const template = structuredClone(fixtures.minimalCard);
template.template_data[0].elements[0].properties.font.family = "Geist";
template.template_data[0].elements[0].properties.font.weight = 400;
assert.ok(validate(template).ok);
assert.ok(compile(template, { displayName: "Release check" }, { width: template.width, height: template.height }).frames.length);
const decoded = await decodeTemplate(await packTemplate(template));
assert.ok(decoded.ok);
const [frame] = await renderTemplate(renderer, template, { displayName: "Release check" });
assert.equal(frame.format, "png");
assert.equal(frame.warnings.length, 0);
const barcode = { format_version: "1.3", version: "1.0.0", id: "barcode", name: "Barcode", product: "test", width: 400, height: 160, fields: { type: "object", properties: {} }, template_data: [{ name: "front", background: { id: "bg", type: "rect", properties: { fill: "#ffffff" } }, elements: [{ id: "code", type: "barcode", pos: { x: 20, y: 20 }, size: { width: 360, height: 120 }, properties: { value: "590123412345", symbology: "ean13" } }] }] };
assert.ok(validate(barcode).ok);
const [coded] = await renderTemplate(renderer, barcode, {}, { output: { pixels: true } });
assert.equal(coded.warnings.length, 0);
const { packWorkspace, unpackWorkspace } = loaded.get("@freshcoat-js/workspace/archive");
const { readTable, writeTable } = loaded.get("@freshcoat-js/workspace/tabular");
const { assemblePdf } = loaded.get("@freshcoat-js/workspace/pdf");
const { createItemRenderer, inlinePool, runExportJob, REPORT_FILE_NAME } = loaded.get("@freshcoat-js/workspace/export");
const { unzipSync } = await import(require.resolve("fflate"));
const dataset = { id: "d_1", name: "Members", columns: [{ key: "displayName", type: "text" }], records: [{ id: "r_00000001", values: { displayName: "Ana" }, status: "pending" }, { id: "r_00000002", values: { displayName: "Ben" }, status: "pending" }], assets: [] };
const preset = { id: "p_1", name: "All", templateId: "t_1", records: "all", sides: "all", format: "png-zip", scale: 0.25, dpi: 300, fileName: "{{index}}-{{side}}", markExported: false };
const workspace = { formatVersion: "1.0", name: "Release check", templates: [{ id: "t_1", fileName: "card.coat", template, binding: { datasetId: "d_1", fields: { displayName: { kind: "column", column: "displayName" } } } }], datasets: [dataset], presets: [preset] };
const items = createItemRenderer({ renderer });
const job = await runExportJob(workspace, preset, { pool: inlinePool(items) });
items.dispose();
renderer.dispose();
assert.equal(job.cancelled, false);
assert.deepEqual(job.items.filter((item) => !item.ok), []);
const files = unzipSync(new Uint8Array(await job.file.blob.arrayBuffer()));
assert.deepEqual(Object.keys(files).sort(), ["1-front@0.25x.png", "2-front@0.25x.png", REPORT_FILE_NAME].sort());
assert.equal(decodePixels(ck, files["1-front@0.25x.png"]).width, 253);
const unpacked = await unpackWorkspace(await packWorkspace({ ...workspace, presets: [] }));
assert.ok(unpacked.ok, unpacked.message);
assert.equal(unpacked.workspace.datasets[0].records.length, 2);
const csv = await writeTable(dataset, "csv");
assert.deepEqual((await readTable(csv.bytes, "members.csv")).sheets[0].rows, [["displayName"], ["Ana"], ["Ben"]]);
const xlsx = await writeTable(dataset, "xlsx");
assert.deepEqual((await readTable(xlsx.bytes, "members.xlsx")).sheets[0].rows, [["displayName"], ["Ana"], ["Ben"]]);
const pdf = await assemblePdf([{ bytes: files["1-front@0.25x.png"], format: "png", widthPx: 253, heightPx: 160 }], { dpi: 75 });
assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
const { parseImageInfo } = loaded.get("@freshcoat-js/workspace/image-info");
assert.equal(parseImageInfo(files["1-front@0.25x.png"]).width, 253);
const schema = JSON.parse(readFileSync(require.resolve("@freshcoat-js/coatfile/schema/coatfile.v1.schema.json"), "utf8"));
assert.ok(schema.$id);
assert.equal(schema.$id, "https://cdn.jsdelivr.net/npm/@freshcoat-js/coatfile@${manifest("packages/coatfile").version}/schema/coatfile.v1.schema.json");
console.log("All public imports, scene, text and barcode rendering, print analysis, archives, fixtures, schema and a workspace export job passed in Node");
`;
	console.log(
		run(["node", "--input-type=module", "--eval", smoke], consumer).trim(),
	);
	writeFileSync(
		join(consumer, "check.ts"),
		imports
			.map(
				(name, index) =>
					`import * as module${index} from ${JSON.stringify(name)};\nvoid module${index};`,
			)
			.join("\n"),
	);
	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				noEmit: true,
				strict: true,
				module: "NodeNext",
				moduleResolution: "NodeNext",
				target: "ES2022",
				lib: ["ES2022", "DOM", "DOM.Iterable"],
				types: [],
			},
			include: ["check.ts"],
		}),
	);
	run(
		[
			"node",
			join(root, "node_modules", "typescript", "bin", "tsc"),
			"--project",
			"tsconfig.json",
		],
		consumer,
	);
	console.log(
		"All public declarations passed in a standalone NodeNext consumer",
	);
} finally {
	rmSync(consumer, { recursive: true, force: true });
}
