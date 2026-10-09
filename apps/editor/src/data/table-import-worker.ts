// Reads table files and imports their records off the main thread. A parsed
// file stays here, by id, until the wizard closes it. An import's records and
// issues go back in parts, so no one message takes the page long to receive.

import type {
	ApplyMappingResult,
	DataRecord,
	Dataset,
	ImportIssue,
	ImportPlan,
} from "@freshcoat-js/workspace";
import { createTableStore, type OpenedTable } from "./table-store";

export type TableImportBody =
	| { kind: "open"; file: Blob; name: string }
	| {
			kind: "apply";
			table: number;
			sheet: number;
			dataset: Dataset;
			plan: ImportPlan;
	  }
	| { kind: "close"; table: number };

export type TableImportRequest = TableImportBody & { id: number };

export type TableImportReply =
	| { id: number; part: { records: DataRecord[]; issues: ImportIssue[] } }
	| { id: number; progress: { done: number; total: number } }
	| { id: number; ok: true; value: OpenedTable | ApplyMappingResult | null }
	| { id: number; ok: false; error: string; code?: string };

const PART = 5000;

type Scope = {
	postMessage(message: TableImportReply): void;
	onmessage: ((event: MessageEvent<TableImportRequest>) => void) | null;
};
const scope = self as unknown as Scope;
const store = createTableStore();

function sendInParts(id: number, result: ApplyMappingResult) {
	const { records } = result.dataset;
	const { issues } = result;
	for (let i = 0; i < Math.max(records.length, issues.length); i += PART) {
		scope.postMessage({
			id,
			part: {
				records: records.slice(i, i + PART),
				issues: issues.slice(i, i + PART),
			},
		});
	}
	return { ...result, dataset: { ...result.dataset, records: [] }, issues: [] };
}

async function handle(req: TableImportRequest) {
	switch (req.kind) {
		case "open":
			return store.open(req.file, req.name);
		case "apply":
			return sendInParts(
				req.id,
				store.apply(
					req.table,
					req.sheet,
					req.dataset,
					req.plan,
					(done, total) =>
						scope.postMessage({ id: req.id, progress: { done, total } }),
				),
			);
		case "close":
			store.close(req.table);
			return null;
	}
}

scope.onmessage = (event) => {
	const req = event.data;
	handle(req).then(
		(value) => scope.postMessage({ id: req.id, ok: true, value }),
		(err: unknown) =>
			scope.postMessage({
				id: req.id,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
				...((err as { code?: string }).code !== undefined
					? { code: (err as { code: string }).code }
					: {}),
			}),
	);
};
