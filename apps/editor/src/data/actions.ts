import { toast } from "@freshcoat/ui/toast";
import {
	type AddAssetsResult,
	type AssetFile,
	addPreparedAssets,
	columnsToJsonSchema,
	type Dataset,
	filesFromZip,
	imageContentType,
	isHiddenPath,
	type PreparedAsset,
	photoDataset,
	prepareAssets,
	type TableFormat,
} from "@freshcoat/workspace";
import { useSyncExternalStore } from "react";
import type { EditorController } from "~/app/controller";
import { plural } from "~/app/copy";
import { downloadBytes } from "~/app/download";
import type { BindingPatch } from "~/state/workspace";
import {
	rebindColumn,
	renameColumn,
	replaceDataset,
	uniqueName,
} from "./model";

export function currentDataset(
	controller: EditorController,
	id: string,
): Dataset | undefined {
	return controller.state.workspace?.datasets.find((d) => d.id === id);
}

/** Replaces one dataset as one history step, read fresh from the store. */
export function editDataset(
	controller: EditorController,
	id: string,
	edit: (dataset: Dataset) => Dataset,
	mergeKey?: string,
): Dataset | undefined {
	const ws = controller.state.workspace;
	const dataset = ws?.datasets.find((d) => d.id === id);
	if (!ws || !dataset) return undefined;
	const next = edit(dataset);
	if (next === dataset) return dataset;
	controller.dispatch({
		type: "datasetEdit",
		datasets: replaceDataset(ws.datasets, next),
		mergeKey,
	});
	return next;
}

/** Renames a column and repoints every template binding that reads it.
 *  Returns false when the key is not valid or already taken. */
export function renameColumnEverywhere(
	controller: EditorController,
	datasetId: string,
	from: string,
	to: string,
): boolean {
	const dataset = currentDataset(controller, datasetId);
	if (!dataset) return false;
	const renamed = renameColumn(dataset, from, to);
	if (!renamed) return false;
	if (renamed === dataset) return true;
	const ws = controller.state.workspace;
	if (!ws) return false;
	const bindings: BindingPatch = {};
	for (const slot of ws.templates) {
		if (!slot.binding) continue;
		const binding = rebindColumn(slot.binding, datasetId, from, to);
		if (binding) bindings[slot.id] = binding;
	}
	controller.dispatch({
		type: "datasetEdit",
		datasets: replaceDataset(ws.datasets, renamed),
		bindings,
	});
	return true;
}

/** Lets the person choose files; resolves with none when they cancel. */
export function pickFiles(opts: {
	accept?: string;
	multiple?: boolean;
	/** choose a folder, and get every file under it */
	directory?: boolean;
}): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		if (opts.accept) input.accept = opts.accept;
		input.multiple = !!opts.multiple;
		if (opts.directory) input.webkitdirectory = true;
		input.style.display = "none";
		input.dataset.testid = opts.directory
			? "data-folder-input"
			: "data-file-input";
		document.body.appendChild(input);
		const done = (files: File[]) => {
			input.remove();
			resolve(files);
		};
		input.addEventListener("change", () => done([...(input.files ?? [])]), {
			once: true,
		});
		input.addEventListener("cancel", () => done([]), { once: true });
		input.click();
	});
}

export const TABLE_ACCEPT =
	".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,.numbers,.json,.ndjson,.jsonl";

export const PHOTO_ACCEPT = "image/*,.zip";

/** A file with the path it had under the folder it was picked or dropped
 *  in, which is what says whether it sits in a hidden folder. */
export type PickedFile = { file: File; path: string };

function picked(file: File | PickedFile): PickedFile {
	return file instanceof File
		? { file, path: file.webkitRelativePath || file.name }
		: file;
}

type DirectoryHandle = {
	kind: "directory";
	name: string;
	values(): AsyncIterable<DirectoryHandle | FileHandle>;
};
type FileHandle = { kind: "file"; name: string; getFile(): Promise<File> };

async function walkHandle(
	dir: DirectoryHandle,
	prefix: string,
	out: PickedFile[],
): Promise<void> {
	for await (const entry of dir.values()) {
		const path = `${prefix}${entry.name}`;
		// A hidden folder is skipped whole rather than walked.
		if (entry.kind === "directory") {
			if (entry.name.startsWith(".")) continue;
			await walkHandle(entry, `${path}/`, out);
		} else {
			out.push({ file: await entry.getFile(), path });
		}
	}
}

