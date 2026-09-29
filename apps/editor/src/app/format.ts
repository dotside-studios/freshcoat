// Numbers, sizes and dates in the reader's locale. The words around them stay
// English: this is formatting, not translation.

let pinned: string | undefined;
const numberFormats = new Map<string, Intl.NumberFormat>();

/** Fixes the locale, as tests do; undefined goes back to the browser's. */
export function setFormatLocale(locale: string | undefined): void {
	pinned = locale;
	numberFormats.clear();
}

/** The locale numbers and dates are formatted in: the pinned one, else the
 *  browser's, else en-US when the browser names none Intl knows. */
export function formatLocale(): string {
	const wanted =
		pinned ??
		(typeof navigator === "undefined" ? undefined : navigator.language);
	if (wanted) {
		try {
			return Intl.getCanonicalLocales(wanted)[0] ?? "en-US";
		} catch {}
	}
	return "en-US";
}

/** 2400 as "2,400", "2.400" or "2 400", as the locale writes it. */
export function formatNumber(
	n: number,
	options?: Intl.NumberFormatOptions,
): string {
	const locale = formatLocale();
	const key = `${locale}\u0000${options ? JSON.stringify(options) : ""}`;
	let format = numberFormats.get(key);
	if (!format) {
		format = new Intl.NumberFormat(locale, options);
		numberFormats.set(key, format);
	}
	return format.format(n);
}

/** A date, a time or both, as `options` asks, in the locale's order. With no
 *  options, the date and time as the locale writes them by default. */
export function formatDate(
	date: Date,
	options?: Intl.DateTimeFormatOptions,
): string {
	return date.toLocaleString(formatLocale(), options);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/** A size for people: binary units, one decimal below 10 and whole numbers
 *  above, so a figure stays short enough for a status line. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "";
	let n = bytes;
	let unit = 0;
	while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
		n /= 1024;
		unit++;
	}
	const value =
		unit === 0 || n >= 10
			? formatNumber(Math.round(n), { useGrouping: false })
			: formatNumber(n, {
					minimumFractionDigits: 1,
					maximumFractionDigits: 1,
				});
	return `${value} ${BYTE_UNITS[unit]}`;
}
