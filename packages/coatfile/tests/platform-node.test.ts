import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { createTemplateRenderer as createBrowserTemplateRenderer } from "../src/browser";
import { packTemplate } from "../src/coat";
import { CoatError } from "../src/errors";
import {
	createTemplateRenderer,
	readTemplateFile,
	type TemplateFileError,
} from "../src/node";
import { renderTemplate } from "../src/render";

describe("node entry point", () => {
	test("reads a template and reuses a renderer", async () => {
		const loaded = await readTemplateFile(
			new URL("../fixtures/minimal-card.json", import.meta.url).pathname,
		);
		expect(loaded.ok).toBe(true);
		expect(loaded.healed).toBe(false);
		const renderer = await createTemplateRenderer({
			fonts: { Comfortaa: [testFontBytes("Geist-Regular.ttf")] },
		});
		const first = await renderer.render(
			loaded.template,
			{},
			{ output: { pixels: true } },
		);
		const second = await renderer.render(
			loaded.template,
			{},
			{ output: { encode: { format: "png" } } },
		);
		expect(first[0]?.width).toBeGreaterThan(0);
		expect(second[0]?.bytes.length).toBeGreaterThan(0);
		renderer.dispose();
		await expect(renderer.render(loaded.template, {})).rejects.toThrow();
	});
	test("reports filesystem and malformed input errors", async () => {
		try {
			await readTemplateFile("/nonexistent/freshcoat.json");
			throw new Error("expected failure");
		} catch (error) {
			expect(error).toBeInstanceOf(CoatError);
			expect((error as CoatError).code).toBe("read_failed");
			expect((error as CoatError).cause).toBeDefined();
		}
		try {
			await readTemplateFile(
				new URL("../package.json", import.meta.url).pathname,
			);
			throw new Error("expected failure");
		} catch (error) {
			expect((error as CoatError).code).toBe("invalid_template");
			expect((error as TemplateFileError).issues?.length).toBeGreaterThan(0);
		}
	});
});

test("file reader preserves package and healing diagnostics and rejects malformed JSON", async () => {
	const dir = await mkdtemp(join(tmpdir(), "coatfile-node-"));
	try {
		const { template } = await readTemplateFile(
			new URL("../fixtures/minimal-card.json", import.meta.url).pathname,
		);
		const packaged = join(dir, "card.coat");
		await writeFile(packaged, await packTemplate(template));
		expect(await readTemplateFile(packaged)).toMatchObject({
			packaged: true,
			healed: false,
			template,
		});
		const first = template.template_data[0]?.elements[0];
		if (!first) throw new Error("fixture needs a layer");
		template.template_data[0]?.elements.push(structuredClone(first));
		const json = join(dir, "card.json");
		await writeFile(json, JSON.stringify(template));
		const loaded = await readTemplateFile(json);
		expect(loaded.healed).toBe(true);
		expect(loaded.renamedIds).toEqual(["displayName_2"]);
		await writeFile(json, "{broken");
		await expect(readTemplateFile(json)).rejects.toMatchObject({
			code: "invalid_json",
			filePath: json,
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("template factory forwards options and matches the injected-renderer route", async () => {
	const { template } = await readTemplateFile(
		new URL("../fixtures/minimal-card.json", import.meta.url).pathname,
	);
	const bytes = testFontBytes("Geist-Regular.ttf");
	const requested: string[] = [];
	const renderer = await createTemplateRenderer({
		fonts: { Comfortaa: ["font.ttf"] },
		load: async (src) => {
			requested.push(src);
			return bytes;
		},
	});
	try {
		const options = {
			width: 506,
			height: 319,
			frameNames: ["front"],
			exports: [{ constraint: { kind: "scale" as const, value: 2 } }],
			output: { pixels: true as const },
		};
		const [actual] = await renderer.render(
			template,
			{ displayName: "Alex" },
			options,
		);
		const [expected] = await renderTemplate(
			renderer.renderer,
			template,
			{ displayName: "Alex" },
			options,
		);
		expect(requested).toEqual(["font.ttf"]);
		expect(actual?.width).toBe(1012);
		expect(actual?.height).toBe(638);
		expect(actual?.pixels.data).toEqual(expected?.pixels.data);
		expect(actual?.warnings).toEqual([]);
	} finally {
		renderer.dispose();
	}
});

test("font resolution is opt-in and caches the configured fallback", async () => {
	const { template } = await readTemplateFile(
		new URL("../fixtures/minimal-card.json", import.meta.url).pathname,
	);
	let calls = 0;
	const renderer = await createTemplateRenderer({
		fontOptions: {
			fallback: {
				id: "test",
				load: async () => {
					calls++;
					return [testFontBytes("Geist-Regular.ttf")];
				},
			},
		},
	});
	try {
		await renderer.render(template, {});
		await renderer.render(template, {});
		expect(calls).toBe(1);
		expect(renderer.renderer.fonts.has("Comfortaa")).toBe(true);
	} finally {
		renderer.dispose();
	}
	const declaredOnly = await createTemplateRenderer();
	try {
		await declaredOnly.render(template, {});
		expect(declaredOnly.renderer.fonts.has("Comfortaa")).toBe(false);
	} finally {
		declaredOnly.dispose();
	}
});

test("browser template factory renders with a host CanvasKit instance", async () => {
	const { template } = await readTemplateFile(
		new URL("../fixtures/minimal-card.json", import.meta.url).pathname,
	);
	const renderer = await createBrowserTemplateRenderer("/unused", {
		ck: await loadCanvasKit(),
		fonts: { Comfortaa: [testFontBytes("Geist-Regular.ttf")] },
	});
	try {
		const [frame] = await renderer.render(
			template,
			{},
			{ output: { pixels: true } },
		);
		expect(frame?.pixels.width).toBe(template.width);
		expect(frame?.warnings).toEqual([]);
	} finally {
		renderer.dispose();
	}
});

test("opt-in font resolution inherits the renderer's local font loader", async () => {
	const { template } = await readTemplateFile(
		new URL("../fixtures/minimal-card.json", import.meta.url).pathname,
	);
	template.fonts = [
		{
			kind: "local",
			family: "Comfortaa",
			files: [{ weight: 700, src: "font.ttf" }],
		},
	];
	const requests: string[] = [];
	const cache = new Map<string, Promise<Uint8Array[]>>();
	const renderer = await createTemplateRenderer({
		load: async (src) => {
			requests.push(src);
			return testFontBytes("Geist-Regular.ttf");
		},
		fontOptions: { fallback: null, cache },
	});
	try {
		const [frame] = await renderer.render(template, {});
		expect(frame?.warnings).toEqual([]);
		expect(requests).toEqual(["font.ttf"]);
	} finally {
		renderer.dispose();
	}
	expect(cache.size).toBe(1);
});
