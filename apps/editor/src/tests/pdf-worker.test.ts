// @vitest-environment node
import type { PdfPage } from "@freshcoat-js/workspace";
import { assemblePdf } from "@freshcoat-js/workspace/pdf";
import { describe, expect, it } from "vitest";
import { assemblePdfInWorker, type PdfWorker } from "~/export/pdf-client";
import { handlePdfRequest } from "~/export/pdf-worker";
import type { PdfAssembleOptions, PdfWorkerReply } from "~/export/protocol";

const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);

/** A worker that runs the PDF worker's handler in this thread, passing
 *  messages through a structured clone with their transfers, as a real one
 *  would. */
function inlineWorker() {
	const state = { terminated: false, transferred: 0 };
	const worker: PdfWorker = {
		onmessage: null,
		onerror: null,
		terminate() {
			state.terminated = true;
		},
		postMessage(message, transfer) {
			state.transferred = transfer.length;
			const request = structuredClone(message, { transfer });
			void handlePdfRequest(request, (reply, back = []) => {
				const cloned: PdfWorkerReply = structuredClone(reply, {
					transfer: back,
				});
				setTimeout(() => {
					if (!state.terminated)
						worker.onmessage?.({ data: cloned } as MessageEvent);
				}, 0);
			});
		},
	};
	return { worker, state };
}

function pages(count: number): PdfPage[] {
	return Array.from({ length: count }, (_, i) => ({
		bytes: PNG.slice(),
		format: "png" as const,
		widthPx: 1012,
		heightPx: 638,
		recordId: `r_${Math.floor(i / 2)}`,
		sideIndex: i % 2,
	}));
}

const DATE = new Date(Date.UTC(2026, 0, 1));

describe("assemblePdfInWorker", () => {
	for (const [label, options] of [
		["one image per page", { dpi: 300, title: "Cards", date: DATE }],
		[
			"sheets",
			{
				dpi: 300,
				title: "Cards",
				date: DATE,
				layout: {
					kind: "sheet",
					paper: "a4",
					orientation: "portrait",
					marginMm: 10,
					gapMm: 2,
					cropMarks: true,
					duplex: "none",
				},
			},
		],
	] as [string, PdfAssembleOptions][])
		it(`matches the main-thread PDF byte for byte: ${label}`, async () => {
			const expected = await assemblePdf(pages(4), options);
			const { worker, state } = inlineWorker();
			const progress: [number, number][] = [];
			const input = pages(4);
			const bytes = await assemblePdfInWorker(
				input,
				options,
				{ onProgress: (done, total) => progress.push([done, total]) },
				() => worker,
			);
			expect(bytes).toEqual(expected);
			expect(progress).toEqual([
				[1, 4],
				[2, 4],
				[3, 4],
				[4, 4],
			]);
			expect(state.transferred).toBe(4);
			expect(input[0]?.bytes.byteLength).toBe(0);
			expect(state.terminated).toBe(true);
		});

	it("terminates the worker and rejects when aborted", async () => {
		const { worker, state } = inlineWorker();
		const controller = new AbortController();
		const running = assemblePdfInWorker(
			pages(2),
			{ dpi: 300 },
			{ signal: controller.signal },
			() => worker,
		);
		controller.abort();
		await expect(running).rejects.toThrow("cancelled");
		expect(state.terminated).toBe(true);
	});

	it("rejects with the worker's error", async () => {
		const { worker } = inlineWorker();
		await expect(
			assemblePdfInWorker(pages(1), { dpi: 0 }, {}, () => worker),
		).rejects.toThrow(/dpi must be positive/);
	});
});
