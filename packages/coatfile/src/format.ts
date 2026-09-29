// The wire format's own version, as `format_version` carries it.
//
// A major version is a contract: a reader refuses one it does not know. A minor
// version only adds optional fields, so every 1.x file reads with any 1.x kit.
// What a minor version does restrict is writing. Validation strips keys it does
// not recognise, so a kit that re-saves a file from a newer minor would drop
// whatever that minor added. `formatVersionStatus` is how a writer finds out
// before it does that.
//
//   1.0  the original format
//   1.1  `product` and `version` optional; `$schema` recognised
//   1.2  linear fill `from` / `to`; element `constraints`
//   1.3  barcode element
//   1.4  variant deltas: pos, size, rotation, opacity, hidden
//   1.5  grid layout; element `adjust`; image `focus` and `crop`

export const FORMAT_MAJOR = 1;
export const FORMAT_MINOR = 5;

/** What a writer puts in `format_version` for a template it produced. */
export const FORMAT_VERSION = `${FORMAT_MAJOR}.${FORMAT_MINOR}`;

export type FormatVersionStatus =
	/** This kit reads and writes it without losing anything. */
	| "current"
	/** Readable, but written by a newer kit: re-saving it may drop fields. */
	| "newer"
	/** A major version, or a string, this kit does not read at all. */
	| "unsupported";

export function formatVersionStatus(
	formatVersion: unknown,
): FormatVersionStatus {
	if (typeof formatVersion !== "string") return "unsupported";
	const match = /^(\d+)(?:\.(\d+))?/.exec(formatVersion.trim());
	if (!match) return "unsupported";
	if (Number(match[1]) !== FORMAT_MAJOR) return "unsupported";
	const minor = match[2] === undefined ? 0 : Number(match[2]);
	return minor > FORMAT_MINOR ? "newer" : "current";
}
