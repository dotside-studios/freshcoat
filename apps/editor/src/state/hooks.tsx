import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import type { EditorState, EditorStore } from "./store";

const StoreContext = createContext<EditorStore | null>(null);

export function StoreProvider({
	store,
	children,
}: {
	store: EditorStore;
	children: ReactNode;
}) {
	return (
		<StoreContext.Provider value={store}>{children}</StoreContext.Provider>
	);
}

export function useStore(): EditorStore {
	const store = useContext(StoreContext);
	if (!store) throw new Error("useStore outside <StoreProvider>");
	return store;
}

/** Subscribes to one slice. The selector must return a stable value (a field
 *  of the state, or a primitive) or the component re-renders on every change. */
export function useEditor<T>(selector: (s: EditorState) => T): T {
	const store = useStore();
	return useSyncExternalStore(
		store.subscribe,
		() => selector(store.getState()),
		() => selector(store.getState()),
	);
}

/** Like useEditor, but re-renders at most once per `ms`, always ending on the
 *  latest value. For readouts that change on every frame. */
export function useThrottledEditor<T>(
	selector: (s: EditorState) => T,
	ms: number,
): T {
	const store = useStore();
	const [value, setValue] = useState(() => selector(store.getState()));
	useEffect(() => {
		let last = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const flush = () => {
			timer = undefined;
			last = performance.now();
			setValue(() => selector(store.getState()));
		};
		const unsubscribe = store.subscribe(() => {
			if (timer) return;
			const wait = last + ms - performance.now();
			if (wait <= 0) flush();
			else timer = setTimeout(flush, wait);
		});
		return () => {
			unsubscribe();
			if (timer) clearTimeout(timer);
		};
	}, [store, selector, ms]);
	return value;
}
