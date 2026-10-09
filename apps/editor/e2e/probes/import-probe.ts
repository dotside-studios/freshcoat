import { guessMapping, headersOf } from "@freshcoat-js/workspace";
import { emptyDataset } from "@freshcoat-js/workspace/dataset";
import {
	importTable,
	inPageImporter,
	setTableImporter,
	tableImporter,
} from "~/data/table-import";

type Task = { start: number; duration: number };

function csv(records: number, width: number): Blob {
	const lines = [
		Array.from({ length: width }, (_, c) => `field ${c}`).join(","),
	];
	for (let r = 0; r < records; r++) {
		const cells = Array.from({ length: width }, (_, c) =>
			c === 0 ? `"Doe, J${r}"` : c === 1 ? String(r) : `v${r}_${c}`,
		);
		lines.push(cells.join(","));
	}
	return new Blob([lines.join("\r\n")], { type: "text/csv" });
}

function blocking(tasks: Task[], from: number, to: number) {
	const within = tasks.filter(
		(t) => t.start < to && t.start + t.duration > from,
	);
	return {
		ms: Math.round(to - from),
		longestTaskMs: Math.round(Math.max(0, ...within.map((t) => t.duration))),
		blockedMs: Math.round(
			within.reduce((n, t) => n + Math.max(t.duration - 50, 0), 0),
		),
	};
}

/** Reads and imports a generated CSV the way the wizard does, and the
 *  longest the page's own thread went without running a timer meanwhile.
 *  `inPage` reads it on the page. */
export async function runImportProbe(
	records: number,
	{ width = 20, inPage = false } = {},
) {
	const file = csv(records, width);
	setTableImporter(inPage ? inPageImporter() : null);
	const tasks: Task[] = [];
	let beating = true;
	let last = performance.now();
	const beat = () => {
		const now = performance.now();
		if (now - last > 50) tasks.push({ start: last, duration: now - last });
		last = now;
		if (beating) setTimeout(beat, 0);
	};
	setTimeout(beat, 0);
	const idle = () => new Promise((r) => setTimeout(r, 200));
	await idle();

	const t0 = performance.now();
	const table = await tableImporter().open(file, "big.csv");
	const t1 = performance.now();
	await idle();
	const head = table.sheets[0]?.rows ?? [];
	const mapping = guessMapping(headersOf(head, 0), [], head.slice(1, 201));
	const t2 = performance.now();
	const result = await importTable(table.id, 0, emptyDataset("big"), {
		headerRow: 0,
		mapping,
		mode: "append",
		dateOrder: "mdy",
	});
	const t3 = performance.now();
	await idle();
	beating = false;
	tableImporter().close(table.id);
	setTableImporter(null);
	return {
		bytes: file.size,
		records: result.dataset.records.length,
		read: blocking(tasks, t0, t1),
		import: blocking(tasks, t2, t3),
	};
}
