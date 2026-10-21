import { parseColor } from "@freshcoat-js/engine";
import { hasToken } from "./mustache";
import { DEFAULT_QR_STYLE, MAX_QR_LOGO_SIZE, qrSymbol } from "./qr";
import type { QrCodeElement } from "./types";

export const MIN_QR_CONTRAST = 3;
/** Fewest quiet-zone modules a QR code drawing its own background keeps. ISO
 *  asks for 4; phone scanners read 2. */
export const MIN_QR_QUIET_ZONE = 2;

export type QrIssue =
	| { code: "qr_low_contrast"; ratio: number; min: number }
	| { code: "qr_inverted" }
	| { code: "qr_quiet_zone"; modules: number; min: number }
	| { code: "qr_logo_large"; size: number; max: number };

function luminance(color: string): number | null {
	const c = parseColor(color);
	if (!c || c === "none" || c[3] < 1) return null;
	const lin = (v: number) => {
		const s = v / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

const ratio = (a: number, b: number) =>
	(Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** What may stop a QR code from scanning. Colours and sizes a field fills are
 *  not checked, and colours only against a background the code draws itself. */
export function qrIssues(el: QrCodeElement): QrIssue[] {
	const p = el.properties;
	const out: QrIssue[] = [];
	const bg =
		p.background && !hasToken(p.background) ? luminance(p.background) : null;
	const inks = p.gradient
		? p.gradient.stops.map((s) => s.color)
		: [p.foreground ?? "#000000"];
	const fg = inks.some(hasToken) ? [] : inks.map(luminance);
	if (bg !== null && fg.length > 0 && fg.every((l) => l !== null)) {
		const lums = fg as number[];
		const lowest = Math.min(...lums.map((l) => ratio(l, bg)));
		if (lums.some((l) => l > bg)) out.push({ code: "qr_inverted" });
		else if (lowest < MIN_QR_CONTRAST)
			out.push({
				code: "qr_low_contrast",
				ratio: Math.round(lowest * 100) / 100,
				min: MIN_QR_CONTRAST,
			});
	}
	if (p.background) {
		const modules = quietZoneModules(el);
		if (modules !== null && modules < MIN_QR_QUIET_ZONE)
			out.push({
				code: "qr_quiet_zone",
				modules: Math.round(modules * 10) / 10,
				min: MIN_QR_QUIET_ZONE,
			});
	}
	if (p.logo && (p.logo.size ?? 0) > MAX_QR_LOGO_SIZE)
		out.push({
			code: "qr_logo_large",
			size: p.logo.size ?? 0,
			max: MAX_QR_LOGO_SIZE,
		});
	return out;
}

function quietZoneModules(el: QrCodeElement): number | null {
	const p = el.properties;
	const q = p.quietZone ?? 0;
	const margin = p.margin ?? 0;
	if (margin <= 0) return q;
	if (hasToken(p.value) || !el.size) return null;
	const n = qrSymbol(p.value, p.errorCorrection ?? "M", {
		...DEFAULT_QR_STYLE,
		logoSize: p.logo ? (p.logo.size ?? 0.2) : 0,
		logoPadding: p.logo?.padding ?? DEFAULT_QR_STYLE.logoPadding,
	}).size;
	if (n === 0) return null;
	const side = Math.min(el.size.width, el.size.height) - 2 * margin;
	if (side <= 0) return null;
	return q + margin / (side / (n + 2 * q));
}

export function describeQrIssue(issue: QrIssue): string {
	switch (issue.code) {
		case "qr_low_contrast":
			return `QR colours have a contrast of ${issue.ratio}:1, under ${issue.min}:1; scanners may not read it`;
		case "qr_inverted":
			return "QR modules are lighter than their background; many scanners only read dark on light";
		case "qr_quiet_zone":
			return `QR quiet zone is ${issue.modules} ${issue.modules === 1 ? "module" : "modules"}, under ${issue.min}; scanners may not find the code`;
		case "qr_logo_large":
			return `QR logo is ${Math.round(issue.size * 100)}% of the code; it is drawn at ${Math.round(issue.max * 100)}%`;
	}
}
