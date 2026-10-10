import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	DEFAULT_VARIANT_ID,
	resolveTemplateFonts,
	type Template,
	validateValues,
} from "@freshcoat-js/coatfile";
import { describeWarning, renderTemplate } from "@freshcoat-js/coatfile/render";
import {
	type AssetFile,
	assetRef,
	type DatasetAsset,
	imageFields,
	prepareAssets,
} from "@freshcoat-js/workspace";
import { checkGlyphs } from "@freshcoat-js/workspace/export";
import { warnAboutFonts, warnAboutGlyphs } from "../fonts";
import { CliError, createLog, type Io } from "../io";
import { createLoader, openRenderer } from "../renderer";
import { readBytes, readTemplate } from "../template-file";

const FORMATS = {
	png: { format: "png", extension: "png" },
	jpeg: { format: "jpeg", extension: "jpg" },
	jpg: { format: "jpeg", extension: "jpg" },
	webp: { format: "webp", extension: "webp" },
} as const;

export type RenderOptions = {
	values?: string;
	set?: Record<string, string>;
	variant?: string;
	frame?: string[];
	scale?: number[];
	format?: keyof typeof FORMATS;
	out?: string;
	quiet: boolean;
};

export async function render(
	file: string,
	options: RenderOptions,
	io: Io,
): Promise<void> {
	const log = createLog(io, options.quiet);
	const output = FORMATS[options.format ?? "png"];
	const scales = options.scale ?? [1];

	const { template, directory } = await readTemplate(io, file);
	const variantId = pickVariant(template, options.variant);
	const frameNames = pickFrames(template, options.frame);
	const read = await readValues(io, template, options.values, options.set ?? {});
	const values = checkValues(template, read.values);

	const { fonts, ...report } = await resolveTemplateFonts(template, {
		...(io.fetch ? { fetch: io.fetch } : {}),
		load: createLoader(io, directory),
	});
	warnAboutFonts(log, report);

	const renderer = await openRenderer(io, {
		root: directory,
		build: output.format === "png" ? "default" : "full",
		fonts,
		assets: read.assets,
	});
	try {
		const frames = await renderTemplate(renderer, template, values, {
			...(variantId ? { variantId } : {}),
			...(frameNames ? { frameNames } : {}),
			exports: scales.map((value) => ({
				constraint: { kind: "scale", value },
				suffix: value === 1 ? "" : `@${value}x`,
			})),
			output: { encode: { format: output.format } },
		});
		const directoryOut = options.out ?? ".";
		await mkdir(resolve(io.cwd, directoryOut), { recursive: true });
		const written = new Set<string>();
		for (const frame of frames) {
			const name = `${safeName(frame.name)}${frame.suffix ?? ""}.${output.extension}`;
			if (written.has(name))
				throw new CliError(`two frames would both be written as ${name}`);
			written.add(name);
			for (const warning of frame.warnings)
				if (!(warning.kind === "image_load_failed" && warning.src === ""))
					log.warn(`${frame.name}: ${describeWarning(warning)}`);
			const path = join(directoryOut, name);
			await writeFile(resolve(io.cwd, path), frame.bytes);
			log.out(path);
		}
		const sides = [...new Set(frames.map((frame) => frame.name))];
		warnAboutGlyphs(
			log,
			sides.flatMap((side) =>
				checkGlyphs(
					template,
					{
						recordId: "",
						side,
						values: values as Record<string, string>,
						...(variantId ? { variantId } : {}),
					},
					renderer,
				),
			),
			"frames",
		);
	} finally {
		renderer.dispose();
	}
}

export function pickVariant(
	template: Template,
	id: string | undefined,
): string | undefined {
	if (id === undefined || id === DEFAULT_VARIANT_ID) return undefined;
	const ids = (template.variants ?? []).map((variant) => variant.id);
	if (!ids.includes(id))
		throw new CliError(
			`no variant "${id}"; the template has ${ids.length > 0 ? ids.join(", ") : "none"}`,
		);
	return id;
}

export function pickFrames(
	template: Template,
	names: string[] | undefined,
): string[] | undefined {
	if (!names || names.length === 0) return undefined;
	const known = template.template_data.map((frame) => frame.name);
	const unknown = names.filter((name) => !known.includes(name));
	if (unknown.length > 0)
		throw new CliError(
			`no frame ${unknown.map((name) => `"${name}"`).join(", ")}; the template has ${known.join(", ")}`,
		);
	return names;
}

export function isLocalImage(value: string): boolean {
	return value !== "" && !/^(https?|data|ws):/i.test(value);
}

export async function readValues(
	io: Io,
	template: Template,
	file: string | undefined,
	settings: Record<string, string>,
): Promise<{ values: Record<string, unknown>; assets: DatasetAsset[] }> {
	let fromFile: unknown = {};
	if (file !== undefined) {
		const text = new TextDecoder().decode(await readBytes(io, file));
		try {
			fromFile = JSON.parse(text);
		} catch (error) {
			throw new CliError(
				`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`,
			);
		}
		if (
			fromFile === null ||
			typeof fromFile !== "object" ||
			Array.isArray(fromFile)
		)
			throw new CliError(`${file} must hold a JSON object of field values`);
	}
	const values: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fromFile as object))
		values[key] =
			typeof value === "number" || typeof value === "boolean"
				? String(value)
				: value;
	Object.assign(values, settings);
	const unknown = Object.keys(values).filter(
		(key) => !Object.hasOwn(template.fields.properties, key),
	);
	if (unknown.length > 0) {
		const known = Object.keys(template.fields.properties);
		throw new CliError(
			`the template has no field ${unknown.map((key) => `"${key}"`).join(", ")}; its fields are ${known.length > 0 ? known.join(", ") : "none"}`,
		);
	}

	const keys: string[] = [];
	const files: AssetFile[] = [];
	for (const { key } of imageFields(template)) {
		const value = values[key];
		if (typeof value !== "string" || !isLocalImage(value.trim())) continue;
		const path =
			file === undefined || Object.hasOwn(settings, key)
				? value.trim()
				: join(dirname(file), value.trim());
		keys.push(key);
		files.push({ name: path, blob: new Blob([await readBytes(io, path)]) });
	}
	const prepared = await prepareAssets(files);
	prepared.forEach(({ asset }, i) => {
		values[keys[i] as string] = assetRef(asset.sha256);
	});
	return { values, assets: prepared.map(({ asset }) => asset) };
}

export function checkValues(
	template: Template,
	values: Record<string, unknown>,
): Record<string, unknown> {
	const defaults: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(template.fields.properties))
		if (field.default !== undefined) defaults[key] = field.default;
	const checked = validateValues({ ...defaults, ...values }, template.fields);
	if (!checked.ok)
		throw new CliError(
			[
				"the values do not fit the template's fields",
				...checked.errors.map((issue) => `  ${issue.message}`),
			].join("\n"),
		);
	return values;
}

function safeName(name: string): string {
	const cleaned = name.replace(/[\\/:*?"<>|\p{Cc}]/gu, "_").trim();
	return cleaned === "" || /^\.+$/.test(cleaned) ? "frame" : cleaned;
}
