// Runs without a DOMParser. Only predefined and numeric entities are decoded;
// DTDs and external entities are never resolved.

export class SvgError extends Error {
	override name = "SvgError";
}

export type XmlText = { text: string };
export type XmlElement = {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
};
export type XmlNode = XmlElement | XmlText;

const ENTITIES: Record<string, string> = {
	lt: "<",
	gt: ">",
	amp: "&",
	quot: '"',
	apos: "'",
};

export function decodeEntities(s: string): string {
	if (!s.includes("&")) return s;
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
		if (body[0] === "#") {
			const code =
				body[1] === "x" || body[1] === "X"
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[body] ?? whole;
	});
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const SPACE = /\s*/y;

// Reading recurses per element; this is well past any drawing and far short of
// the stack.
const MAX_XML_DEPTH = 512;

export function parseXml(src: string): XmlElement {
	let i = 0;
	let depth = 0;
	const fail = (msg: string): never => {
		throw new SvgError(`svg: ${msg} at ${i}`);
	};
	const skipSpace = () => {
		SPACE.lastIndex = i;
		SPACE.exec(src);
		i = SPACE.lastIndex;
	};
	const readName = () => {
		NAME.lastIndex = i;
		const m = NAME.exec(src);
		if (!m) fail("expected a name");
		i = NAME.lastIndex;
		return (m as RegExpExecArray)[0];
	};
	const skipUntil = (end: string) => {
		const at = src.indexOf(end, i);
		if (at < 0) fail(`unterminated, expected "${end}"`);
		i = at + end.length;
	};
	const skipDoctype = () => {
		let depth = 0;
		while (i < src.length) {
			const ch = src[i++];
			if (ch === "[") depth++;
			else if (ch === "]") depth--;
			else if (ch === ">" && depth <= 0) return;
			else if (ch === '"' || ch === "'") {
				const close = src.indexOf(ch, i);
				if (close < 0) break;
				i = close + 1;
			}
		}
		fail("unterminated DOCTYPE");
	};
	const skipMisc = (allowDoctype: boolean): boolean => {
		if (src.startsWith("<!--", i)) {
			i += 4;
			skipUntil("-->");
			return true;
		}
		if (src.startsWith("<?", i)) {
			i += 2;
			skipUntil("?>");
			return true;
		}
		if (allowDoctype && /^<!DOCTYPE/i.test(src.slice(i, i + 9))) {
			i += 9;
			skipDoctype();
			return true;
		}
		return false;
	};

	const readElement = (): XmlElement => {
		i++; // <
		if (++depth > MAX_XML_DEPTH)
			fail(`elements are nested deeper than ${MAX_XML_DEPTH}`);
		const name = readName();
		const attrs: Record<string, string> = {};
		for (;;) {
			const before = i;
			skipSpace();
			if (src.startsWith("/>", i)) {
				i += 2;
				depth--;
				return { name, attrs, children: [] };
			}
			if (src[i] === ">") {
				i++;
				break;
			}
			if (i === before) fail("expected whitespace before an attribute");
			const key = readName();
			skipSpace();
			if (src[i] !== "=") fail(`attribute "${key}" has no value`);
			i++;
			skipSpace();
			const quote = src[i];
			if (quote !== '"' && quote !== "'") fail(`attribute "${key}" is unquoted`);
			const end = src.indexOf(quote as string, i + 1);
			if (end < 0) fail(`attribute "${key}" is unterminated`);
			if (key in attrs) fail(`attribute "${key}" is repeated`);
			attrs[key] = decodeEntities(src.slice(i + 1, end));
			i = end + 1;
		}
		const children: XmlNode[] = [];
		let text = "";
		const flush = () => {
			if (text) children.push({ text: decodeEntities(text) });
			text = "";
		};
		for (;;) {
			if (i >= src.length) fail(`"${name}" is not closed`);
			const lt = src.indexOf("<", i);
			if (lt < 0) {
				i = src.length;
				continue;
			}
			text += src.slice(i, lt);
			i = lt;
			if (src.startsWith("</", i)) {
				i += 2;
				const close = readName();
				if (close !== name) fail(`"${name}" closed by "${close}"`);
				skipSpace();
				if (src[i] !== ">") fail("expected >");
				i++;
				flush();
				depth--;
				return { name, attrs, children };
			}
			if (src.startsWith("<![CDATA[", i)) {
				const end = src.indexOf("]]>", i + 9);
				if (end < 0) fail("unterminated CDATA");
				flush();
				children.push({ text: src.slice(i + 9, end) });
				i = end + 3;
				continue;
			}
			if (skipMisc(false)) continue;
			flush();
			children.push(readElement());
		}
	};

	if (src.charCodeAt(0) === 0xfeff) i = 1;
	for (;;) {
		skipSpace();
		if (!skipMisc(true)) break;
	}
	if (src[i] !== "<") fail("expected a root element");
	const root = readElement();
	for (;;) {
		skipSpace();
		if (!skipMisc(false)) break;
	}
	if (i < src.length) fail("content after the root element");
	return root;
}

export function textContent(el: XmlElement): string {
	return el.children
		.map((c) => ("text" in c ? c.text : textContent(c)))
		.join("");
}
