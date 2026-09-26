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
	const value = unit === 0 || n >= 10 ? Math.round(n) : n.toFixed(1);
	return `${value} ${BYTE_UNITS[unit]}`;
}
