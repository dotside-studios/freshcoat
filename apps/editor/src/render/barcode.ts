import {
	type Background,
	type BarcodeEncoder,
	childElements,
	type Element,
	type Template,
} from "@freshcoat-js/coatfile";
import { useEffect, useSyncExternalStore } from "react";

// bwip-js is ~87 KB gzipped and most templates have no barcode, so the encoder
// is a chunk of its own, fetched the first time something needs it: a template
// with a barcode opens, or the Barcode tool is chosen. Once it resolves, every
// `compile` on the main thread passes it on.
let encoder: BarcodeEncoder | null = null;
let loading: Promise<BarcodeEncoder> | null = null;
let failed = false;
const listeners = new Set<() => void>();

function notify() {
	for (const fn of listeners) fn();
}

export type BarcodeEncoderState = "missing" | "loading" | "ready" | "failed";

/** The encoder, once its chunk has loaded. */
export function barcodeEncoder(): BarcodeEncoder | null {
	return encoder;
}

export function barcodeEncoderState(): BarcodeEncoderState {
	if (encoder) return "ready";
	if (loading) return "loading";
	return failed ? "failed" : "missing";
}

/** Loads `bwipBarcodeEncoder`'s chunk once. A failed load is retried by the
 *  next call. */
export function loadBarcodeEncoder(): Promise<BarcodeEncoder> {
	if (encoder) return Promise.resolve(encoder);
	if (!loading) {
		failed = false;
		loading = import("@freshcoat-js/coatfile/barcode").then(
			({ bwipBarcodeEncoder }) => {
				encoder = bwipBarcodeEncoder;
				loading = null;
				notify();
				return bwipBarcodeEncoder;
			},
			(err: unknown) => {
				loading = null;
				failed = true;
				notify();
				throw err;
			},
		);
		notify();
	}
	return loading;
}

/** Whether any side of `t` draws a barcode, at any depth. */
export function hasBarcode(t: Template): boolean {
	const walk = (el: Element | Background): boolean =>
		el.type === "barcode" || childElements(el).some(walk);
	return t.template_data.some(
		(frame) => walk(frame.background) || frame.elements.some(walk),
	);
}

function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

/** The encoder's state, starting its load when `template` has a barcode. */
export function useBarcodeEncoder(
	template: Template | null,
): BarcodeEncoderState {
	const state = useSyncExternalStore(
		subscribe,
		barcodeEncoderState,
		barcodeEncoderState,
	);
	const needed = !!template && state === "missing" && hasBarcode(template);
	useEffect(() => {
		if (needed) loadBarcodeEncoder().catch(() => {});
	}, [needed]);
	return state;
}
