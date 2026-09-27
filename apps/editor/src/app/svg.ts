type Size = { width: number; height: number };

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const PROLOG =
	/^(?:\s+|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>)*/i;

export function svgMarkup(text: string): string | null {
	const trimmed = text.trim();
	const body = trimmed.slice(PROLOG.exec(trimmed)?.[0].length ?? 0);
	if (!/^<svg[\s>/]/.test(body)) return null;
	if (!/(<\/svg\s*>|\/>)$/.test(body)) return null;
	return parse(trimmed) ? trimmed : null;
}

export function svgSize(markup: string): Size {
	const root = parse(markup);
	const width = length(root?.getAttribute("width"));
	const height = length(root?.getAttribute("height"));
	const box = viewBox(root?.getAttribute("viewBox"));
	if (width && height) return { width, height };
	if (box) {
		if (width) return { width, height: (width * box.height) / box.width };
		if (height) return { width: (height * box.width) / box.height, height };
		return box;
	}
	return { width: width ?? 300, height: height ?? 150 };
}

export function rasterSize(size: Size): Size {
	const longest = Math.max(size.width, size.height);
	const scale = Math.min(4096, Math.max(2048, longest)) / longest;
	return {
		width: Math.max(1, Math.round(size.width * scale)),
		height: Math.max(1, Math.round(size.height * scale)),
	};
}

export function sizedSvg(markup: string, size: Size): string {
	const root = parse(markup);
	if (!root) return markup;
	if (!root.hasAttribute("viewBox")) {
		const own = svgSize(markup);
		root.setAttribute("viewBox", `0 0 ${own.width} ${own.height}`);
	}
	root.setAttribute("width", String(size.width));
	root.setAttribute("height", String(size.height));
	return new XMLSerializer().serializeToString(root);
}

// Pasted inline SVG often omits the namespaces an image needs.
function parse(markup: string): Element | null {
	const open = /<svg\b[^>]*>/.exec(markup);
	if (!open) return null;
	let tag = open[0];
	if (!/\sxmlns\s*=/.test(tag))
		tag = tag.replace(/^<svg/, `<svg xmlns="${SVG_NS}"`);
	if (/\bxlink:/.test(markup) && !/\sxmlns:xlink\s*=/.test(tag))
		tag = tag.replace(/^<svg/, `<svg xmlns:xlink="${XLINK_NS}"`);
	const doc = new DOMParser().parseFromString(
		markup.slice(0, open.index) +
			tag +
			markup.slice(open.index + open[0].length),
		"image/svg+xml",
	);
	const root = doc.documentElement;
	if (doc.getElementsByTagName("parsererror").length) return null;
	return root.namespaceURI === SVG_NS && root.localName === "svg" ? root : null;
}

function length(value: string | null | undefined): number | undefined {
	const m = /^\s*([\d.]+(?:e[+-]?\d+)?)\s*(px)?\s*$/i.exec(value ?? "");
	const n = m ? Number(m[1]) : Number.NaN;
	return n > 0 ? n : undefined;
}

function viewBox(value: string | null | undefined): Size | null {
	const parts = (value ?? "")
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
	const [, , width = 0, height = 0] = parts;
	return width > 0 && height > 0 ? { width, height } : null;
}
