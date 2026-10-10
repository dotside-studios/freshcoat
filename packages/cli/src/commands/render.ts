import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	DEFAULT_VARIANT_ID,
	type FrameWarning,
	resolveTemplateFonts,
	type Template,
	validateValues,
} from "@freshcoat-js/coatfile";
import { renderTemplate } from "@freshcoat-js/coatfile/render";
import { exactlyOne, parse, parseScale, parseSettings } from "../args";
import { warnAboutFonts } from "../fonts";
import { CliError, createLog, type Io, UsageError } from "../io";
import { createLoader, openRenderer } from "../renderer";
import { readBytes, readTemplate } from "../template-file";

export const renderHelp = `Usage: freshcoat render <template> [options]

Render each frame of a template to an image. <template> is a .coat file or
template JSON. Files are named after the frame, with the scale as a suffix
for anything but 1x: front.png, front@2x.png.

Options:
  --values <file>    JSON file of field values
  --set <key=value>  one field value; repeatable, overrides --values
  --variant <id>     render a variant of the template
  --frame <name>     render only this frame; repeatable
  --scale <n>        pixel density, default 1; repeatable
  --format <format>  png (default), jpeg or webp
  --out <dir>        directory to write to, default the current directory
  -q, --quiet        hide warnings and progress
  -h, --help         show this help

Fonts the template declares are loaded from their sources; others are looked
up on Google Fonts by name. Relative image paths resolve against the
template's directory. Written paths are printed on stdout.`;

const FORMATS = {
	png: { format: "png", extension: "png" },
	jpeg: { format: "jpeg", extension: "jpg" },
	jpg: { format: "jpeg", extension: "jpg" },
	webp: { format: "webp", extension: "webp" },
} as const;

export async function render(args: string[], io: Io): Promise<void> {
	const { values: flags, positionals } = parse(args, {
		values: { type: "string" },
		set: { type: "string", multiple: true },
		variant: { type: "string" },
		frame: { type: "string", multiple: true },
		scale: { type: "string", multiple: true },
		format: { type: "string" },
		out: { type: "string" },
	});
	const file = exactlyOne(positionals, "template file");
	const log = createLog(io, flags.quiet === true);
	const choice = flags.format ?? "png";
	if (!Object.hasOwn(FORMATS, choice))
		throw new UsageError(`--format must be png, jpeg or webp, got "${choice}"`);
	const output = FORMATS[choice as keyof typeof FORMATS];
	const scales = parseScale(flags.scale);
	const settings = parseSettings(flags.set);

	const { template, directory } = await readTemplate(io, file);
	const variantId = pickVariant(template, flags.variant);
	const frameNames = pickFrames(template, flags.frame);
	const values = await collectValues(io, template, flags.values, settings);

	const { fonts, ...report } = await resolveTemplateFonts(template, {
		...(io.fetch ? { fetch: io.fetch } : {}),
		load: createLoader(io, directory),
	});
	warnAboutFonts(log, report);

	const renderer = await openRenderer(io, {
		root: directory,
		build: output.format === "png" ? "default" : "full",
		fonts,
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
		const directoryOut = flags.out ?? ".";
		await mkdir(resolve(io.cwd, directoryOut), { recursive: true });
		const written = new Set<string>();
		for (const frame of frames) {
			const name = `${safeName(frame.name)}${frame.suffix ?? ""}.${output.extension}`;
			if (written.has(name))
				throw new CliError(`two frames would both be written as ${name}`);
			written.add(name);
			for (const warning of frame.warnings)
				log.warn(`${frame.name}: ${describeWarning(warning)}`);
			const path = join(directoryOut, name);
			await writeFile(resolve(io.cwd, path), frame.bytes);
			log.out(path);
		}
	} finally {
		renderer.dispose();
	}
}

function pickVariant(
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

function pickFrames(
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

async function collectValues(
	io: Io,
	template: Template,
	file: string | undefined,
	settings: Record<string, string>,
): Promise<Record<string, unknown>> {
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

export function describeWarning(warning: FrameWarning): string {
	const { kind, ...rest } = warning as { kind: string } & Record<string, unknown>;
	const detail = Object.values(rest).filter(
		(value) => typeof value === "string" || typeof value === "number",
	);
	return detail.length > 0 ? `${kind}: ${detail.join(", ")}` : kind;
}
