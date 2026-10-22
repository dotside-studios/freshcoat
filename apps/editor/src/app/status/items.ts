import { EDIT_STATUS_ITEMS } from "~/canvas/status-items";
import { DATA_STATUS_ITEMS } from "~/data/status-items";
import { ISSUES_ITEM } from "../IssuesPopover";
import { ACTIVITY_ITEM } from "./Activity";
import { AUTOSAVE_ITEM } from "./AutosavePaused";
import type { StatusItem } from "./types";

export { STATUS_PRIORITY } from "./priority";

/** The only list the shell reads. */
export const STATUS_ITEMS: readonly StatusItem[] = [
	...EDIT_STATUS_ITEMS,
	...DATA_STATUS_ITEMS,
	ISSUES_ITEM,
	ACTIVITY_ITEM,
	AUTOSAVE_ITEM,
];
