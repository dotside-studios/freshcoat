import type { DefaultOutput, Output, Renderer } from "@freshcoat-js/engine";
import { createFontPreparation } from "./font-preparation";
import type { ResolveTemplateFontsOptions } from "./fonts";
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
	const preparation =
		fontOptions === undefined
			? undefined
			: createFontPreparation(renderer, fontOptions);
	let disposed = false;
	let pending: Promise<unknown> = Promise.resolve();

	return {
		renderer,
		dispose: () => {
			disposed = true;
			preparation?.dispose();
			renderer.dispose();
		},
		render: async <O extends Output = DefaultOutput>(
			template: Template,
			values: Record<string, unknown>,
			options?: RenderTemplateOptions<O>,
		) => {
			if (disposed) throw new Error("template renderer is disposed");
			const work = pending.then(async () => {
				if (disposed) throw new Error("template renderer is disposed");
				await preparation?.prepare(template);
				if (disposed) throw new Error("template renderer is disposed");
				return renderTemplate(renderer, template, values, options);
			});
			pending = work.catch(() => {});
			return work;
		},
	};
}
export type TemplateRenderer = ReturnType<typeof bindTemplateRenderer>;
