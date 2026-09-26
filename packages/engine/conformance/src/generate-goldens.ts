// Regenerates ../expected from the reference backend. Run after an intentional
// change, and read the diff: a golden suite dies of churn nobody can attribute,
// so the CanvasKit version is stamped into every file and the command stream is
// stored in full rather than hashed, which makes an IR change reviewable as a
// text diff instead of a changed digest.
//
//   bun run conformance/src/generate-goldens.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRuntime } from "../../src/runtime";
import { createFixture } from "./canvaskit-fixture";
import { EXPECTED_DIR, type Expected, loadCases } from "./corpus";
import { encodeBinary, stringifyCase } from "./json";
import { compileCase, sha256 } from "./run";

const fixture = await createFixture();
try {
	mkdirSync(EXPECTED_DIR, { recursive: true });
	const rt = makeRuntime(
		{
			resolveFont: (req) => {
				const family = typeof req === "string" ? req : req.family;
				const bytes = fixture.fonts.get(family);
				return bytes ? { kind: "bytes", bytes } : { kind: "none" };
			},
			loadImageBytes: async (src) => {
				const bytes = fixture.images.get(src);
				if (!bytes) throw new Error(`no image bytes for ${src}`);
				return bytes;
			},
		},
		"encode",
		undefined,
		fixture.painter,
	);

	for (const c of loadCases()) {
		const commands = compileCase(c, fixture);
		const output = await fixture.painter(commands, rt);
		const pixels = output.readPixels?.();
		if (!pixels) throw new Error(`${c.id}: backend returned no pixels`);
		const expected: Expected = {
			caseId: c.id,
			canvasKitVersion: fixture.canvasKitVersion,
			commands: encodeBinary(commands) as unknown[],
			deviceWidth: pixels.width,
			deviceHeight: pixels.height,
			rgbaSha256: sha256(pixels.data),
		};
		output.dispose();
		writeFileSync(join(EXPECTED_DIR, `${c.id}.json`), stringifyCase(expected));
	}
	console.log(`regenerated goldens for CanvasKit ${fixture.canvasKitVersion}`);
} finally {
	fixture.dispose();
}
