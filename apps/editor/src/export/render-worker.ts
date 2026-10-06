import {
	compile,
	createParagraphEngine,
	setBarcodeEncoder,
	type Template,
} from "@freshcoat-js/coatfile";
import { bwipBarcodeEncoder } from "@freshcoat-js/coatfile/barcode";
import { createHeadlessEnv } from "@freshcoat-js/coatfile/headless";
import { renderCompiled } from "@freshcoat-js/coatfile/render";
import { deriveFontMetrics } from "@freshcoat-js/engine";
import { crc32 } from "@freshcoat-js/workspace/crc";
import { createImageLru, DEFAULT_IMAGE_CACHE_PIXELS } from "./image-lru";
import { gamutNotes, withPrintFallback } from "./print";
import type {
	OutputFormat,
	WorkerRenderRequest,
	WorkerReply,
	WorkerRequest,
} from "./protocol";

type WorkerScope = {
	postMessage(message: WorkerReply, transfer: Transferable[]): void;
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
	close(): void;
};
const scope = self as unknown as WorkerScope;

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped
type CK = any;
type CkImage = { width(): number; height(): number; delete(): void };

// The `full` build: the default one the editor's canvas uses has neither the
// JPEG nor the WebP encoder, and would answer every photo export in PNG.
const CANVASKIT_BASE = `${__CANVASKIT_BASE__}/full`;

let ckPromise: Promise<CK> | undefined;
let fonts = new Map<string, Uint8Array[]>();
let text:
	| {
			engine: ReturnType<typeof createParagraphEngine>;
			fontMetrics: ReturnType<typeof deriveFontMetrics>;
	  }
	| undefined;
/** the template of the last render; the pool sends it only when it changes */
let current: Template | undefined;
/** images the template carries, sent once with `images` */
let carried = new Map<string, Blob>();
const decoded = createImageLru<CkImage>(DEFAULT_IMAGE_CACHE_PIXELS, (img) =>
	img.delete(),
);

function loadCanvasKit(): Promise<CK> {
	ckPromise ??= (async () => {
		const src = await (await fetch(`${CANVASKIT_BASE}/canvaskit.js`)).text();
		// An indirect eval runs the classic script at global scope, so its
		// top-level `var CanvasKitInit` becomes a global as it would from a script
		// tag. A module worker has no importScripts, and the script is our own asset.
		// biome-ignore lint/security/noGlobalEval: loads canvaskit.js in a module worker
		const indirectEval = globalThis.eval;
		indirectEval(src);
		const init = (
			globalThis as { CanvasKitInit?: (o: unknown) => Promise<unknown> }
		).CanvasKitInit;
		if (typeof init !== "function") throw new Error("CanvasKitInit missing");
		return init({ locateFile: () => `${CANVASKIT_BASE}/canvaskit.wasm` });
	})();
	ckPromise.catch(() => {
		ckPromise = undefined;
	});
	return ckPromise;
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
	const blob = own.get(src) ?? carried.get(src);
	if (blob) return new Uint8Array(await blob.arrayBuffer());
	const res = await fetch(src);
	if (!res.ok) throw new Error(`fetch ${src} -> ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

function setFonts(next: Map<string, Uint8Array[]>) {
	text?.engine.dispose();
	text = undefined;
	fonts = next;
}

function textFor(ck: CK) {
	text ??= {
		engine: createParagraphEngine(ck, fonts),
		fontMetrics: deriveFontMetrics(fonts),
	};
	return text;
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
	// The images this render has asked for stay decoded until it is done.
	const using = new Set<string>();
	const env = createHeadlessEnv({
		fonts,
		encode: {
			format: req.format,
			...(req.quality !== undefined ? { quality: req.quality } : {}),
		},
		async loadImage(src) {
			using.add(src);
			decoded.pin(using);
			const hit = decoded.get(src);
			if (hit) return hit;
			const img = ck.MakeImageFromEncoded(
				await bytesOf(src, own),
			) as CkImage | null;
			if (!img) return null;
			decoded.set(src, img, img.width() * img.height());
			return img;
		},
	});
	// Print analysis samples each photo from its encoded bytes, which only
	// this worker holds; the default would fetch the `ws:` reference.
	env.loadImageBytes = (src) => bytesOf(src, own);
	const design = req.resize ?? {
		width: template.width,
		height: template.height,
	};
	try {
		const compiled = compile(template, req.values, {
			width: design.width,
			height: design.height,
			variantId,
			...(req.resize ? { resize: req.resize } : {}),
			...(req.bleed ? { bleed: true } : {}),
			frameNames: [req.side],
		});
		const { engine, fontMetrics } = textFor(ck);
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
				{ ck, env, fonts, fontMetrics, textEngine: engine },
			);
			if (!result || !("bytes" in result))
				throw new Error("nothing was rendered");
			return result;
		});
		const { result } = painted;
		// A placeholder in place of a code would print as if it scanned; the
		// item fails instead, with the encoder's reason.
		for (const w of result.warnings) {
			if (w.kind === "barcode_invalid")
				throw new Error(`Barcode: ${w.message}`);
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
	} finally {
		decoded.pin([]);
	}
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
		case "images":
			carried = new Map(msg.entries);
			decoded.clear();
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
			carried = new Map();
			decoded.clear();
			scope.close();
			return;
	}
}

// Messages are handled one at a time and in order, so an `images` or `init`
// sent before a `render` always applies to it.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;
	queue = queue.then(() => handle(msg));
};
