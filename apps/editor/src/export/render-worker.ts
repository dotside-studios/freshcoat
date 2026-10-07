import { loadCanvasKit as loadCanvasKitAt } from "@freshcoat-js/canvaskit/browser";
import {
	compile,
	createParagraphEngine,
	setBarcodeEncoder,
	type Template,
} from "@freshcoat-js/coatfile";
import { bwipBarcodeEncoder } from "@freshcoat-js/coatfile/barcode";
import { createHeadlessEnv } from "@freshcoat-js/coatfile/headless";
import { renderCompiled } from "@freshcoat-js/coatfile/render";
import { fetchLoader } from "@freshcoat-js/engine";
import { crc32 } from "@freshcoat-js/workspace/crc";
import { gamutNotes, withPrintFallback } from "./print";
import type {
	OutputFormat,
	WorkerRenderRequest,
	WorkerReply,
	WorkerRequest,
} from "./protocol";
import { createJobCaches, createWorkerText } from "./worker-caches";

type WorkerScope = {
	postMessage(message: WorkerReply, transfer: Transferable[]): void;
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
	close(): void;
};
const scope = self as unknown as WorkerScope;

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped
type CK = any;

// The `full` build: the default one the editor's canvas uses has neither the
// JPEG nor the WebP encoder, and would answer every photo export in PNG.
const CANVASKIT_BASE = `${__CANVASKIT_BASE__}/full`;

let fonts = new Map<string, Uint8Array[]>();
const text = createWorkerText<ReturnType<typeof createParagraphEngine>>();
/** the template of the last render; the pool sends it only when it changes */
let current: Template | undefined;
const caches = createJobCaches();

function loadCanvasKit(): Promise<CK> {
	return loadCanvasKitAt(CANVASKIT_BASE);
}

/** A buffer the worker alone owns, so it can be transferred rather than copied. */
function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength &&
		bytes.buffer instanceof ArrayBuffer
		? (bytes as Uint8Array<ArrayBuffer>)
		: bytes.slice();
}

async function bytesOf(src: string, own: Map<string, Blob>) {
	const blob = own.get(src);
	if (blob) return new Uint8Array(await blob.arrayBuffer());
	return fetchLoader(src);
}

function setFonts(next: Map<string, Uint8Array[]>) {
	caches.clear();
	text.clear();
	fonts = next;
}

async function renderSide(req: WorkerRenderRequest) {
	if (req.template) current = req.template;
	const ck = await loadCanvasKit();
	const started = performance.now();
	const template = current;
	if (!template) throw new Error("no template");
	if (!template.template_data.some((f) => f.name === req.side))
		throw new Error(`no side named "${req.side}"`);
	const variantId =
		req.variantId && template.variants?.some((v) => v.id === req.variantId)
			? req.variantId
			: undefined;
	const own = new Map(req.images);
	const env = createHeadlessEnv({
		fonts,
		// Only this worker holds the bytes; fetch would miss the `ws:` reference.
		load: (src) => bytesOf(src, own),
		encode: {
			format: req.format,
			...(req.quality !== undefined ? { quality: req.quality } : {}),
		},
	});
	const design = req.resize ?? {
		width: template.width,
		height: template.height,
	};
	const compiled = compile(template, req.values, {
		width: design.width,
		height: design.height,
		variantId,
		...(req.resize ? { resize: req.resize } : {}),
		...(req.bleed ? { bleed: true } : {}),
		frameNames: [req.side],
	});
	const { engine, fontMetrics } = text.get(fonts, (f) =>
		createParagraphEngine(ck, f),
	);
	const painted = await withPrintFallback(req.print, async (print) => {
		const [result] = await renderCompiled(
			compiled,
			{
				frameNames: [req.side],
				...(print ? { print } : {}),
				exports: [
					req.scale === 1
						? {}
						: { constraint: { kind: "scale", value: req.scale } },
				],
			},
			{
				ck,
				env,
				fonts,
				fontMetrics,
				textEngine: engine,
				paintCache: caches.paint(),
				analysisCache: caches.analysis(),
				analysisKey: caches.analysisKey(template),
			},
		);
		if (!result || !("bytes" in result))
			throw new Error("nothing was rendered");
		return result;
	});
	const { result } = painted;
	// A placeholder in place of a code would print as if it scanned; the
	// item fails instead, with the encoder's reason.
	for (const w of result.warnings) {
		if (w.kind === "barcode_invalid") throw new Error(`Barcode: ${w.message}`);
		if (w.kind === "barcode_unavailable")
			throw new Error("Barcode: the encoder isn't loaded");
	}
	const gamut = painted.print === "on" ? gamutNotes(result.warnings) : [];
	const bytes = ownBytes(result.bytes);
	return {
		bytes,
		crc: crc32(bytes),
		format: (result.format ?? "png") as OutputFormat,
		width: result.width,
		height: result.height,
		ms: performance.now() - started,
		...(painted.print !== "off" ? { print: painted.print } : {}),
		...(painted.error ? { printError: painted.error } : {}),
		...(gamut.length > 0 ? { gamut } : {}),
	};
}

function reply(message: WorkerReply, transfer: Transferable[] = []) {
	scope.postMessage(message, transfer);
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

async function handle(msg: WorkerRequest): Promise<void> {
	switch (msg.type) {
		case "init": {
			setFonts(new Map(msg.fonts));
			setBarcodeEncoder(bwipBarcodeEncoder);
			const started = performance.now();
			try {
				await loadCanvasKit();
				reply({ type: "ready", ok: true, ms: performance.now() - started });
			} catch (e) {
				reply({ type: "ready", ok: false, error: errorText(e) });
			}
			return;
		}
		case "jobEnd":
			caches.clear();
			return;
		case "render":
			try {
				const out = await renderSide(msg);
				reply({ type: "render", id: msg.id, ok: true, ...out }, [
					out.bytes.buffer,
				]);
			} catch (e) {
				reply({ type: "render", id: msg.id, ok: false, error: errorText(e) });
			}
			return;
		case "dispose":
			setFonts(new Map());
			current = undefined;
			scope.close();
			return;
	}
}

// Messages are handled one at a time and in order, so an `init` sent before a
// `render` always applies to it, and a `jobEnd` waits for the renders before it.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;
	queue = queue.then(() => handle(msg));
};
