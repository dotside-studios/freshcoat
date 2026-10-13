import type { Dataset } from "@freshcoat-js/workspace";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import {
	createExternalStore,
	type ExternalStore,
} from "~/state/external-store";
import type { EditorState } from "~/state/store";
import type { GridUiStore } from "./grid-state";

export function selectActiveDataset(s: EditorState): Dataset | undefined {
	const ws = s.workspace;
	if (!ws) return undefined;
	return ws.datasets.find((d) => d.id === ws.activeDatasetId) ?? ws.datasets[0];
}

/** What the Data section shows of its dataset that the store does not hold:
 *  the rows left by its filters and selection, and the grid's cursor. */
export type DataView = {
	shown: number;
	selected: number;
	ui: GridUiStore;
};

export type DataViewStore = ExternalStore<DataView | null>;

const sessions = new WeakMap<object, DataViewStore>();

/** The Data section's view of its dataset, for the status bar to read while
 *  the section is mounted. */
export function dataViewFor(
	controller: Pick<EditorController, "state">,
): DataViewStore {
	let store = sessions.get(controller);
	if (!store) {
		store = createExternalStore<DataView | null>(null);
		sessions.set(controller, store);
	}
	return store;
}

export function useDataView(): DataView | null {
	return dataViewFor(useController()).useStore();
}
