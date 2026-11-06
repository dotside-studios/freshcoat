import {
	type BrowserRendererOptions,
	createRenderer,
} from "@freshcoat-js/engine/browser";
import {
	bindTemplateRenderer,
	type TemplateFontOptions,
	type TemplateRenderer,
} from "./bound-renderer";

export type { BrowserRendererOptions } from "@freshcoat-js/engine/browser";
export type { TemplateRenderer } from "./bound-renderer";
export type BrowserTemplateRendererOptions = BrowserRendererOptions &
	TemplateFontOptions;
export async function createTemplateRenderer(
	base: string,
	options: BrowserTemplateRendererOptions = {},
): Promise<TemplateRenderer> {
	const { fontOptions, ...rendererOptions } = options;
	return bindTemplateRenderer(await createRenderer(base, rendererOptions), {
		fontOptions:
			fontOptions === undefined
				? undefined
				: { load: rendererOptions.load, ...fontOptions },
	});
}
