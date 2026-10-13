import { useSyncExternalStore } from "react";
import { createExternalStore } from "~/state/external-store";
import type { OverlayDraft, PenDraft } from "./Overlay";

export type Drafts = { draft: OverlayDraft; pen: PenDraft | null };

/** The canvas's in-progress gesture state. Held outside React so a
 *  pointermove repaints the overlay alone, not the whole viewport. */
export type DraftStore = {
	get(): Drafts;
	setDraft(draft: OverlayDraft): void;
	setPen(pen: PenDraft | null): void;
	subscribe(listener: () => void): () => void;
};

export function createDraftStore(): DraftStore {
	const store = createExternalStore<Drafts>({ draft: {}, pen: null });
	return {
		get: store.get,
		setDraft: (draft) => store.set((s) => ({ ...s, draft })),
		setPen: (pen) => store.set((s) => ({ ...s, pen })),
		subscribe: store.subscribe,
	};
}

export function useDrafts(store: DraftStore): Drafts {
	return useSyncExternalStore(store.subscribe, store.get, store.get);
}
