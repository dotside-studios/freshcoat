/** `obj[key]` when `key` is an own property, else undefined. Keys that come
 *  from a template or from values must never reach inherited properties. */
export function ownValue<T>(
	obj: Readonly<Record<string, T>>,
	key: string,
): T | undefined {
	return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** `obj[key] = value` that makes `__proto__` an own property instead of
 *  replacing the prototype. */
export function setOwn<T>(obj: Record<string, T>, key: string, value: T): void {
	if (key === "__proto__")
		Object.defineProperty(obj, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
	else obj[key] = value;
}
