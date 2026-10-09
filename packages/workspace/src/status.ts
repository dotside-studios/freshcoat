import type { DataRecord, Dataset, RecordStatus } from "./types";

export type RecordStatusExtra = {
	exportedAt?: string;
	errors?: Record<string, string>;
};

/** Sets one record's status when its id is wanted; an export result carries
 *  a time or an error. Returns the record itself when nothing changes. */
export function recordStatusSetter(
	ids: readonly string[],
	status: RecordStatus,
	extra: RecordStatusExtra = {},
): (r: DataRecord) => DataRecord {
	const wanted = new Set(ids);
	return (r) => {
		if (!wanted.has(r.id)) return r;
		const error = extra.errors?.[r.id];
		if (
			r.status === status &&
			!extra.exportedAt &&
			(error ?? undefined) === r.error
		)
			return r;
		const { error: _e, ...rest } = r;
		return {
			...rest,
			status,
			...(status === "exported" && extra.exportedAt
				? { exportedAt: extra.exportedAt }
				: r.exportedAt
					? { exportedAt: r.exportedAt }
					: {}),
			...(error ? { error } : {}),
		};
	};
}

/** Maps one dataset's records; the lists are copied only when a record
 *  changes. */
export function mapDatasetRecords(
	datasets: Dataset[],
	datasetId: string,
	set: (r: DataRecord) => DataRecord,
): Dataset[] {
	const at = datasets.findIndex((d) => d.id === datasetId);
	const dataset = datasets[at];
	if (!dataset) return datasets;
	let changed = false;
	const records = dataset.records.map((r) => {
		const next = set(r);
		if (next !== r) changed = true;
		return next;
	});
	if (!changed) return datasets;
	const out = [...datasets];
	out[at] = { ...dataset, records };
	return out;
}

/** Sets the status of some records; export results carry a time or an error. */
export function withRecordStatus(
	datasets: Dataset[],
	datasetId: string,
	ids: readonly string[],
	status: RecordStatus,
	extra: RecordStatusExtra = {},
): Dataset[] {
	return mapDatasetRecords(
		datasets,
		datasetId,
		recordStatusSetter(ids, status, extra),
	);
}
