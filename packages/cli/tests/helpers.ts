import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Template } from "@freshcoat-js/coatfile";
import { encodePng, type FontFetch } from "@freshcoat-js/engine";
import { testFontBytes } from "@freshcoat-js/test-utils";
import type { Workspace } from "@freshcoat-js/workspace";
import { packWorkspace } from "@freshcoat-js/workspace/archive";
import { type Io } from "../src/io";
import { main } from "../src/main";

export const FONT_CSS = "https://fonts.example/css2?family=Inter";
export const FONT_FILE = "https://fonts.example/inter.ttf";

export function fontFetch(): FontFetch & { urls: string[] } {
	const urls: string[] = [];
	const fetch: FontFetch = async (url) => {
		urls.push(url);
		const body =
			url === FONT_CSS
				? `@font-face { font-family: 'Inter'; src: url(${FONT_FILE}) format('truetype'); }`
				: url === FONT_FILE
					? testFontBytes("Geist-Regular.ttf")
					: undefined;
		return {
			ok: body !== undefined,
			status: body === undefined ? 404 : 200,
			text: async () => String(body),
			arrayBuffer: async () =>
				(body as Uint8Array).slice().buffer as ArrayBuffer,
		};
	};
	return Object.assign(fetch, { urls });
}

export function card(overrides: Partial<Template> = {}): Template {
	return {
		format_version: "1.6",
		id: "badge",
		name: "Badge",
		width: 200,
		height: 100,
		fonts: [{ kind: "google", family: "Inter", url: FONT_CSS }],
		fields: {
			type: "object",
			properties: {
				name: { type: "string", title: "Name", default: "Ana" },
				motto: { type: "string" },
			},
			required: ["name"],
		},
		template_data: ["front", "back"].map((name) => ({
			name,
			background: {
				id: `${name}_bg`,
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 200, height: 100 },
				properties: { fill: "#ffffff" },
			},
			elements: [
				{
					id: `${name}_name`,
					type: "text",
					pos: { x: 10, y: 10 },
					size: { width: 180, height: 30 },
					properties: {
						value: "{{name}}",
						font: { family: "Inter", size: 20 },
						color: "#111111",
					},
				},
				{
					id: `${name}_logo`,
					type: "image",
					pos: { x: 150, y: 50 },
					size: { width: 40, height: 40 },
					properties: { src: "logo.png", fit: "cover" },
				},
			],
		})),
		variants: [
			{
				id: "wide",
				label: "Wide",
				size: { width: 400, height: 200 },
				overrides: [],
			},
		],
		...overrides,
	} as Template;
}

export async function solidPng(
	width: number,
	height: number,
	rgb: [number, number, number],
): Promise<Uint8Array> {
	const pixels = new Uint8Array(width * height * 4);
	for (let i = 0; i < pixels.length; i += 4) {
		pixels.set(rgb, i);
		pixels[i + 3] = 255;
	}
	return encodePng(pixels, width, height);
}

export type Run = { code: number; stdout: string; stderr: string };

export type Sandbox = {
	dir: string;
	fetch: ReturnType<typeof fontFetch>;
	path(...parts: string[]): string;
	run(...argv: string[]): Promise<Run>;
	write(name: string, content: string | Uint8Array): Promise<string>;
	cleanup(): Promise<void>;
};

export async function sandbox(): Promise<Sandbox> {
	const dir = await mkdtemp(join(tmpdir(), "freshcoat-cli-"));
	const fetch = fontFetch();
	await writeFile(join(dir, "logo.png"), await solidPng(4, 4, [20, 160, 60]));
	const write = async (name: string, content: string | Uint8Array) => {
		await writeFile(join(dir, name), content);
		return join(dir, name);
	};
	return {
		dir,
		fetch,
		path: (...parts) => join(dir, ...parts),
		write,
		async run(...argv) {
			let stdout = "";
			let stderr = "";
			const io: Io = {
				stdout: (text) => void (stdout += text),
				stderr: (text) => void (stderr += text),
				cwd: dir,
				fetch,
			};
			const code = await main(argv, io);
			return { code, stdout, stderr };
		},
		cleanup: () => rm(dir, { recursive: true, force: true }),
	};
}

export function workspaceOf(template: Template): Workspace {
	return {
		formatVersion: "1.0",
		name: "Badges",
		templates: [
			{
				id: "t_badge",
				fileName: "Badge.coat",
				template,
				binding: {
					datasetId: "d_people",
					fields: { name: { kind: "column", column: "name" } },
				},
			},
		],
		datasets: [
			{
				id: "d_people",
				name: "People",
				columns: [{ key: "name", type: "text" }],
				records: ["Ana", "Ben"].map((name, index) => ({
					id: `r_0000000${index + 1}`,
					values: { name },
					status: "pending" as const,
				})),
				assets: [],
			},
		],
		presets: [
			{
				id: "p_png",
				name: "All badges",
				templateId: "t_badge",
				records: "all",
				sides: "all",
				format: "png-zip",
				scale: 1,
				dpi: 300,
				fileName: "{{index}}-{{side}}",
				markExported: false,
			},
			{
				id: "p_pdf",
				name: "Proof",
				templateId: "t_badge",
				records: "all",
				sides: ["front"],
				format: "pdf",
				scale: 1,
				dpi: 300,
				fileName: "{{index}}-{{side}}",
				markExported: false,
			},
		],
	};
}

export async function workspaceBytes(workspace: Workspace): Promise<Uint8Array> {
	const blob = await packWorkspace(workspace);
	if (!blob) throw new Error("no workspace bytes");
	return new Uint8Array(await blob.arrayBuffer());
}
