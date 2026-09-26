import type { Template } from "@freshcoat/coatfile";

export const HISTORY_CAP = 200;
export const MERGE_WINDOW_MS = 1000;

export type History = {
	past: Template[];
	present: Template;
	future: Template[];
	/** The last commit's merge key and when it landed. */
	merge?: { key: string; at: number };
	/** An open transaction and the state it started from. */
	tx?: { base: Template };
};

export function createHistory(t: Template): History {
	return { past: [], present: t, future: [] };
}

const clock = () => Date.now();

/**
 * Pushes `next`. A commit with the same `mergeKey` as the previous one, less
 * than a second after it, replaces `present` instead, so a burst of edits to
 * one field is one undo step. Inside a transaction a commit only previews.
 */
export function commit(
	h: History,
	next: Template,
	opts: { mergeKey?: string; now?: number } = {},
): History {
	if (h.tx) return preview(h, next);
	if (next === h.present) return h;
	const now = opts.now ?? clock();
	const merge = opts.mergeKey ? { key: opts.mergeKey, at: now } : undefined;
	if (
		merge &&
		h.merge?.key === merge.key &&
		now - h.merge.at < MERGE_WINDOW_MS &&
		h.past.length > 0
	)
		return { past: h.past, present: next, future: [], merge };
	return {
		past: [...h.past, h.present].slice(-HISTORY_CAP),
		present: next,
		future: [],
		...(merge ? { merge } : {}),
	};
}

export function begin(h: History): History {
	return h.tx ? h : { ...h, tx: { base: h.present } };
}

/** Shows `next` without recording it; opens a transaction if none is. */
export function preview(h: History, next: Template): History {
	const open = begin(h);
	return next === open.present ? open : { ...open, present: next };
}

/** Closes the transaction as one entry, or as nothing if nothing changed. */
export function end(h: History): History {
	if (!h.tx) return h;
	const { base } = h.tx;
	if (h.present === base)
		return { past: h.past, present: h.present, future: h.future };
	return {
		past: [...h.past, base].slice(-HISTORY_CAP),
		present: h.present,
		future: [],
	};
}

export function cancel(h: History): History {
	if (!h.tx) return h;
	return {
		past: h.past,
		present: h.tx.base,
		future: h.future,
		...(h.merge ? { merge: h.merge } : {}),
	};
}

/** Steps back one entry. During a transaction, cancels it instead. */
export function undo(h: History): History {
	if (h.tx) return cancel(h);
	const prev = h.past.at(-1);
	if (prev === undefined) return h;
	return {
		past: h.past.slice(0, -1),
		present: prev,
		future: [h.present, ...h.future],
	};
}

export function redo(h: History): History {
	if (h.tx) return h;
	const [next, ...rest] = h.future;
	if (next === undefined) return h;
	return {
		past: [...h.past, h.present].slice(-HISTORY_CAP),
		present: next,
		future: rest,
	};
}

export const canUndo = (h: History) => h.past.length > 0 || h.tx !== undefined;
export const canRedo = (h: History) => !h.tx && h.future.length > 0;
