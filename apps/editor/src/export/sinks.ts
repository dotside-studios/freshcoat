import type { ExportDestination } from "@freshcoat-js/workspace";
import {
	createFolderSink,
	createPartZipSink,
	createStreamZipSink,
	type FolderHandle,
	type OutputSink,
	type PartZipSinkOptions,
} from "@freshcoat-js/workspace/export";

// ── Choosing a destination ─────────────────────────────────────────────────

type PickerWindow = {
	showDirectoryPicker?: (options?: {
		id?: string;
		mode?: "readwrite";
	}) => Promise<FolderHandle>;
	showSaveFilePicker?: (options?: {
		id?: string;
		suggestedName?: string;
		types?: { description: string; accept: Record<string, string[]> }[];
	}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;
};

/** Which destinations this browser can write to, with why not when it
 *  cannot. */
export function destinationSupport(
	win: unknown = typeof window !== "undefined" ? window : undefined,
): Record<ExportDestination, string | null> {
	const w = (win ?? {}) as PickerWindow;
	return {
		download: null,
		"zip-file":
			typeof w.showSaveFilePicker === "function"
				? null
				: "Not supported in this browser, use Download",
		folder:
			typeof w.showDirectoryPicker === "function"
				? null
				: "Not supported in this browser, use Download",
	};
}

function isAbort(e: unknown): boolean {
	return e instanceof DOMException && e.name === "AbortError";
}

/**
 * Asks for the destination and opens a sink on it. Call it straight from the
 * click: the pickers need the user's gesture. Resolves null when the picker
 * is dismissed. A destination the browser lacks falls back to a download.
 */
export async function openSink(
	destination: ExportDestination,
	name: string,
	options: Omit<PartZipSinkOptions, "name"> = {},
	win: unknown = typeof window !== "undefined" ? window : undefined,
): Promise<OutputSink | null> {
	const w = (win ?? {}) as PickerWindow;
	try {
		if (destination === "folder" && w.showDirectoryPicker) {
			const folder = await w.showDirectoryPicker({
				id: "freshcoat-export",
				mode: "readwrite",
			});
			return createFolderSink(folder);
		}
		if (destination === "zip-file" && w.showSaveFilePicker) {
			const file = await w.showSaveFilePicker({
				id: "freshcoat-export",
				suggestedName: `${name}.zip`,
				types: [
					{ description: "Zip file", accept: { "application/zip": [".zip"] } },
				],
			});
			return createStreamZipSink(await file.createWritable());
		}
	} catch (e) {
		if (isAbort(e)) return null;
		throw e;
	}
	return createPartZipSink({ name, ...options });
}
