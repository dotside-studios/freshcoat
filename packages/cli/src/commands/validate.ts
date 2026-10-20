import {
	DEFAULT_IMAGE_DPI_UNITS,
	DEFAULT_MIN_IMAGE_DPI,
	hasToken,
	imagePixelSize,
	type Size,
	type Template,
	walkElements,
} from "@freshcoat-js/coatfile";
import { fileLoader } from "@freshcoat-js/engine/node";
import { WORKSPACE_EXTENSION } from "@freshcoat-js/workspace/archive";
import { CliError, createLog, type Io, type Log } from "../io";
import { type DpiCheck, type Findings, templateWarnings, workspaceFindings } from "../lint";
import {
	isTemplateArchive,
	readTemplate,
	readTemplateArchive,
	type TemplateFile,
	warnLoad,
} from "../template-file";
import { readWorkspace } from "../workspace-file";

export async function validateCommand(
	file: string,
	options: { quiet: boolean; strict?: true; dpi?: number; minDpi?: number },
	io: Io,
): Promise<void> {
	const log = createLog(io, options.quiet);
	const dpi: DpiCheck = {
		...(options.dpi !== undefined ? { dpi: options.dpi } : {}),
		...(options.minDpi !== undefined ? { min: options.minDpi } : {}),
	};
	const findings = file.toLowerCase().endsWith(WORKSPACE_EXTENSION)
		? await checkWorkspace(io, file, dpi)
		: isTemplateArchive(file)
			? await checkArchive(io, log, file, dpi)
			: await checkTemplate(io, log, file, dpi);
	const { errors, warnings } = findings;
	if (errors.length > 0)
		throw new CliError(
			[
				`${file} is not valid (${count(errors.length, "issue")})`,
				...errors.map((error) => `  ${error}`),
			].join("\n"),
		);
	for (const warning of warnings) log.warn(warning);
	if (options.strict && warnings.length > 0)
		throw new CliError(`${file} has ${count(warnings.length, "warning")}`);
	if (!log.quiet)
		log.out(
			warnings.length > 0
				? `${file} is valid, with ${count(warnings.length, "warning")}`
				: `${file} is valid`,
		);
}

async function checkTemplate(io: Io, log: Log, file: string, dpi: DpiCheck): Promise<Findings> {
	const loaded = await readTemplate(io, file);
	warnLoad(log, file, loaded, { format: false });
	return { errors: [], warnings: await loadedWarnings(loaded, dpi) };
}

async function checkArchive(io: Io, log: Log, file: string, dpi: DpiCheck): Promise<Findings> {
	const warnings: string[] = [];
	for (const { name, file: loaded } of await readTemplateArchive(io, file)) {
		warnLoad(log, `${file}: ${name}`, loaded, { format: false });
		warnings.push(...(await loadedWarnings(loaded, dpi)).map((w) => `${name}: ${w}`));
	}
	return { errors: [], warnings };
}

async function loadedWarnings(loaded: TemplateFile, dpi: DpiCheck): Promise<string[]> {
	const sizes = await localImageSizes(loaded.template, loaded.directory);
	return templateWarnings(loaded.template, {
		dpi: dpi.dpi ?? DEFAULT_IMAGE_DPI_UNITS,
		min: dpi.min ?? DEFAULT_MIN_IMAGE_DPI,
		pixelSize: (src) => sizes.get(src),
	});
}

/** The pixel sizes of the images a template names by a path, read from
 *  beside it. One that cannot be read is left out. */
async function localImageSizes(template: Template, directory: string): Promise<Map<string, Size>> {
	const srcs = new Set<string>();
	for (const frame of template.template_data)
		walkElements([frame.background, ...frame.elements], (el) => {
			if (el.type !== "image") return;
			const src = el.properties.src;
			if (src !== "" && !hasToken(src) && !/^(https?|data|ws|asset):/i.test(src)) srcs.add(src);
		});
	const load = fileLoader({ root: directory });
	const sizes = new Map<string, Size>();
	for (const src of srcs) {
		const size = await load(src).then(imagePixelSize, () => undefined);
		if (size) sizes.set(src, size);
	}
	return sizes;
}

async function checkWorkspace(io: Io, file: string, dpi: DpiCheck): Promise<Findings> {
	const { workspace, warnings } = await readWorkspace(io, file);
	const findings = workspaceFindings(workspace, dpi);
	return { ...findings, warnings: [...warnings, ...findings.warnings] };
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