/** Lets the person choose a folder: with the File System Access picker where
 *  the browser has one, and a directory input where it does not. */
export async function pickPhotoFolder(): Promise<PickedFile[]> {
	const picker = (
		window as unknown as {
			showDirectoryPicker?: (o?: { mode?: string }) => Promise<DirectoryHandle>;
		}
	).showDirectoryPicker;
	if (picker) {
		try {
			const dir = await picker({ mode: "read" });
			const out: PickedFile[] = [];
			await walkHandle(dir, `${dir.name}/`, out);
			return out;
		} catch (err) {
			if ((err as { name?: string })?.name === "AbortError") return [];
		}
	}
	return (await pickFiles({ directory: true, multiple: true })).map(picked);
}

type Entry = {
	isFile: boolean;
	isDirectory: boolean;
	name: string;
	fullPath: string;
	file?(ok: (f: File) => void, fail: (e: unknown) => void): void;
	createReader?(): {
		readEntries(ok: (e: Entry[]) => void, fail: (e: unknown) => void): void;
	};
};

async function walkEntry(entry: Entry, out: PickedFile[]): Promise<void> {
	const path = entry.fullPath.replace(/^\//, "");
	if (entry.isFile && entry.file) {
		const file = await new Promise<File>((ok, fail) => entry.file?.(ok, fail));
		out.push({ file, path });
		return;
	}
	if (!entry.isDirectory || !entry.createReader || entry.name.startsWith("."))
		return;
	const reader = entry.createReader();
	// readEntries hands a folder over in batches, until an empty one.
	for (;;) {
		const batch = await new Promise<Entry[]>((ok, fail) =>
			reader.readEntries(ok, fail),
		);
		if (batch.length === 0) return;
		for (const child of batch) await walkEntry(child, out);
	}
}

/** Whether a drag carries files or folders. */
export function dragHasFiles(dt: DataTransfer): boolean {
	return dt.types.includes("Files");
}

/** Every file a drop carries, walking into dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
	const entries: Entry[] = [];
	for (const item of [...dt.items]) {
		const entry = (
			item as { webkitGetAsEntry?: () => Entry | null }
		).webkitGetAsEntry?.();
		if (entry) entries.push(entry);
	}
	if (entries.length === 0) return [...dt.files].map(picked);
	const out: PickedFile[] = [];
	for (const entry of entries) await walkEntry(entry, out);
	return out;
}

/** Whether a drop is photos, zips or folders rather than a table or a
 *  template. */
export function isPhotoDrop(dt: DataTransfer): boolean {
	for (const item of [...dt.items]) {
		const entry = (
			item as { webkitGetAsEntry?: () => Entry | null }
		).webkitGetAsEntry?.();
		if (entry?.isDirectory) return true;
	}
	return [...dt.files].some(
		(f) => f.type.startsWith("image/") || /\.zip$/i.test(f.name),
	);
}

// ── Progress ──────────────────────────────────────────────────────────────

export type PhotoImportProgress = {
	label: string;
	done: number;
	total: number;
};

let progress: PhotoImportProgress | null = null;
const listeners = new Set<() => void>();

function setProgress(next: PhotoImportProgress | null): void {
	progress = next;
	for (const listener of listeners) listener();
}

/** The photo import running now, if any, for a progress bar. */
export function usePhotoImportProgress(): PhotoImportProgress | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => progress,
		() => null,
	);
}

/** Resolves on a fresh task once 16 ms of work have run since the last one,
 *  so a long loop leaves the page able to paint and take input. */
function yielder(): () => Promise<void> {
	let since = performance.now();
	return async () => {
		if (performance.now() - since < 16) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		since = performance.now();
	};
}

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

export type CollectedPhotos = {
	files: AssetFile[];
	/** hidden files and anything that is not an image */
	skipped: number;
};

