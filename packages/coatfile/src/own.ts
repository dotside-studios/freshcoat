/** `obj[key]` when `key` is an own property, else undefined. Keys that come
 *  from a template or from values must never reach inherited properties. */
export function ownValue<T>(
	obj: Readonly<Record<string, T>>,
	key: string,
): T | undefined {
	return Object.hasOwn(obj, key) ? obj[key] : undefined;
}
