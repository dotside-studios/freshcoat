import {
	collectFontRequests,
	fontRequestKey,
	resolveTemplateFonts,
	type Template,
} from "@freshcoat-js/coatfile";
import { useEffect, useMemo, useRef, useState } from "react";
import { fontCache } from "./font-cache";

export type DocumentFonts = {
	fonts: Map<string, Uint8Array[]> | undefined;
	/** True until the fetch for the current font set settles. */
	loading: boolean;
	families: string[];
	declared: string[];
	guessed: string[];
	missing: string[];
};

type Report = {
	fonts: Map<string, Uint8Array[]>;
	declared: string[];
	guessed: string[];
	missing: string[];
};

const EMPTY: Report = {
	fonts: new Map(),
	declared: [],
	guessed: [],
	missing: [],
};

/**
 * The font bytes a document needs. Refetches only when the set of families or
 * their descriptors change, so the returned map keeps its identity across every
 * other edit (the render session caches on it).
 */
export function useDocumentFonts(template: Template | null): DocumentFonts {
	const computed = useMemo(() => fontKey(template), [template]);
	const key = computed.key;
	// Held by key, so an edit that leaves the fonts alone keeps the same array
	// and the fetch effect below does not run again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on purpose
	const families = useMemo(() => computed.families, [key]);
	const latest = useRef(template);
	latest.current = template;
	const [state, setState] = useState<{ key: string; report?: Report }>({
		key: "",
	});

	useEffect(() => {
		const current = latest.current;
		if (!current || key === "") {
			setState({ key, report: EMPTY });
			return;
		}
		let cancelled = false;
		resolveTemplateFonts(current, { cache: fontCache })
			.then((report) => {
				if (!cancelled) setState({ key, report });
			})
			.catch(() => {
				if (!cancelled)
					setState({ key, report: { ...EMPTY, missing: families } });
			});
		return () => {
			cancelled = true;
		};
	}, [key, families]);

	const ready = state.key === key && state.report;
	return {
		fonts: ready ? state.report?.fonts : undefined,
		loading: !ready,
		families,
		declared: (ready && state.report?.declared) || [],
		guessed: (ready && state.report?.guessed) || [],
		missing: (ready && state.report?.missing) || [],
	};
}

type FontKey = { key: string; families: string[] };

const fontKeys = new WeakMap<
	Template["template_data"],
	{ fonts: Template["fonts"]; variants: Template["variants"]; value: FontKey }
>();

export function fontKey(template: Template | null): FontKey {
	if (!template) return { key: "", families: [] };
	const { template_data, fonts, variants } = template;
	const cached = fontKeys.get(template_data);
	if (cached && cached.fonts === fonts && cached.variants === variants)
		return cached.value;
	const value = computeFontKey(template);
	fontKeys.set(template_data, { fonts, variants, value });
	return value;
}

function computeFontKey(template: Template): FontKey {
	const requests = collectFontRequests(template);
	return {
		key: requests.map(fontRequestKey).sort().join("\n"),
		families: requests.map((r) => r.family).sort(),
	};
}