/** The images among picked or dropped files, zips opened. */
export async function photoFiles(
	files: readonly (File | PickedFile)[],
): Promise<CollectedPhotos> {
	const out: AssetFile[] = [];
	let skipped = 0;
	const pause = yielder();
	for (const item of files) {
		await pause();
		const { file, path } = picked(item);
		if (isHiddenPath(path)) {
			skipped += 1;
			continue;
		}
		if (/\.zip$/i.test(file.name)) {
			try {
				const zip = await filesFromZip(file);
				out.push(...zip.files);
				skipped += zip.skipped;
			} catch {
				toast(`Couldn't read ${file.name}`, { tone: "danger" });
			}
			continue;
		}
		let contentType = file.type.startsWith("image/") ? file.type : undefined;
		if (contentType === undefined && !IMAGE_EXTENSION.test(file.name)) {
			const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
			const sniffed = imageContentType(file.name, head);
			if (sniffed.startsWith("image/")) contentType = sniffed;
		}
		if (contentType === undefined && !IMAGE_EXTENSION.test(file.name)) {
			skipped += 1;
			continue;
		}
		out.push({
			name: file.name,
			blob: file,
			...(contentType ? { contentType } : {}),
		});
	}
	return { files: out, skipped };
}

const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

/** Opens zips, drops hidden files and non-images, and hashes and measures
 *  the rest two at a time, with a progress bar. */
async function preparePhotos(
	source: readonly (File | PickedFile)[],
): Promise<{ prepared: PreparedAsset[]; skipped: number } | null> {
	setProgress({ label: "Reading photos", done: 0, total: source.length });
	try {
		const { files, skipped } = await photoFiles(source);
		if (files.length === 0) {
			toast(
				skipped
					? `No images found: ${plural(skipped, "file")} skipped`
					: "No images found",
				{ tone: "warning" },
			);
			return null;
		}
		files.sort((a, b) => collator.compare(a.name, b.name));
		setProgress({ label: "Reading photos", done: 0, total: files.length });
		const prepared = await prepareAssets(files, {
			onProgress: (done, total) =>
				setProgress({ label: "Reading photos", done, total }),
		});
		return { prepared, skipped };
	} finally {
		setProgress(null);
	}
}

type PhotoSource = readonly (File | PickedFile)[] | "files" | "folder";

async function resolveSource(
	source: PhotoSource,
): Promise<(File | PickedFile)[]> {
	if (source === "folder") return pickPhotoFolder();
	if (source === "files")
		return pickFiles({ accept: PHOTO_ACCEPT, multiple: true });
	return [...source];
}

/** Adds records for the photos an import added that no record shows. */
function appendUnmatched(
	controller: EditorController,
	datasetId: string,
	prepared: readonly PreparedAsset[],
	column: string,
): void {
	let appended = 0;
	editDataset(controller, datasetId, (d) => {
		const result = addPreparedAssets(d, prepared, {
			appendUnmatched: { column },
		});
		appended = result.appended;
		return result.appended ? result.dataset : d;
	});
	if (appended)
		toast(`Added ${plural(appended, "record")}`, { tone: "success" });
}

/**
 * Adds photos to a dataset and points image cells naming them at them. With
 * no files given, asks for them; "folder" asks for a folder. Resolves with
 * how many cells now show a photo.
 */
export async function importPhotos(
	controller: EditorController,
	datasetId: string,
	source: PhotoSource = "files",
): Promise<number> {
	const chosen = await resolveSource(source);
	if (chosen.length === 0) return 0;
	const ready = await preparePhotos(chosen);
	if (!ready) return 0;
	const dataset = currentDataset(controller, datasetId);
	if (!dataset) return 0;
	let result: AddAssetsResult | null = null;
	editDataset(controller, datasetId, (d) => {
		result = addPreparedAssets(d, ready.prepared);
		return result.dataset;
	});
	const done = result as AddAssetsResult | null;
	if (!done) return 0;
	const column = dataset.columns.find((c) => c.type === "image")?.key;
	const shown = new Set(
		done.dataset.records.flatMap((r) =>
			dataset.columns
				.filter((c) => c.type === "image")
				.map((c) => r.values[c.key]),
		),
	);
	const loose = ready.prepared.filter(
		(p) => !shown.has(`ws:${p.asset.sha256}`),
	);
	const parts = [
		`Imported ${plural(ready.prepared.length, "photo")}`,
		`${plural(done.rewritten, "cell")} matched`,
	];
	if (loose.length) parts.push(`${loose.length.toLocaleString()} unmatched`);
	if (ready.skipped) parts.push(`${ready.skipped.toLocaleString()} skipped`);
	toast(parts.join(", "), {
		tone: done.rewritten ? "success" : "info",
		timeout: loose.length && column ? 12000 : 6000,
		...(loose.length && column
			? {
					action: {
						label: `Add ${loose.length.toLocaleString()} as records`,
						onAction: () =>
							appendUnmatched(controller, datasetId, loose, column),
					},
				}
			: {}),
	});
	return done.rewritten;
}

