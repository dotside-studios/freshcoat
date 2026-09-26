// Loading the corpus. Cases and their goldens are JSON on disk, not TypeScript,
// so a harness in another language reads the same files with a JSON parser and a
// base64 decoder rather than a port of the Node types.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCase } from "./json";
import type { Case } from "./types";

export const CONFORMANCE_DIR = fileURLToPath(new URL("..", import.meta.url));
export const CASES_DIR = join(CONFORMANCE_DIR, "cases");
export const EXPECTED_DIR = join(CONFORMANCE_DIR, "expected");

// The golden for one case: the lowered command stream, and a digest of the
// pixels it paints. The digest rather than the pixels because a committed raster
// per case is megabytes that churn on every CanvasKit bump; the authored pixel
// assertions carry the semantics, and this carries the regression gate. Run the
// generator to reproduce the image itself when a diff needs looking at.
export type Expected = {
	caseId: string;
	// Stamped so a mismatch after an upgrade reads as an upgrade rather than a bug.
	canvasKitVersion: string;
	commands: unknown[];
	deviceWidth: number;
	deviceHeight: number;
	rgbaSha256: string;
};

export function loadCases(): Case[] {
	return readdirSync(CASES_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => parseCase<Case>(readFileSync(join(CASES_DIR, f), "utf8")));
}

export function loadExpected(caseId: string): Expected | null {
	try {
		return parseCase<Expected>(
			readFileSync(join(EXPECTED_DIR, `${caseId}.json`), "utf8"),
		);
	} catch {
		return null;
	}
}
