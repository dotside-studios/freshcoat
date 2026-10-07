// The `barcode:` layer-name grammar. Kept apart from the element transpiler
// (barcode.ts) because the main thread parses names too, to harvest bindings,
// and must not pull in the encoder or coatfile's runtime to do it.
//
//   barcode:{{id}}                  Code 128, bound to a field
//   barcode:ean13:{{id}}            another symbology
//   barcode:ean13:5901234123457     a literal value, bound to nothing
//   barcode:code39:"ID {{id}}"      a template, quoted as in the other markers
//   …;text=0;fg=#123;bg=#fff;margin=4;ec=5
import type { Symbology } from "@freshcoat-js/coatfile";
import { SYMBOLOGIES } from "@freshcoat-js/coatfile/barcode-encoder";
import { tokenIds } from "@freshcoat-js/coatfile/mustache";
import { isWholeMustacheToken } from "./fields";

/** What a `barcode:` layer draws when it names no symbology. */
export const DEFAULT_SYMBOLOGY: Symbology = "code128";

// Names are compared with case, spaces, hyphens and underscores ignored, so
// `Code-128`, `EAN_13` and `data matrix` all read. These are the other names a
// symbology commonly goes by.
const ALIASES: Record<string, Symbology> = {
	azteccode: "aztec",
	upc: "upca",
	ean: "ean13",
	itf: "itf14",
};

const QR_NAMES = new Set(["qr", "qrcode"]);

const normalize = (name: string): string =>
	name.toLowerCase().replace(/[\s_-]+/g, "");

export type SymbologyResult =
	| { ok: true; symbology: Symbology }
	| { ok: false; message: string };

export function resolveSymbology(name: string): SymbologyResult {
	const key = normalize(name);
	const direct = SYMBOLOGIES.find((s) => s === key);
	if (direct) return { ok: true, symbology: direct };
	if (ALIASES[key]) return { ok: true, symbology: ALIASES[key] };
	if (QR_NAMES.has(key)) {
		return {
			ok: false,
			message: `A QR code is its own layer: name it qr:{{id}} instead`,
		};
	}
	return {
		ok: false,
		message: `"${name.trim()}" is not a barcode type. Use one of ${SYMBOLOGIES.join(", ")}`,
	};
}

export function isBarcodeLayerName(name: string): boolean {
	return /^barcode:.+/.test(name);
}

export type BarcodeNameOptions = {
	showText?: boolean;
	foreground?: string;
	background?: string;
	quietZone?: number;
	errorCorrection?: number;
};

export type ParsedBarcodeName = {
	/** The symbology the layer names. Null when it names one coatfile does not
	 *  draw; `problem` then says why. */
	symbology: Symbology | null;
	/** The value as the element carries it: `{{id}}`, a template's text, or
	 *  the literal. */
	value: string;
	/** `token` is one whole field, `template` text with fields in it, and
	 *  `literal` a fixed value that binds nothing. */
	mode: "token" | "template" | "literal";
	/** Field ids the value references, in order, without repeats. */
	ids: string[];
	options: BarcodeNameOptions;
	/** Why this layer cannot be drawn as written. */
	problem?: string;
};

// Split on `;` outside double quotes, so a quoted template may contain one.
function splitOptions(s: string): string[] {
	const out: string[] = [];
	let buf = "";
	let quoted = false;
	for (const ch of s) {
		if (ch === '"') quoted = !quoted;
		if (ch === ";" && !quoted) {
			out.push(buf);
			buf = "";
		} else buf += ch;
	}
	out.push(buf);
	return out;
}

function readValue(
	raw: string,
): Pick<ParsedBarcodeName, "value" | "mode" | "ids"> {
	const s = raw.trim();
	const whole = isWholeMustacheToken(s);
	if (whole.ok)
		return { value: `{{${whole.id}}}`, mode: "token", ids: [whole.id] };
	const unquoted =
		s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
	const ids = [...new Set(tokenIds(unquoted))];
	return {
		value: unquoted,
		mode: ids.length > 0 ? "template" : "literal",
		ids,
	};
}

function readOptions(parts: string[]): BarcodeNameOptions {
	const opts: BarcodeNameOptions = {};
	for (const part of parts) {
		const eq = part.indexOf("=");
		if (eq <= 0) continue;
		const key = part.slice(0, eq).trim().toLowerCase();
		const raw = part.slice(eq + 1).trim();
		const v = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
		if (key === "text") {
			if (v === "0" || v === "false") opts.showText = false;
			else if (v === "1" || v === "true") opts.showText = true;
		} else if (key === "fg" && v) opts.foreground = v;
		else if (key === "bg" && v) opts.background = v;
		else if (key === "margin") {
			const n = Number(v);
			if (v !== "" && Number.isFinite(n) && n >= 0) opts.quietZone = n;
		} else if (key === "ec") {
			const n = Number(v);
			if (v !== "" && Number.isFinite(n)) opts.errorCorrection = n;
		}
	}
	return opts;
}

/** Parse a `barcode:` layer name, or null when the name is not one. */
export function parseBarcodeLayerName(name: string): ParsedBarcodeName | null {
	if (!isBarcodeLayerName(name)) return null;
	const [head, ...rest] = splitOptions(name.slice("barcode:".length));
	const options = readOptions(rest);
	const body = head.trim();

	// A value that opens with a field or a quote names no symbology, so a colon
	// inside it (a URL in a template) is part of the value.
	const colon =
		body.startsWith("{{") || body.startsWith('"') ? -1 : body.indexOf(":");
	if (colon === -1) {
		// A bare symbology name is a layer that forgot its value, not a literal
		// Code 128 spelling "ean13".
		const named = resolveSymbology(body);
		if (named.ok || QR_NAMES.has(normalize(body))) {
			return {
				symbology: named.ok ? named.symbology : null,
				value: "",
				mode: "literal",
				ids: [],
				options,
				problem: named.ok ? "The layer name has no value" : named.message,
			};
		}
		return { symbology: DEFAULT_SYMBOLOGY, ...readValue(body), options };
	}

	const symbology = resolveSymbology(body.slice(0, colon));
	const value = readValue(body.slice(colon + 1));
	const problem = !symbology.ok
		? symbology.message
		: value.value === ""
			? "The layer name has no value"
			: undefined;
	return {
		symbology: symbology.ok ? symbology.symbology : null,
		...value,
		options,
		...(problem ? { problem } : {}),
	};
}
