import { describe, expect, test } from "bun:test";
import {
	manifest,
	publishedManifest,
	releaseVersion,
	rewriteModuleSpecifiers,
} from "./release-packages";

describe("release packaging", () => {
	test("uses the freshcoat-js namespace consistently across workspace packages", () => {
		const names = new Map([
			["packages/engine", "@freshcoat-js/engine"],
			["packages/coatfile", "@freshcoat-js/coatfile"],
			["packages/for-print", "@freshcoat-js/for-print"],
			["packages/workspace", "@freshcoat-js/workspace"],
			["packages/ui", "@freshcoat-js/ui"],
			["apps/editor", "@freshcoat-js/editor"],
			["apps/figma-plugin", "@freshcoat-js/figma-plugin"],
		]);
		for (const [directory, name] of names) {
			const data = manifest(directory);
			expect(data.name).toBe(name);
			for (const [dependency, version] of Object.entries(data.dependencies ?? {})) {
				if (version.startsWith("workspace:"))
					expect([...names.values()]).toContain(dependency);
			}
		}
	});

	test("requires the release tag to match the committed versions", () => {
		const version = releaseVersion();
		expect(releaseVersion(`v${version}`)).toBe(version);
		expect(() => releaseVersion("v9.0.0")).toThrow("does not match");
	});

	test("rewrites module paths without changing strings or JSON imports", () => {
		const source = `import { x } from "./x";
export * from "../y";
type T = import("./types").T;
const lazy = () => import("./lazy");
import data from "./data.json" with { type: "json" };
const label = "./x";`;
		const result = rewriteModuleSpecifiers(source, "index.ts");
		expect(result).toContain('from "./x.js"');
		expect(result).toContain('from "../y.js"');
		expect(result).toContain('import("./types.js")');
		expect(result).toContain('import("./lazy.js")');
		expect(result).toContain('from "./data.json"');
		expect(result).toContain('const label = "./x"');
	});

	test("publishes JS and declaration exports with concrete workspace versions", () => {
		const result = publishedManifest(
			{
				name: "@freshcoat-js/example",
				version: "0.1.0",
				private: true,
				exports: { ".": "./src/index.ts", "./schema/*": "./schema/*" },
				dependencies: { "@freshcoat-js/engine": "workspace:*", zod: "^4.0.0" },
				devDependencies: { typescript: "^5.7.2" },
				scripts: { test: "bun test" },
			},
			new Map([["@freshcoat-js/engine", "0.1.0"]]),
		);
		expect(result.private).toBe(false);
		expect(result.dependencies).toEqual({
			"@freshcoat-js/engine": "0.1.0",
			zod: "^4.0.0",
		});
		expect(result.exports).toEqual({
			".": {
				types: "./src/index.d.ts",
				import: "./src/index.js",
				default: "./src/index.js",
			},
			"./schema/*": "./schema/*",
		});
		expect(result).not.toHaveProperty("scripts");
		expect(result).not.toHaveProperty("devDependencies");
	});

	test("rejects workspace dependencies outside the release set", () => {
		expect(() =>
			publishedManifest(
				{
					name: "example",
					version: "0.1.0",
					exports: { ".": "./src/index.ts" },
					dependencies: { "@freshcoat-js/ui": "workspace:*" },
				},
				new Map(),
			),
		).toThrow("Unreleased workspace dependency");
	});
});
