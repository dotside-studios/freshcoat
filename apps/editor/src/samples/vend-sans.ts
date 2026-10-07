import type { FontDescriptor } from "@freshcoat-js/coatfile";
import src from "./fonts/VendSans-Variable-latin.woff2?inline";
import { VEND_SANS_FAMILY } from "./vend-sans-file";

export { VEND_SANS_FAMILY };

/** Vend Sans (OFL, see fonts/OFL.txt) embedded as a data URI. One variable
 *  file serves every weight: the painter sets the `wght` axis from the text's
 *  weight at draw time. */
export const VEND_SANS: FontDescriptor = {
	kind: "local",
	family: VEND_SANS_FAMILY,
	files: [{ weight: 400, src }],
};
