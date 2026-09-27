import type { Element, InlineAsset, Template } from "@freshcoat-js/coatfile";
import { parseAssetUri } from "@freshcoat-js/coatfile";
import { svgMarkup } from "./svg";

type Payload = { freshcoat: 1; elements: Element[]; assets: InlineAsset[] };

export type Clip =
	| { kind: "layers"; elements: Element[]; assets: InlineAsset[] }
	| { kind: "svg"; svg: string }
	| { kind: "text"; text: string };

// The system clipboard can be refused (no permission, an insecure context), so
// the last copy is also kept here.
let memory: Payload | null = null;

export async function writeClipboard(
	t: Template,
	elements: Element[],
): Promise<void> {
	const shas = new Set<string>();
	const walk = (v: unknown) => {
		if (typeof v === "string") {
			const sha = parseAssetUri(v);
			if (sha) shas.add(sha);
		} else if (Array.isArray(v)) v.forEach(walk);
		else if (v && typeof v === "object") Object.values(v).forEach(walk);
	};
	walk(elements);
	const payload: Payload = {
		freshcoat: 1,
		elements,
		assets: (t.assets ?? []).filter((a) => shas.has(a.sha256)),
	};
	memory = payload;
	try {
		await navigator.clipboard.writeText(JSON.stringify(payload));
	} catch {}
}

export async function readClipboard(): Promise<Clip | null> {
	let text: string | null = null;
	try {
		text = await navigator.clipboard.readText();
	} catch {}
	if (text) {
		const parsed = parsePayload(text);
		if (parsed)
			return {
				kind: "layers",
				elements: parsed.elements,
				assets: parsed.assets,
			};
		if (memory && text === JSON.stringify(memory))
			return { kind: "layers", ...memory };
		const svg = svgMarkup(text);
		if (svg) return { kind: "svg", svg };
		return { kind: "text", text };
	}
	return memory ? { kind: "layers", ...memory } : null;
}

export function parsePayload(text: string): Payload | null {
	if (!text.startsWith("{")) return null;
	try {
		const v = JSON.parse(text) as Partial<Payload>;
		if (v.freshcoat !== 1 || !Array.isArray(v.elements)) return null;
		return {
			freshcoat: 1,
			elements: v.elements,
			assets: Array.isArray(v.assets) ? v.assets : [],
		};
	} catch {
		return null;
	}
}
