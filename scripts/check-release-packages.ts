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
import { join } from "node:path";
const loaded = new Map();
for (const name of ${JSON.stringify(imports)}) loaded.set(name, await import(name));
const { compileScene, decodePixels } = loaded.get("@freshcoat-js/engine");
const { renderSceneToPng, createHeadlessEnv } = loaded.get("@freshcoat-js/engine/headless");
const { planScene, analyzePixels } = loaded.get("@freshcoat-js/for-print");
const { validate, compile, setBarcodeEncoder } = loaded.get("@freshcoat-js/coatfile");
const { bwipBarcodeEncoder } = loaded.get("@freshcoat-js/coatfile/barcode");
const { fixtures } = loaded.get("@freshcoat-js/coatfile/fixtures");
const { packTemplate, decodeTemplate } = loaded.get("@freshcoat-js/coatfile/coat");
const { render } = loaded.get("@freshcoat-js/coatfile/render");
const require = createRequire(join(process.cwd(), "package.json"));
const { loadCanvasKit } = loaded.get("@freshcoat-js/canvaskit/node");
const ck = await loadCanvasKit();
const root = { kind: "rect", size: { width: 64, height: 36 }, fills: [{ kind: "solid", color: "#1f6fe8" }] };
assert.ok(compileScene(planScene(root), { width: 64, height: 36 }).length);
const output = await renderSceneToPng(root, { width: 64, height: 36, ck });
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
const fonts = new Map([["Geist", [new Uint8Array(readFileSync(${JSON.stringify(font)}))]]]);
const [frame] = await render(template, { displayName: "Release check" }, { width: template.width, height: template.height }, { ck, fonts, env: createHeadlessEnv({ fonts }) });
assert.equal(frame.format, "png");
assert.equal(frame.warnings.length, 0);
setBarcodeEncoder(bwipBarcodeEncoder);
const schema = JSON.parse(readFileSync(require.resolve("@freshcoat-js/coatfile/schema/coatfile.v1.schema.json"), "utf8"));
assert.ok(schema.$id);
assert.equal(schema.$id, "https://cdn.jsdelivr.net/npm/@freshcoat-js/coatfile@${manifest("packages/coatfile").version}/schema/coatfile.v1.schema.json");
console.log("All public imports, scene and text rendering, print analysis, archives, fixtures and schema passed in Node");
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
