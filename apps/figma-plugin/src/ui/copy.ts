/** "1 field", "6 fields". Every count a person reads goes through here, so a
 *  singular is never left to chance at a call site. */
export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** "42 KB", "1.2 MB". Decimal units, as Figma and the browser's download list
 *  show a file's size. */
export function formatBytes(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Joins a short list for a sentence: "a", "a and b", "a, b and c". */
export function listOf(items: string[]): string {
	if (items.length <= 1) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const BINDING_GUIDE_URL =
	"https://github.com/dotside-studios/freshcoat/blob/master/apps/figma-plugin/README.md#field-markers";
