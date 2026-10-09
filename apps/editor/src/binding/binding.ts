import type { SourceKind } from "@freshcoat-js/workspace";

export const SOURCE_KINDS: { id: SourceKind; label: string }[] = [
	{ id: "column", label: "Column" },
	{ id: "constant", label: "Fixed" },
	{ id: "serial", label: "Serial" },
	{ id: "default", label: "Default" },
];
