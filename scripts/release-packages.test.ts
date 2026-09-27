import { describe, expect, test } from "bun:test";
import {
	publishedManifest,
	releaseVersion,
	rewriteModuleSpecifiers,
} from "./release-packages";

describe("release packaging", () => {
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
				name: "@freshcoat/example",
				version: "0.1.0",
				private: true,
				exports: { ".": "./src/index.ts", "./schema/*": "./schema/*" },
				dependencies: { freshcoat: "workspace:*", zod: "^4.0.0" },
				devDependencies: { typescript: "^5.7.2" },
				scripts: { test: "bun test" },
			},
			new Map([["freshcoat", "0.1.0"]]),
		);
		expect(result.private).toBe(false);
		expect(result.dependencies).toEqual({ freshcoat: "0.1.0", zod: "^4.0.0" });
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
					dependencies: { "@freshcoat/ui": "workspace:*" },
				},
				new Map(),
			),
		).toThrow("Unreleased workspace dependency");
	});
});
