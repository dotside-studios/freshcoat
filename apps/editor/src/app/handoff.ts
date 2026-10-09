// A template handed over in the link, as the Figma plugin sends it:
// `/edit#coat=<data>`, in the format of `@freshcoat-js/coatfile/handoff`.

import type { Template } from "@freshcoat-js/coatfile";
import { COAT_EXTENSION } from "@freshcoat-js/coatfile/coat";
import { decodeHandoff } from "@freshcoat-js/coatfile/handoff";
import { openFile, saveFileName } from "~/doc/io";
import { NEWER_FORMAT } from "./controller";

export type HandoffTemplate =
	| { ok: true; template: Template; fileName: string; notices: string[] }
	| { ok: false; reason: string };

/** Decodes, parses and validates a `coat` value, healing duplicate layer ids
 *  as opening a file does. */
export async function readHandoff(data: string): Promise<HandoffTemplate> {
	const decoded = decodeHandoff(data);
	if (!decoded.ok) return decoded;
	const outcome = await openFile(decoded.json, "");
	if (outcome.kind === "unreadable")
		return { ok: false, reason: "it isn't template JSON" };
	if (outcome.kind === "invalid") {
		const first = outcome.errors[0];
		return {
			ok: false,
			reason: first
				? `${first.message}${first.path ? ` at ${first.path}` : ""}`
				: "it isn't a valid template",
		};
	}
	const notices: string[] = [];
	if (outcome.healed.length)
		notices.push(`Renamed duplicate layer ids: ${outcome.healed.join(", ")}`);
	if (outcome.newerFormat) notices.push(NEWER_FORMAT);
	return {
		ok: true,
		template: outcome.template,
		fileName: saveFileName(outcome.template, COAT_EXTENSION),
		notices,
	};
}
