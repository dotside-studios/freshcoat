import {
	type ApplyMappingResult,
	type DataRecord,
	type Dataset,
	freshId,
	type ImportIssue,
	type ImportPlan,
} from "@freshcoat-js/workspace";
import type {
	TableImportBody,
	TableImportReply,
	TableImportRequest,
} from "./table-import-worker";
import {
	createTableStore,
	type ImportProgress,
	type OpenedTable,
} from "./table-store";

/** Where table files are read and imported. The default is a module worker;
 *  tests and browsers without workers read them on the page. */
export type TableImporter = {
	open(file: Blob, name: string): Promise<OpenedTable>;
	apply(
		table: number,
		sheet: number,
		dataset: Dataset,
		plan: ImportPlan,
		onProgress?: ImportProgress,
	): Promise<ApplyMappingResult>;
	close(table: number): void;
};

export function inPageImporter(): TableImporter {
	const store = createTableStore();
	return {
		open: (file, name) => store.open(file, name),
		apply: async (table, sheet, dataset, plan, onProgress) =>
			store.apply(table, sheet, dataset, plan, onProgress),
		close: (table) => store.close(table),
	};
}

function workerImporter(): TableImporter {
	let worker: Worker | null = null;
	let nextId = 1;
	const replies = new Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			onProgress?: ImportProgress;
		}
	>();
	const parts = new Map<
		number,
		{ records: DataRecord[]; issues: ImportIssue[] }
	>();
	const start = () => {
		const w = new Worker(new URL("./table-import-worker.ts", import.meta.url), {
			type: "module",
		});
		w.onmessage = (event: MessageEvent<TableImportReply>) => {
			const reply = event.data;
			if ("progress" in reply) {
				replies
					.get(reply.id)
					?.onProgress?.(reply.progress.done, reply.progress.total);
				return;
			}
			if ("part" in reply) {
				const got = parts.get(reply.id) ?? { records: [], issues: [] };
				for (const r of reply.part.records) got.records.push(r);
				for (const i of reply.part.issues) got.issues.push(i);
				parts.set(reply.id, got);
				return;
			}
			const waiter = replies.get(reply.id);
			const received = parts.get(reply.id);
			replies.delete(reply.id);
			parts.delete(reply.id);
			if (!waiter) return;
			if (!reply.ok)
				waiter.reject(
					Object.assign(new Error(reply.error), { code: reply.code }),
				);
			else if (received && reply.value && "dataset" in reply.value)
				waiter.resolve({
					...reply.value,
					dataset: { ...reply.value.dataset, records: received.records },
					issues: received.issues,
				});
			else waiter.resolve(reply.value);
		};
		w.onerror = () => {
			for (const waiter of replies.values())
				waiter.reject(new Error("the import worker failed"));
			replies.clear();
			parts.clear();
			w.terminate();
			worker = null;
		};
		return w;
	};
	const send = <T>(
		body: TableImportBody,
		onProgress?: ImportProgress,
	): Promise<T> => {
		worker ??= start();
		const id = nextId++;
		return new Promise<T>((resolve, reject) => {
			replies.set(id, {
				resolve: resolve as (v: unknown) => void,
				reject,
				...(onProgress ? { onProgress } : {}),
			});
			worker?.postMessage({ ...body, id } satisfies TableImportRequest);
		});
	};
	return {
		open: (file, name) => send({ kind: "open", file, name }),
		apply: (table, sheet, dataset, plan, onProgress) =>
			send({ kind: "apply", table, sheet, dataset, plan }, onProgress),
		close: (table) => {
			if (worker) void send({ kind: "close", table });
		},
	};
}

let importer: TableImporter | null = null;

/** Replaces where table files are read; `null` goes back to the default. */
export function setTableImporter(next: TableImporter | null): void {
	importer = next;
}

export function tableImporter(): TableImporter {
	importer ??=
		typeof Worker === "undefined" ? inPageImporter() : workerImporter();
	return importer;
}

/** `added` with any id already in `existing` minted again; the worker only
 *  saw the imported records. */
function uniqueIds(
	existing: readonly DataRecord[],
	added: readonly DataRecord[],
): DataRecord[] {
	const taken = new Set([...existing, ...added].map((r) => r.id));
	const ids = new Set(existing.map((r) => r.id));
	return added.map((r) => {
		if (!ids.has(r.id)) return r;
		const id = freshId("r", taken);
		taken.add(id);
		return { ...r, id };
	});
}

/**
 * The dataset with the table's rows imported, as `applyMapping` makes it.
 * Records the import cannot touch stay on the page: without a match the
 * existing ones are only carried along, so they are not sent. The assets come
 * back as the page's own.
 */
export async function importTable(
	table: number,
	sheet: number,
	dataset: Dataset,
	plan: ImportPlan,
	onProgress?: ImportProgress,
): Promise<ApplyMappingResult> {
	const matching = plan.mode === "append" && plan.match !== undefined;
	const out = await tableImporter().apply(
		table,
		sheet,
		matching ? dataset : { ...dataset, records: [] },
		plan,
		onProgress,
	);
	const records =
		matching || plan.mode === "replace"
			? out.dataset.records
			: [
					...dataset.records,
					...uniqueIds(dataset.records, out.dataset.records),
				];
	return {
		...out,
		dataset: { ...out.dataset, records, assets: dataset.assets },
	};
}
