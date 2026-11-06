import type { Renderer } from "@freshcoat-js/engine";
import {
	type ResolveTemplateFontsOptions,
	resolveTemplateFonts,
} from "./fonts";
import type { Template } from "./types";

export function createFontPreparation(
	renderer: Renderer,
	options: ResolveTemplateFontsOptions,
) {
	const ownedCache =
		options.cache === undefined
			? new Map<string, Promise<Uint8Array[]>>()
			: undefined;
	const installed = new Map<
		string,
		{ registered: readonly Uint8Array[]; resolved: Uint8Array[] }
	>();
	let disposed = false;
	return {
		async prepare(template: Template) {
			if (disposed) throw new Error("font preparation is disposed");
			const report = await resolveTemplateFonts(template, {
				...options,
				cache: options.cache ?? ownedCache,
			});
			if (disposed) {
				ownedCache?.clear();
				throw new Error("font preparation is disposed");
			}
			const fonts: Record<string, Uint8Array[]> = Object.create(null);
			for (const [family, bytes] of report.fonts) {
				const current = renderer.fonts.get(family);
				const previous = installed.get(family);
				// A new registered array belongs to the host, even with the same faces.
				if (current && current !== previous?.registered) {
					installed.delete(family);
					continue;
				}
				if (
					current &&
					previous &&
					bytes.length === previous.resolved.length &&
					bytes.every((face, index) => face === previous.resolved[index])
				)
					continue;
				fonts[family] = bytes;
			}
			if (Object.keys(fonts).length) {
				await renderer.addFonts(fonts);
				if (disposed) throw new Error("font preparation is disposed");
				for (const [family, resolved] of Object.entries(fonts)) {
					const registered = renderer.fonts.get(family);
					if (registered) installed.set(family, { registered, resolved });
				}
			}
			return report;
		},
		dispose() {
			disposed = true;
			ownedCache?.clear();
			installed.clear();
		},
	};
}
