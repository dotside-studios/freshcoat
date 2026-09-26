import { useSyncExternalStore } from "react";

export type CellRef = { row: string; col: string };

export type GridUiState = {
	/** The focused cell, kept when focus leaves the grid. */
	active: CellRef | null;
	/** The cell being edited; `seed` replaces its text when typing started
	 *  it, and `select` selects the text it starts with. */
	editing: (CellRef & { seed?: string; select?: boolean }) | null;
};

/** The grid's cursor, kept outside React state so a cell re-renders only
 *  when it starts or stops being active or edited. */
export class GridUiStore {
	private state: GridUiState = { active: null, editing: null };
	private listeners = new Set<() => void>();

	get = (): GridUiState => this.state;

	subscribe = (fn: () => void): (() => void) => {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	};

	set(patch: Partial<GridUiState>): void {
		const next = { ...this.state, ...patch };
		if (
			sameCell(next.active, this.state.active) &&
			sameCell(next.editing, this.state.editing) &&
			next.editing?.seed === this.state.editing?.seed
		)
			return;
		this.state = next;
		for (const fn of this.listeners) fn();
	}
}

export function sameCell(a: CellRef | null, b: CellRef | null): boolean {
	return a === b || (!!a && !!b && a.row === b.row && a.col === b.col);
}

export function useGridUi<T>(
	store: GridUiStore,
	select: (s: GridUiState) => T,
): T {
	return useSyncExternalStore(
		store.subscribe,
		() => select(store.get()),
		() => select(store.get()),
	);
}

/**
 * The record ids a selection names, in the order the rows are shown. The
 * table and the gallery share one selection; "all" is what Mod+A gives
 * either of them, and ids no longer shown are left out.
 */
export function selectionIds(
	selection: "all" | Iterable<string | number>,
	rows: readonly { id: string }[],
): string[] {
	if (selection === "all") return rows.map((r) => r.id);
	const chosen = new Set<string>();
	for (const k of selection) chosen.add(String(k));
	if (chosen.size === 0) return [];
	return rows.filter((r) => chosen.has(r.id)).map((r) => r.id);
}
