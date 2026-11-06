import { readFile } from "node:fs/promises";
import {
	createRenderer,
	type NodeRendererOptions,
} from "@freshcoat-js/engine/node";
import {
	bindTemplateRenderer,
	type TemplateFontOptions,
	type TemplateRenderer,
} from "./bound-renderer";
import { CoatError, errorMessage } from "./errors";
import type { LoadTemplateOptions } from "./load";
import { loadTemplate } from "./load";
import type { ValidationError } from "./types";

export type { NodeRendererOptions } from "@freshcoat-js/engine/node";
export type { TemplateRenderer } from "./bound-renderer";
export type NodeTemplateRendererOptions = NodeRendererOptions &
	TemplateFontOptions;

export class TemplateFileError extends CoatError {
	constructor(
		code: CoatError["code"],
		message: string,
		readonly filePath: string,
		readonly issues?: ValidationError[],
		cause?: unknown,
	) {
		super(code, message, { cause });
		this.name = "TemplateFileError";
	}
}

/** Creates a reusable template renderer with declared-font loading. */
export async function createTemplateRenderer(
	options: NodeTemplateRendererOptions = {},
): Promise<TemplateRenderer> {
	const { fontOptions, ...rendererOptions } = options;
	return bindTemplateRenderer(await createRenderer(rendererOptions), {
		fontOptions:
			fontOptions === undefined
				? undefined
				: { load: rendererOptions.load, ...fontOptions },
	});
}

/** Reads JSON or a .coat package, preserving successful load diagnostics. */
export async function readTemplateFile(
	path: string,
	options?: LoadTemplateOptions,
) {
	let bytes: Uint8Array;
	try {
		bytes = await readFile(path);
	} catch (cause) {
		throw new TemplateFileError(
			"read_failed",
			`Cannot read template ${path}: ${errorMessage(cause)}`,
			path,
			undefined,
			cause,
		);
	}
	const result = await loadTemplate(bytes, options);
	if (!result.ok) {
		if (result.reason === "unreadable")
			throw new TemplateFileError(
				result.code,
				`Cannot read template ${path}: ${result.message}`,
				path,
			);
		throw new TemplateFileError(
			"invalid_template",
			`Invalid template ${path}: ${JSON.stringify(result.errors)}`,
			path,
			result.errors,
		);
	}
	return result;
}
