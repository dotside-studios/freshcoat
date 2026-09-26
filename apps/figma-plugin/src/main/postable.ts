// Figma rejects a postMessage payload containing anything it can't serialize,
// and says only "in postMessage: Cannot unwrap symbol" — naming neither the
// property nor the node it came from. The usual cause is `figma.mixed`, a
// symbol returned for any node property whose value varies across the node
// (mixed font sizes in one text, mixed corner radii on one frame). In a scene
// graph of a few hundred nodes that is a needle in a haystack, so when a post
// fails we walk the payload ourselves and name the path.

const MAX_DEPTH = 64;

function describe(value: unknown): string {
	const t = typeof value;
	return t === "symbol" ? String(value as symbol) : t;
}

/**
 * The path to the first value `figma.ui.postMessage` would refuse, or null if
 * the payload looks fine. Symbols and functions are the two things a plugin
 * realistically leaks; both are reported.
 *
 * Only called after a post has already thrown, so the walk costs nothing on the
 * happy path. Cycles and runaway depth are guarded — this runs while reporting
 * an error and must not become a second one.
 */
export function findUnpostable(
	value: unknown,
	path = "payload",
	seen: WeakSet<object> = new WeakSet(),
	depth = 0,
): string | null {
	if (depth > MAX_DEPTH) return null;

	const type = typeof value;
	if (type === "symbol" || type === "function") {
		return `${path} (${describe(value)})`;
	}
	if (value === null || type !== "object") return null;

	const obj = value as object;
	if (seen.has(obj)) return null;
	seen.add(obj);

	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const hit = findUnpostable(value[i], `${path}[${i}]`, seen, depth + 1);
			if (hit) return hit;
		}
		return null;
	}

	for (const [key, v] of Object.entries(obj)) {
		const hit = findUnpostable(v, `${path}.${key}`, seen, depth + 1);
		if (hit) return hit;
	}
	// A symbol-keyed property can't be enumerated by Object.entries but still
	// travels with the object.
	for (const key of Object.getOwnPropertySymbols(obj)) {
		return `${path}[${String(key)}] (symbol key)`;
	}
	return null;
}
