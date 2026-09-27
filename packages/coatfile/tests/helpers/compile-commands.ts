import {
	approxEngine,
	type Command,
	compileScene,
	type FontVMetrics,
	type TextEngine,
} from "@freshcoat-js/engine";
import { compile } from "../../src/compile";
import type { Template } from "../../src/types";

type Opts = {
	width: number;
	height: number;
	variantId?: string;
	resize?: { width: number; height: number };
	fontMetrics?: Record<string, FontVMetrics>;
	textEngine?: TextEngine;
};

export function compileToCommands(
	template: Template,
	values: Record<string, unknown>,
	opts: Opts,
): { name: string; commands: Command[] }[] {
	const compiled = compile(template, values, {
		width: opts.width,
		height: opts.height,
		variantId: opts.variantId,
		resize: opts.resize,
	});
	const textEngine = opts.textEngine ?? approxEngine;
	return compiled.frames.map((f) => {
		const commands = compileScene(f.root, {
			width: compiled.width,
			height: compiled.height,
			textEngine,
			fontMetrics: opts.fontMetrics,
			fonts: f.assets.fonts,
			images: f.assets.images,
		});
		// Flatten the plain root container to top-level draws (matches the old output).
		const last = commands[commands.length - 1];
		if (
			last?.op === "drawGroup" &&
			!last.clip &&
			last.opacity === undefined &&
			last.rotation === undefined &&
			last.blendMode === undefined &&
			last.shadow === undefined &&
			last.blur === undefined
		) {
			return {
				name: f.name,
				commands: [...commands.slice(0, -1), ...last.children],
			};
		}
		return { name: f.name, commands };
	});
}
