import { EDIT_STATUS_ITEMS } from "~/canvas/status-items";
import { ISSUES_ITEM } from "../IssuesPopover";
import type { StatusItem } from "./types";

export { STATUS_PRIORITY } from "./priority";

/** The only list the shell reads. */
export const STATUS_ITEMS: readonly StatusItem[] = [
	...EDIT_STATUS_ITEMS,
	ISSUES_ITEM,
];
