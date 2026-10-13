import { MM_PER_INCH } from "@freshcoat-js/coatfile";
import { CUT_KINDS, CUT_STYLES, type ItemCuts } from "./cut";

/** The stroke of a cut line: a quarter point, the PDF's hairline. */
const STROKE_PT = 0.25;

const round = (n: number) => {
	const r = Math.round(n * 1e4) / 1e4;
	return String(Object.is(r, -0) ? 0 : r);
};

const xmlText = (text: string) =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/**
 * An SVG of an item's cut lines. It is sized in millimetres, `width` design
 * units at `dpi`, and its viewBox is the item's own design units, so it lies
 * over the item's image. One group per kind present, in `CUT_KINDS` order,
 * holds an unfilled hairline path per line, in the kind's colour.
 */
export function cutSvg(cuts: ItemCuts, dpi: number): string {
	const mm = (units: number) => (units / dpi) * MM_PER_INCH;
	const stroke = round((STROKE_PT / 72) * dpi);
	const out = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${round(mm(cuts.width))}mm" height="${round(mm(cuts.height))}mm" viewBox="0 0 ${round(cuts.width)} ${round(cuts.height)}">`,
	];
	for (const kind of CUT_KINDS) {
		const lines = cuts.lines.filter((l) => l.kind === kind);
		if (lines.length === 0) continue;
		out.push(`<g id="${kind}">`);
		for (const l of lines)
			out.push(
				`<path d="${l.path}" fill="none"${l.fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""} stroke="${CUT_STYLES[kind].color}" stroke-width="${stroke}" data-name="${xmlText(l.name)}"/>`,
			);
		out.push("</g>");
	}
	out.push("</svg>");
	return `${out.join("\n")}\n`;
}
