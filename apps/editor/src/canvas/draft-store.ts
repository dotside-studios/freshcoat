import { useSyncExternalStore } from "react";
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
	let state: Drafts = { draft: {}, pen: null };
	const listeners = new Set<() => void>();
	const set = (next: Drafts) => {
		state = next;
		for (const l of listeners) l();
	};
	return {
		get: () => state,
		setDraft: (draft) => set({ ...state, draft }),
		setPen: (pen) => set({ ...state, pen }),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export function useDrafts(store: DraftStore): Drafts {
	return useSyncExternalStore(store.subscribe, store.get, store.get);
}
