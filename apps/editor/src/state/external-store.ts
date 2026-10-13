import { useSyncExternalStore } from "react";

/** A value held outside React that components read with
 *  `useSyncExternalStore`. Setting an equal value (by `Object.is`) is a
 *  no-op. */
export type ExternalStore<T> = {
	get(): T;
	set(next: T | ((prev: T) => T)): void;
	subscribe(listener: () => void): () => void;
	/** The value, or a slice of it. The selector must return a stable value
	 *  (a field, or a primitive) or the component re-renders on every change. */
	useStore(): T;
	useStore<U>(selector: (value: T) => U): U;
};

/** Like `useState`, a function initial value is called for the value, here on
 *  the first read, so a store can load from storage lazily. */
export function createExternalStore<T>(
	initial: T | (() => T),
): ExternalStore<T> {
	let loaded = typeof initial !== "function";
	let value = initial as T;
	const listeners = new Set<() => void>();
	const get = (): T => {
		if (!loaded) {
			loaded = true;
			value = (initial as () => T)();
		}
		return value;
	};
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};
	function useStore<U>(selector?: (value: T) => U): T | U {
		const snapshot: () => T | U = selector ? () => selector(get()) : get;
		return useSyncExternalStore(subscribe, snapshot, snapshot);
	}
	return {
		get,
		set(next) {
			const prev = get();
			const resolved =
				typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
			if (Object.is(resolved, prev)) return;
			value = resolved;
			for (const listener of [...listeners]) listener();
		},
		subscribe,
		useStore: useStore as ExternalStore<T>["useStore"],
	};
}
