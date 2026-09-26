// On-the-way-in normalization: shapes a file that is *nearly* a template into
// one `validate` will accept, without changing what it draws. Each function here
// is idempotent, so a caller can run them over already-clean input.

// Before the figma plugin emitted templates directly, it wrote a wrapper: the
// template nested under `template`, with the assets / source / warnings that are
// now top-level fields sitting beside it. Flatten that into the current shape so
// an export still sitting in someone's downloads folder keeps opening.
// Anything that isn't a v1 bundle is returned untouched.
export function unwrapLegacyBundle(parsed: unknown): unknown {
	if (typeof parsed !== "object" || parsed === null) return parsed;
	const outer = parsed as {
		schemaVersion?: unknown;
		template?: unknown;
		assets?: unknown;
		source?: unknown;
		warnings?: unknown;
	};
	if (outer.schemaVersion !== 1) return parsed;
	if (typeof outer.template !== "object" || outer.template === null) {
		return parsed;
	}
	return {
		...outer.template,
		...(outer.source !== undefined ? { source: outer.source } : {}),
		...(Array.isArray(outer.assets) && outer.assets.length > 0
			? { assets: outer.assets }
			: {}),
		...(Array.isArray(outer.warnings) && outer.warnings.length > 0
			? { warnings: outer.warnings }
			: {}),
	};
}

// Figma authors routinely leave several nodes at the default name ("Vector",
// "Rectangle", "Frame"), and the importer slugs node names into element ids —
// so a single frame can end up with several elements sharing one id. `validate`
// rejects that (per-frame `duplicate_element_id`), which silently breaks the
// canvas preview. Run this over a frame's elements before handing the template
// to `compile`: the first occurrence keeps its id; later collisions get a
// numeric suffix (`_2`, `_3`, …), skipping any id already taken.
export function uniquifyElementIds<T extends { id: string }>(
	elements: T[],
): T[] {
	const seen = new Set<string>();
	return elements.map((el) => {
		if (!seen.has(el.id)) {
			seen.add(el.id);
			return el;
		}
		let n = 2;
		let candidate = `${el.id}_${n}`;
		while (seen.has(candidate)) {
			n += 1;
			candidate = `${el.id}_${n}`;
		}
		seen.add(candidate);
		return { ...el, id: candidate };
	});
}

// Whole-template form of the above. `validate` rejects a frame whose elements
// share an id, which is easy to produce by accident — the figma importer slugs
// layer names into ids, and a design with three layers called "Vector" yields
// three elements called `Vector`. Run this over a template on the way in.
// Idempotent, so it is safe on already-clean input.
export function healElementIds<T>(template: T): T {
	const t = template as { template_data?: unknown };
	if (!Array.isArray(t.template_data)) return template;
	return {
		...t,
		template_data: t.template_data.map((frame) => {
			const f = frame as { elements?: unknown };
			if (!Array.isArray(f.elements)) return frame;
			return { ...f, elements: uniquifyElementIds(f.elements) };
		}),
	} as T;
}
