import { isSvg } from "@freshcoat-js/engine/svg/sniff";
import { once } from "./lazy";

export const loadSvgImport = once(() => import("./svg-import"));

export function looksLikeSvg(text: string): boolean {
	return isSvg(text.trim());
}
