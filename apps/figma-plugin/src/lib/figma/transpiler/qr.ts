import type { FigmaBoundingBox, FigmaNode, FigmaSolidPaint } from "../types";
import { figmaColorToHex } from "./colors";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";
import { isWholeMustacheToken } from "./fields";

export type ParsedQrName = { value: string; options: Record<string, string> };

export function parseQrLayerName(name: string): ParsedQrName | null {
	if (!name.startsWith("qr:")) return null;
	const body = name.slice(3);
	const semi = body.indexOf(";");
	if (semi === -1) return { value: body, options: {} };
	const value = body.slice(0, semi);
	const opts: Record<string, string> = {};
	for (const part of body.slice(semi + 1).split(";")) {
		if (!part) continue;
		const eq = part.indexOf("=");
		if (eq > 0) opts[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
	}
	return { value, options: opts };
}

export type TranspileQrContext = {
	frame: FigmaBoundingBox;
	scale: number;
	worldAnchor?: { x: number; y: number };
};

const EC_VALUES = new Set(["L", "M", "Q", "H"]);

// The placeholder's own paint, when it is a single solid one. A `qr:` layer can
// be any node type — including one with no fills, a gradient, or a stack — and
// none of those is a colour a QR module can be drawn in, so anything else
// leaves the foreground to coatfile's default.
function qrFillColor(node: FigmaNode): string | undefined {
	const fills = "fills" in node && Array.isArray(node.fills) ? node.fills : [];
	const visible = fills.filter((f) => f.visible !== false);
	if (visible.length !== 1 || visible[0].type !== "SOLID") return undefined;
	return figmaColorToHex((visible[0] as FigmaSolidPaint).color);
}

// Any node named `qr:…` is a placeholder — only its name + bbox are read, so
// this accepts any FigmaNode, not just rectangles.
export function transpileQr(node: FigmaNode, ctx: TranspileQrContext) {
	const parsed = parseQrLayerName(node.name);
	if (!parsed)
		throw new Error(`transpileQr called with non-qr layer: ${node.name}`);

	// Fields are registered centrally from the node binding; here the whole-token
	// value only determines the element id.
	const tokenMatch = isWholeMustacheToken(parsed.value);

	const placed = ctx.worldAnchor
		? placeWorld(node, ctx.worldAnchor, ctx.scale)
		: placeLocal(node, ctx.scale);
	if ("fallback" in placed) throw new FlattenFallbackError(node.id);
	const properties: Record<string, unknown> = { value: parsed.value };
	if (parsed.options.ec && EC_VALUES.has(parsed.options.ec))
		properties.errorCorrection = parsed.options.ec;
	// The modules are painted in the placeholder layer's own colour. Without
	// this the QR is always black (coatfile's default), so a white QR drawn
	// for a dark card exports black-on-dark — and, worse, a colorway that only
	// recolours the QR produces no override at all, because the base and the
	// variant both emit an element with no foreground to differ on.
	const fillColor = qrFillColor(node);
	if (fillColor) properties.foreground = fillColor;
	// An explicit `fg=` marker option is the author overriding the layer's own
	// paint, so it wins.
	if (parsed.options.fg) properties.foreground = parsed.options.fg;
	// Default the QR background to transparent so the card design shows through
	// (the painters otherwise fill it white). Authors opt into a solid quiet
	// zone with a `bg=` marker option or a rect behind the QR.
	properties.background = parsed.options.bg ?? "transparent";
	if (parsed.options.margin) {
		const m = Number(parsed.options.margin);
		if (Number.isFinite(m)) properties.margin = m;
	}

	return {
		id: tokenMatch.ok ? tokenMatch.id : node.id.replace(":", "_"),
		type: "qr_code" as const,
		pos: placed.pos,
		size: placed.size,
		...(placed.rotation !== 0 ? { rotation: placed.rotation } : {}),
		properties,
	};
}
