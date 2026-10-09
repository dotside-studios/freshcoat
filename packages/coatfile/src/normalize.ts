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

/** What joins an id to the number that makes it unique: `_` gives
 *  `Vector_2`, `-` gives `title-2`. */
export type IdSeparator = "_" | "-";

export type FreeIdOptions = {
	/** Default `_`. */
	separator?: IdSeparator;
	/** Count on from a numbered id's stem, so a copy of `title-2` is `title-3`
	 *  rather than `title-2-2`. Default false. */
	fromStem?: boolean;
	/** The lowest number to try. */
	from?: number;
};

/** `base` when it is free, else `base<sep>2`, `base<sep>3`, and so on, the
 *  first one free. */
export function nextFreeId(
	base: string,
	isTaken: (id: string) => boolean,
	options: FreeIdOptions = {},
): string {
	if (!isTaken(base)) return base;
	const separator = options.separator ?? "_";
	const tail = options.fromStem
		? new RegExp(`^(.+)${separator}(\\d+)$`).exec(base)
		: null;
	const stem = tail ? (tail[1] as string) : base;
	let n = Math.max(tail ? Number(tail[2]) + 1 : 2, options.from ?? 2);
	while (isTaken(`${stem}${separator}${n}`)) n++;
	return `${stem}${separator}${n}`;
}

type Node = { id: string; type?: unknown; properties?: unknown };

export type UniquifyOptions = Omit<FreeIdOptions, "from"> & {
	/** Ids already in use. Every id kept or picked is added to it. */
	used?: Set<string>;
	/** Whether frame children and a mask's shape and content count too.
	 *  Default true. */
	deep?: boolean;
} & (
		| { inPlace?: false }
		| {
				/** Rename the elements themselves rather than copy them, for a
				 *  tree still being built whose elements are held elsewhere. */
				inPlace: true;
				/** Where an element's nested elements are, for a tree not yet
				 *  in the template's shape. Default: a frame's children, a
				 *  mask's shape then its content. */
				nested?: (el: Node) => readonly Node[][];
		  }
	);

type Nested = { children?: unknown; mask?: unknown };

function nestedOf(el: Node): Node[][] {
	if (el.type !== "frame" && el.type !== "mask") return [];
	const props = el.properties as Nested | undefined;
	const out: Node[][] = [];
	if (el.type === "mask" && props?.mask && typeof props.mask === "object")
		out.push([props.mask as Node]);
	if (Array.isArray(props?.children)) out.push(props.children as Node[]);
	return out;
}

/**
 * Gives every element, and with `deep` everything nested in one, an id no
 * earlier one has: the first occurrence keeps its id and later ones get the
 * next free suffix (`nextFreeId`). The walk is depth first, a mask's shape
 * before its content, so the same tree always gets the same ids. Unless
 * `inPlace`, unchanged elements and subtrees are returned as they are.
 */
export function uniquifyElementIdsDeep<T extends { id: string }>(
	elements: readonly T[],
	options: UniquifyOptions = {},
): T[] {
	const used = options.used ?? new Set<string>();
	const deep = options.deep ?? true;
	const isTaken = (id: string) => used.has(id);
	// base id -> the number after the last one picked for it
	const next = new Map<string, number>();
	const pick = (base: string): string => {
		const id = nextFreeId(base, isTaken, {
			...options,
			from: next.get(base) ?? 2,
		});
		if (id !== base) {
			const n = Number(id.slice(id.lastIndexOf(options.separator ?? "_") + 1));
			next.set(base, n + 1);
		}
		used.add(id);
		return id;
	};
	const idOf = (el: Node) => (typeof el.id === "string" ? el.id : "");

	if (options.inPlace) {
		const nested = options.nested ?? nestedOf;
		const walk = (els: readonly Node[]) => {
			for (const el of els) {
				el.id = pick(idOf(el));
				if (deep) for (const list of nested(el)) walk(list);
			}
		};
		walk(elements);
		return elements as T[];
	}

	const visit = <E extends Node>(el: E): E => {
		const id = pick(idOf(el));
		const renamed: E = id === el.id ? el : { ...el, id };
		const props = el.properties as Nested | undefined;
		if (!deep || !props || (el.type !== "frame" && el.type !== "mask"))
			return renamed;
		const mask =
			el.type === "mask" && props.mask && typeof props.mask === "object"
				? visit(props.mask as Node)
				: props.mask;
		const before = Array.isArray(props.children)
			? (props.children as Node[])
			: undefined;
		const children = before?.map(visit);
		const same =
			mask === props.mask &&
			(children ?? []).every((c, i) => c === before?.[i]);
		if (same) return renamed;
		return {
			...renamed,
			properties: {
				...props,
				...(children ? { children } : {}),
				...(mask !== undefined ? { mask } : {}),
			},
		};
	};
	return elements.map(visit);
}

// Figma authors routinely leave several nodes at the default name ("Vector",
// "Rectangle", "Frame"), and the importer slugs node names into element ids,
// so a single frame can end up with several elements sharing one id. `validate`
// rejects that (per-frame `duplicate_element_id`). The first occurrence keeps
// its id; later collisions get a numeric suffix (`_2`, `_3`, …), skipping any
// id already taken. Nested elements are left alone.
export function uniquifyElementIds<T extends { id: string }>(
	elements: T[],
): T[] {
	return uniquifyElementIdsDeep(elements, { deep: false });
}

export type HealOptions = {
	/** Also rename ids repeated anywhere in a side's tree, the background
	 *  included. Default false: `validate` only refuses repeats among a side's
	 *  top-level elements, and healing renames no more than it must. */
	deep?: boolean;
} & Omit<FreeIdOptions, "from">;

// Whole-template form of the above, run over a template on the way in.
// Idempotent, so it is safe on already-clean input.
export function healElementIds<T>(template: T, options: HealOptions = {}): T {
	const t = template as { template_data?: unknown };
	if (!Array.isArray(t.template_data)) return template;
	const deep = options.deep ?? false;
	return {
		...t,
		template_data: t.template_data.map((frame) => {
			const f = frame as { elements?: unknown; background?: unknown };
			const before = f.elements;
			if (!Array.isArray(before)) return frame;
			const used = new Set<string>();
			const background = f.background as { id?: unknown } | undefined;
			if (deep && typeof background?.id === "string") used.add(background.id);
			const elements = uniquifyElementIdsDeep(before, {
				...options,
				deep,
				used,
			});
			return elements.every((el, i) => el === before[i])
				? frame
				: { ...f, elements };
		}),
	} as T;
}
