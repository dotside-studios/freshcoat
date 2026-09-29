import type { Template } from "@freshcoat-js/coatfile";
import { NO_GUIDES, type TemplateGuides } from "./guides";

export const HISTORY_CAP = 200;
export const MERGE_WINDOW_MS = 1000;

/**
 * Each step holds the template and its guides. Guides are editor state kept
 * in the workspace, not in the template, but they undo with it, so the two
 * stacks move in step.
 */
export type History = {
	past: Template[];
	present: Template;
	future: Template[];
	guides: TemplateGuides;
	pastGuides: TemplateGuides[];
	futureGuides: TemplateGuides[];
	/** The last commit's merge key and when it landed. */
	merge?: { key: string; at: number };
	/** An open transaction and the state it started from. */
	tx?: { base: Template; guides: TemplateGuides };
};

export function createHistory(
	t: Template,
	guides: TemplateGuides = NO_GUIDES,
): History {
	return {
		past: [],
		present: t,
		future: [],
		guides,
		pastGuides: [],
		futureGuides: [],
	};
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
	opts: { mergeKey?: string; now?: number; guides?: TemplateGuides } = {},
): History {
	const guides = opts.guides ?? h.guides;
	if (h.tx) return preview(h, next, guides);
	if (next === h.present && guides === h.guides) return h;
	const now = opts.now ?? clock();
	const merge = opts.mergeKey ? { key: opts.mergeKey, at: now } : undefined;
	if (
		merge &&
		h.merge?.key === merge.key &&
		now - h.merge.at < MERGE_WINDOW_MS &&
		h.past.length > 0
	)
		return {
			...pushed(h.past, h.pastGuides),
			present: next,
			guides,
			merge,
		};
	return {
		...pushed([...h.past, h.present], [...h.pastGuides, h.guides]),
		present: next,
		guides,
		...(merge ? { merge } : {}),
	};
}

/** Commits new guides with the template unchanged. */
export function commitGuides(
	h: History,
	guides: TemplateGuides,
	opts: { mergeKey?: string; now?: number } = {},
): History {
	return commit(h, h.present, { ...opts, guides });
}

function pushed(
	past: Template[],
	pastGuides: TemplateGuides[],
): Omit<History, "present" | "guides"> {
	return {
		past: past.slice(-HISTORY_CAP),
		pastGuides: pastGuides.slice(-HISTORY_CAP),
		future: [],
		futureGuides: [],
	};
}

export function begin(h: History): History {
	return h.tx ? h : { ...h, tx: { base: h.present, guides: h.guides } };
}

/** Shows `next` without recording it; opens a transaction if none is. */
export function preview(
	h: History,
	next: Template,
	guides: TemplateGuides = h.guides,
): History {
	const open = begin(h);
	return next === open.present && guides === open.guides
		? open
		: { ...open, present: next, guides };
}

/** Closes the transaction as one entry, or as nothing if nothing changed. */
export function end(h: History): History {
	if (!h.tx) return h;
	const { base, guides } = h.tx;
	const { tx: _tx, merge: _merge, ...rest } = h;
	if (h.present === base && h.guides === guides) return rest;
	return {
		...rest,
		...pushed([...h.past, base], [...h.pastGuides, guides]),
	};
}

export function cancel(h: History): History {
	if (!h.tx) return h;
	const { tx: _tx, ...rest } = h;
	return { ...rest, present: h.tx.base, guides: h.tx.guides };
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
		pastGuides: h.pastGuides.slice(0, -1),
		guides: h.pastGuides.at(-1) ?? NO_GUIDES,
		futureGuides: [h.guides, ...h.futureGuides],
	};
}

export function redo(h: History): History {
	if (h.tx) return h;
	const [next, ...rest] = h.future;
	if (next === undefined) return h;
	const [nextGuides, ...restGuides] = h.futureGuides;
	return {
		past: [...h.past, h.present].slice(-HISTORY_CAP),
		present: next,
		future: rest,
		pastGuides: [...h.pastGuides, h.guides].slice(-HISTORY_CAP),
		guides: nextGuides ?? NO_GUIDES,
		futureGuides: restGuides,
	};
}

export const canUndo = (h: History) => h.past.length > 0 || h.tx !== undefined;
export const canRedo = (h: History) => !h.tx && h.future.length > 0;