/** A new dataset with one record per photo, made active. With no files
 *  given, asks for them; "folder" asks for a folder. */
export async function newDatasetFromPhotos(
	controller: EditorController,
	source: PhotoSource = "files",
	name?: string,
): Promise<Dataset | null> {
	const chosen = await resolveSource(source);
	if (chosen.length === 0) return null;
	const ready = await preparePhotos(chosen);
	if (!ready) return null;
	const ws = controller.state.workspace;
	if (!ws) return null;
	const folder = chosen
		.map((f) => picked(f).path.split("/"))
		.find((parts) => parts.length > 1)?.[0];
	const dataset = photoDataset(
		uniqueName(
			name ?? folder ?? "Photos",
			ws.datasets.map((d) => d.name),
		),
		ready.prepared,
	);
	controller.dispatch({
		type: "datasetEdit",
		datasets: [...ws.datasets, dataset],
		activeId: dataset.id,
	});
	toast(
		`Created ${dataset.name} from ${plural(dataset.records.length, "photo")}${ready.skipped ? `, ${ready.skipped.toLocaleString()} skipped` : ""}`,
		{ tone: "success", timeout: 6000 },
	);
	return dataset;
}

/** Photos for a dataset with no records yet: they become its records.
 *  One with an image column gets a record per photo, filling the photo
 *  columns it has; one with no columns becomes a photo dataset; anything
 *  else leaves it alone and makes a photo dataset beside it. */
export async function photosIntoEmptyDataset(
	controller: EditorController,
	datasetId: string,
	source: PhotoSource,
): Promise<void> {
	const target = currentDataset(controller, datasetId);
	if (!target) return;
	const column = target.columns.find((c) => c.type === "image")?.key;
	if (!column && target.columns.length > 0) {
		await newDatasetFromPhotos(controller, source);
		return;
	}
	const chosen = await resolveSource(source);
	if (chosen.length === 0) return;
	const ready = await preparePhotos(chosen);
	if (!ready) return;
	let added = 0;
	editDataset(controller, datasetId, (d) => {
		if (!column) {
			const made = photoDataset(d.name, ready.prepared, d.id);
			added = made.records.length;
			return made;
		}
		const result = addPreparedAssets(d, ready.prepared, {
			appendUnmatched: { column },
		});
		added = result.appended;
		return result.dataset;
	});
	toast(
		`Added ${plural(added, "photo")}${ready.skipped ? `, ${ready.skipped.toLocaleString()} skipped` : ""}`,
		{ tone: "success", timeout: 6000 },
	);
}

const TABLE_EXTENSION = new RegExp(
	`(${TABLE_ACCEPT.split(",")
		.map((e) => e.replace(".", "\\."))
		.join("|")})$`,
	"i",
);

/** Whether a file is one the import wizard reads. */
export function isTableFile(name: string): boolean {
	return TABLE_EXTENSION.test(name);
}

export const EXPORT_FORMATS: { id: TableFormat; label: string }[] = [
	{ id: "csv", label: "CSV" },
	{ id: "tsv", label: "TSV" },
	{ id: "xlsx", label: "Excel (.xlsx)" },
	{ id: "json", label: "JSON" },
	{ id: "ndjson", label: "NDJSON" },
];

export function safeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "dataset";
}

export async function exportDataset(
	dataset: Dataset,
	format: TableFormat,
): Promise<void> {
	try {
		const { writeTable } = await import("@freshcoat/workspace/tabular");
		const out = await writeTable(dataset, format);
		await downloadBytes(
			out.bytes,
			`${safeFileName(dataset.name)}.${out.extension}`,
			out.mediaType,
		);
	} catch (err) {
		toast(`Couldn't download ${dataset.name}: ${String(err)}`, {
			tone: "danger",
		});
	}
}

export async function exportJsonSchema(dataset: Dataset): Promise<void> {
	const schema = columnsToJsonSchema(dataset);
	await downloadBytes(
		`${JSON.stringify(schema, null, 2)}\n`,
		`${safeFileName(dataset.name)}.schema.json`,
		"application/schema+json",
	);
}
