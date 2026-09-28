export type Declarations = Record<string, string>;

export type Selector =
	| { kind: "type"; name: string }
	| { kind: "class"; name: string }
	| { kind: "id"; name: string };

export type StyleRule = {
	selector: Selector;
	specificity: number;
	decls: Declarations;
};

export function parseStyleAttr(src: string): Declarations {
	const out: Declarations = {};
	for (const part of src.split(";")) {
		const colon = part.indexOf(":");
		if (colon < 0) continue;
		const key = part.slice(0, colon).trim().toLowerCase();
		const value = part
			.slice(colon + 1)
			.replace(/!important\s*$/i, "")
			.trim();
		if (key && value) out[key] = value;
	}
	return out;
}

const SIMPLE = /^(?:([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+))$/;

/** Reads the rules whose selectors are a single type, class or id. At-rules
 *  and every other selector are skipped. */
export function parseStyleSheet(css: string): StyleRule[] {
	const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules: StyleRule[] = [];
	let i = 0;
	while (i < src.length) {
		const open = src.indexOf("{", i);
		if (open < 0) break;
		const prelude = src.slice(i, open).trim();
		let depth = 1;
		let j = open + 1;
		while (j < src.length && depth > 0) {
			if (src[j] === "{") depth++;
			else if (src[j] === "}") depth--;
			j++;
		}
		const body = src.slice(open + 1, j - 1);
		i = j;
		if (prelude.startsWith("@")) continue;
		const decls = parseStyleAttr(body);
		for (const sel of prelude.split(",")) {
			const m = SIMPLE.exec(sel.trim());
			if (!m) continue;
			if (m[1])
				rules.push({ selector: { kind: "type", name: m[1] }, specificity: 1, decls });
			else if (m[2])
				rules.push({ selector: { kind: "class", name: m[2] }, specificity: 10, decls });
			else if (m[3])
				rules.push({ selector: { kind: "id", name: m[3] }, specificity: 100, decls });
		}
	}
	return rules;
}

/** The declarations the rules give an element, by specificity then order. */
export function matchRules(
	rules: StyleRule[],
	name: string,
	id: string | undefined,
	classes: string[],
): Declarations {
	const hits = rules
		.map((r, order) => ({ r, order }))
		.filter(({ r }) =>
			r.selector.kind === "type"
				? r.selector.name === name
				: r.selector.kind === "class"
					? classes.includes(r.selector.name)
					: r.selector.name === id,
		)
		.sort((a, b) => a.r.specificity - b.r.specificity || a.order - b.order);
	return Object.assign({}, ...hits.map((h) => h.r.decls));
}
