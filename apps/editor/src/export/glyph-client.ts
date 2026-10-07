import type { Template } from "@freshcoat-js/coatfile";
import { useEffect, useRef, useState } from "react";
import type { GlyphCheckItem, GlyphIssue } from "./glyph-preflight";
import type { GlyphWorkerReply, GlyphWorkerRequest } from "./protocol";

/** The part of `Worker` the client uses, so tests can hand it fakes. */
export type GlyphWorker = {
	postMessage(message: GlyphWorkerRequest): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<GlyphWorkerReply>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
};

/** Null where the browser has no workers. */
export const createGlyphWorker = (): GlyphWorker | null =>
	typeof Worker === "undefined"
		? null
		: (new Worker(new URL("./glyph-worker.ts", import.meta.url), {
				type: "module",
			}) as unknown as GlyphWorker);

const SETTLE_MS = 250;
const NONE: GlyphIssue[] = [];

/**
 * The characters the export's text can't draw, checked in a worker of its
 * own and rechecked when the template, fonts or items change. Only the last
 * request's answer is kept. Null until it arrives, and after a failed check.
 */
export function useGlyphPreflight(
	template: Template | undefined,
	fonts: Map<string, Uint8Array[]> | undefined,
	items: readonly GlyphCheckItem[],
	factory: () => GlyphWorker | null = createGlyphWorker,
): GlyphIssue[] | null {
	const [issues, setIssues] = useState<GlyphIssue[] | null>(null);
	const worker = useRef<GlyphWorker | null>(null);
	const sent = useRef<{ template?: Template; fonts?: Map<string, unknown> }>(
		{},
	);
	const nextId = useRef(0);
	const pending = useRef(0);
	const makeWorker = useRef(factory);

	useEffect(
		() => () => {
			worker.current?.terminate();
			worker.current = null;
		},
		[],
	);

	useEffect(() => {
		const id = ++nextId.current;
		pending.current = id;
		if (!template || items.length === 0) {
			setIssues(NONE);
			return;
		}
		setIssues(null);
		if (!fonts) return;
		const timer = setTimeout(() => {
			if (!worker.current) {
				const w = makeWorker.current();
				if (!w) return;
				w.onmessage = ({ data }) => {
					if (data.type === "error") sent.current = {};
					if (data.id !== pending.current) return;
					setIssues(data.type === "result" ? data.issues : null);
				};
				w.onerror = () => {
					w.terminate();
					worker.current = null;
					setIssues(null);
				};
				worker.current = w;
				sent.current = {};
			}
			const request: GlyphWorkerRequest = {
				type: "check",
				id,
				items: items.map(({ recordId, side, values, variantId }) => ({
					recordId,
					side,
					values,
					...(variantId ? { variantId } : {}),
				})),
			};
			if (sent.current.template !== template) request.template = template;
			if (sent.current.fonts !== fonts) request.fonts = [...fonts];
			worker.current.postMessage(request);
			sent.current = { template, fonts };
		}, SETTLE_MS);
		return () => clearTimeout(timer);
	}, [template, fonts, items]);

	return issues;
}
