import { assemblePdf } from "@freshcoat-js/workspace/pdf";
import type { PdfWorkerReply, PdfWorkerRequest } from "./protocol";

type Post = (message: PdfWorkerReply, transfer?: Transferable[]) => void;

export async function handlePdfRequest(
	{ pages, options }: PdfWorkerRequest,
	post: Post,
): Promise<void> {
	try {
		const out = await assemblePdf(pages, {
			...options,
			onProgress: (done, total) => post({ type: "progress", done, total }),
		});
		const bytes =
			out.byteOffset === 0 && out.byteLength === out.buffer.byteLength
				? out
				: out.slice();
		post({ type: "done", bytes }, [bytes.buffer]);
	} catch (e) {
		post({ type: "error", error: e instanceof Error ? e.message : String(e) });
	}
}

declare const WorkerGlobalScope: unknown;
if (typeof WorkerGlobalScope !== "undefined") {
	const scope = self as unknown as {
		postMessage: Post;
		onmessage: ((event: MessageEvent<PdfWorkerRequest>) => void) | null;
	};
	scope.onmessage = (event) =>
		void handlePdfRequest(event.data, (message, transfer = []) =>
			scope.postMessage(message, transfer),
		);
}
