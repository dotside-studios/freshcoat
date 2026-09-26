import { collectFontRequests, type Template } from "@freshcoat/coatfile";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveTemplateFonts } from "./fonts";

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
		resolveTemplateFonts(current)
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

export function fontKey(template: Template | null): {
	key: string;
	families: string[];
} {
	if (!template) return { key: "", families: [] };
	const requests = collectFontRequests(template);
	return {
		key: requests
			.map((r) => `${r.family}|${descriptorKey(r)}`)
			.sort()
			.join("\n"),
		families: requests.map((r) => r.family).sort(),
	};
}

function descriptorKey(
	request: ReturnType<typeof collectFontRequests>[number],
): string {
	if (!("descriptor" in request)) return "none";
	const d = request.descriptor;
	// A data: src can be large; its length and tail identify it well enough.
	return d.kind === "local"
		? `local:${d.files.map((f) => `${f.weight}:${f.src.length}:${f.src.slice(-32)}`).join(",")}`
		: `${d.kind}:${d.url}`;
}
