// Characters a scene's text shaped without a glyph for: they paint as tofu.
// Read off the baked layouts, so it costs no shaping of its own.
import type { Command, DrawCommand } from "./types";

export type MissingGlyphs = {
	// The drawText command's source node id, when it has one.
	id?: string;
	// The text as laid out, line by line.
	text: string;
	codepoints: number[];
};

export function missingGlyphs(commands: readonly Command[]): MissingGlyphs[] {
	const out: MissingGlyphs[] = [];
	const visit = (cmd: DrawCommand) => {
		if (cmd.op === "drawGroup") cmd.children.forEach(visit);
		else if (cmd.op === "drawMasked") {
			visit(cmd.mask);
			cmd.children.forEach(visit);
		} else if (cmd.op === "drawText" && cmd.layout.missing) {
			const text = cmd.layout.lines.map((l) => l.text).join("\n");
			const shown = new Set<number>();
			for (const ch of text) shown.add(ch.codePointAt(0) as number);
			const codepoints = cmd.layout.missing.filter((cp) => shown.has(cp));
			if (codepoints.length > 0)
				out.push({ ...(cmd.id ? { id: cmd.id } : {}), text, codepoints });
		}
	};
	for (const cmd of commands)
		if (cmd.op.startsWith("draw")) visit(cmd as DrawCommand);
	return out;
}
