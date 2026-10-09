import {
	encodeBarcode,
	errorCorrectionRange,
	type Symbology,
	type TemplateWarning,
} from "@freshcoat-js/coatfile";
import type { FigmaBoundingBox, FigmaNode } from "../types";
import { DEFAULT_SYMBOLOGY, parseBarcodeLayerName } from "./barcode-name";
import { singleSolidFillHex } from "./colors";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";

export type TranspileBarcodeContext = {
	frame: FigmaBoundingBox;
	scale: number;
	worldAnchor?: { x: number; y: number };
};

/** Warning codes for a `barcode:` layer that cannot be drawn as written. The
 *  export stands in a placeholder for it, which the author must agree to. */
export const BARCODE_UNKNOWN_SYMBOLOGY = "barcode_unknown_symbology";
export const BARCODE_INVALID_VALUE = "barcode_invalid_value";

/** A `barcode:` layer as a coatfile barcode element. Like a QR placeholder,
 *  only the layer's name, box and single solid fill are read, so any node type
 *  can carry the marker.
 *
 *  A layer that cannot be drawn warns with an error: an unknown symbology gets
 *  a Code 128 placeholder with no value, which coatfile draws as the outline
 *  of a code; a literal value the encoder refuses keeps its value, and coatfile
 *  draws its hatched placeholder in its place. */
export function transpileBarcode(
	node: FigmaNode,
	ctx: TranspileBarcodeContext,
): { element: Record<string, unknown>; warnings: TemplateWarning[] } {
	const parsed = parseBarcodeLayerName(node.name);
	if (!parsed)
		throw new Error(
			`transpileBarcode called with non-barcode layer: ${node.name}`,
		);

	const placed = ctx.worldAnchor
		? placeWorld(node, ctx.worldAnchor, ctx.scale)
		: placeLocal(node, ctx.scale);
	if ("fallback" in placed) throw new FlattenFallbackError(node.id);

	const warnings: TemplateWarning[] = [];
	const warn = (code: string, reason: string): void => {
		warnings.push({
			severity: "error",
			code,
			message: `Barcode layer "${node.name}": ${reason}`,
			nodeId: node.id,
		});
	};

	const symbology: Symbology = parsed.symbology ?? DEFAULT_SYMBOLOGY;
	let value = parsed.value;
	const { options } = parsed;
	const ec =
		options.errorCorrection !== undefined && errorCorrectionRange(symbology)
			? options.errorCorrection
			: undefined;

	if (parsed.symbology === null) {
		warn(BARCODE_UNKNOWN_SYMBOLOGY, parsed.problem ?? "unknown barcode type");
		value = "";
	} else if (parsed.problem) {
		warn(BARCODE_INVALID_VALUE, parsed.problem);
	} else if (parsed.mode === "literal") {
		// A field's value is only known at render time, but a literal can be
		// checked now, with the encoder coatfile draws it with.
		const encoded = encodeBarcode(symbology, value, {
			...(ec !== undefined ? { errorCorrection: ec } : {}),
		});
		if (!encoded.ok) warn(BARCODE_INVALID_VALUE, encoded.message);
	}

	const properties: Record<string, unknown> = {
		value,
		symbology,
		foreground: options.foreground ?? singleSolidFillHex(node) ?? "#000000",
		...(options.background !== undefined
			? { background: options.background }
			: {}),
		...(options.showText !== undefined ? { showText: options.showText } : {}),
		...(options.quietZone !== undefined
			? { quietZone: options.quietZone }
			: {}),
		...(ec !== undefined ? { errorCorrection: ec } : {}),
	};

	const element: Record<string, unknown> = {
		id:
			parsed.mode === "token" && parsed.ids.length === 1
				? parsed.ids[0]
				: node.id.replace(":", "_"),
		type: "barcode",
		pos: placed.pos,
		size: placed.size,
		...(placed.rotation !== 0 ? { rotation: placed.rotation } : {}),
		properties,
	};
	return { element, warnings };
}
