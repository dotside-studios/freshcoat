import {
	type BarcodeEncoder,
	getBarcodeEncoder,
	setBarcodeEncoder,
} from "./barcode-encoder";

let loading: Promise<BarcodeEncoder> | null = null;

/**
 * The registered encoder, or `bwipBarcodeEncoder` loaded and registered on
 * first use. Its chunk is only fetched when something needs it. A failed load
 * is retried by the next call.
 */
export function loadBarcodeEncoder(): Promise<BarcodeEncoder> {
	const have = getBarcodeEncoder();
	if (have) return Promise.resolve(have);
	loading ??= import("./barcode").then(
		({ bwipBarcodeEncoder }) => {
			setBarcodeEncoder(bwipBarcodeEncoder);
			loading = null;
			return bwipBarcodeEncoder;
		},
		(err: unknown) => {
			loading = null;
			throw err;
		},
	);
	return loading;
}
