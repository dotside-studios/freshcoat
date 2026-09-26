import {
	type Background,
	type BarcodeEncoder,
	childElements,
	type Element,
	getBarcodeEncoder,
	setBarcodeEncoder,
	type Template,
} from "@freshcoat/coatfile";
import { useEffect, useSyncExternalStore } from "react";

// bwip-js is ~87 KB gzipped and most templates have no barcode, so the encoder
// is a chunk of its own, fetched the first time something needs it: a template
// with a barcode opens, or the Barcode tool is chosen. Once it resolves it is
// registered for every `compile` on the main thread.
let loading: Promise<BarcodeEncoder> | null = null;
let failed = false;
const listeners = new Set<() => void>();

function notify() {
	for (const fn of listeners) fn();
}

export type BarcodeEncoderState = "missing" | "loading" | "ready" | "failed";

export function barcodeEncoderState(): BarcodeEncoderState {
	if (getBarcodeEncoder()) return "ready";
	if (loading) return "loading";
	return failed ? "failed" : "missing";
}

/** Registers `bwipBarcodeEncoder`, loading its chunk once. A failed load is
 *  retried by the next call. */
export function loadBarcodeEncoder(): Promise<BarcodeEncoder> {
	const have = getBarcodeEncoder();
	if (have) return Promise.resolve(have);
	if (!loading) {
		failed = false;
		loading = import("@freshcoat/coatfile/barcode").then(
			({ bwipBarcodeEncoder }) => {
				setBarcodeEncoder(bwipBarcodeEncoder);
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
