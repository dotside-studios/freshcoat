import type { DefaultOutput, Output, Renderer } from "@freshcoat-js/engine";
import {
	type ResolveTemplateFontsOptions,
	resolveTemplateFonts,
} from "./fonts";
import { type RenderTemplateOptions, renderTemplate } from "./render";
import type { Template } from "./types";

export type TemplateFontOptions = {
	/** Resolve undeclared families too. Omit to load only declared fonts.
	 *  An empty object enables the resolver's Google Fonts fallback. */
	fontOptions?: ResolveTemplateFontsOptions;
};

export function bindTemplateRenderer(
	renderer: Renderer,
	options: TemplateFontOptions = {},
) {
	const { fontOptions } = options;
	const ownedCache =
		fontOptions?.cache === undefined
			? new Map<string, Promise<Uint8Array[]>>()
			: undefined;
	const cache = fontOptions?.cache ?? ownedCache;
	let disposed = false;

	return {
		renderer,
		dispose: () => {
			disposed = true;
			ownedCache?.clear();
			renderer.dispose();
		},
		render: async <O extends Output = DefaultOutput>(
			template: Template,
			values: Record<string, unknown>,
			options?: RenderTemplateOptions<O>,
		) => {
			if (disposed) throw new Error("template renderer is disposed");
			if (fontOptions !== undefined) {
				const resolved = await resolveTemplateFonts(template, {
					...fontOptions,
					cache,
				});
				const fonts = Object.fromEntries(
					[...resolved.fonts].filter(([family]) => !renderer.fonts.has(family)),
				);
				await renderer.addFonts(fonts);
			}
			return renderTemplate(renderer, template, values, options);
		},
	};
}
export type TemplateRenderer = ReturnType<typeof bindTemplateRenderer>;
