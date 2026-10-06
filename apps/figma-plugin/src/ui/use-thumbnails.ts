import { useEffect, useRef, useState } from "preact/hooks";
import type { MainToUi } from "~/shared/protocol";
import { postToMain } from "~/ui/post";

/**
 * Frame previews for a set of nodes, as object URLs keyed by node id.
 *
 * Requests are made once per node and cached for the session: an export is
 * real work in the main thread, and the caller's id list is recomputed on
 * every selection change. Pass only the ids actually on screen — a handful of
 * slots and colorways, never the whole page.
 *
 * A cached preview goes stale if the author edits that frame. Main pushes a
 * replacement for anything it changes itself (a resize), but an edit made
 * directly on the canvas won't refresh until the plugin reopens. That is the
 * deliberate trade: a preview is an aid to picking the right frame, and the
 * export always re-reads the live document regardless of what is shown here.
 */
export function useThumbnails(nodeIds: string[]): Record<string, string> {
	const [urls, setUrls] = useState<Record<string, string>>({});
	// Ids already asked for. Kept out of state so arrivals don't re-trigger the
	// request effect — that loop is the classic way this hook goes wrong.
	const requestedRef = useRef<Set<string>>(new Set());
	// Mirrors `urls` so replaced and unmounted object URLs can be revoked.
	const urlsRef = useRef<Record<string, string>>({});

	useEffect(() => {
		const onMessage = (e: MessageEvent): void => {
			const msg = e.data.pluginMessage as MainToUi | undefined;
			if (msg?.type !== "thumbnails") return;
			const next = { ...urlsRef.current };
			for (const item of msg.items) {
				const old = next[item.nodeId];
				if (old) URL.revokeObjectURL(old);
				next[item.nodeId] = URL.createObjectURL(
					new Blob([item.bytes as Uint8Array<ArrayBuffer>], {
						type: "image/png",
					}),
				);
				// Main sends unprompted replacements for frames it changed; make
				// sure a later render of the same id can ask again if it needs to.
				requestedRef.current.add(item.nodeId);
			}
			urlsRef.current = next;
			setUrls(next);
		};
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			for (const url of Object.values(urlsRef.current)) {
				URL.revokeObjectURL(url);
			}
			urlsRef.current = {};
		};
	}, []);

	const key = nodeIds.join(",");
	// Depends on `key`, the serialized form of nodeIds: depending on the array
	// itself would re-run on every render, since the caller builds it inline.
	useEffect(() => {
		const missing = nodeIds.filter(
			(id) => id !== "" && !requestedRef.current.has(id),
		);
		if (missing.length === 0) return;
		for (const id of missing) requestedRef.current.add(id);
		postToMain({ type: "request-thumbnails", nodeIds: missing });
	}, [key]);

	return urls;
}
