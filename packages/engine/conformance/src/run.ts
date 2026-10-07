// runConformance — grade a backend against the corpus.
//
// The backend under test is a Painter: it receives the lowered Command[] and
// produces an output. Compiling is NOT its job, and that is the whole reason the
// seam is here rather than at the Node tree: text arrives baked, so a backend
// inherits line breaking, shrink-to-fit and baselines instead of owning a shaper.
import { createHash } from "node:crypto";
import { compileScene } from "../../src/compile-scene";
import type { DecodedPixels } from "../../src/decode";
import { makeRuntime } from "../../src/runtime";
import type { TextEngine } from "../../src/text-engine";
import type {
	Command,
	FontVMetrics,
	Painter,
	PaintWarning,
} from "../../src/types";
import { validateCommands } from "../../src/validate-commands";
import { loadCases, loadExpected } from "./corpus";
import type {
	Assertion,
	BackendCapabilities,
	Case,
	CaseResult,
	ConformanceReport,
	Fidelity,
	Profile,
} from "./types";

export type RunOptions = {
	painter: Painter;
	capabilities: BackendCapabilities;
	// Compiles the scene. Text baking needs a shaper, and the corpus's goldens
	// were baked with the CanvasKit Paragraph engine against the vendored font,
	// so a backend graded on the L1 goldens supplies that same engine.
	textEngine: TextEngine;
	fontMetrics?: Record<string, FontVMetrics>;
	fonts?: Map<string, Uint8Array[]>;
	images?: Map<string, Uint8Array>;
	// Run only these case ids.
	only?: string[];
	// Compare against the committed goldens. Off when grading a second backend,
	// whose pixels are its own; on in freshcoat's own regression test.
	checkGoldens?: boolean;
};

export const sha256 = (b: Uint8Array) =>
	createHash("sha256").update(b).digest("hex");

const pixelAt = (
	p: DecodedPixels,
	x: number,
	y: number,
): [number, number, number, number] => {
	const i = (y * p.width + x) * 4;
	return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
};

// Hue in degrees from an RGBA sample, the standard HSL derivation.
const hueOf = ([r, g, b]: [number, number, number, number]): number => {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d === 0) return 0;
	const h =
		60 *
		(max === r
			? ((g - b) / d) % 6
			: max === g
				? (b - r) / d + 2
				: (r - g) / d + 4);
	return h < 0 ? h + 360 : h;
};

const fidelityOf = (caps: BackendCapabilities, feature: string): Fidelity =>
	caps.fidelity?.[feature] ?? "native";

export function compileCase(
	c: Case,
	opts: Pick<RunOptions, "textEngine" | "fontMetrics">,
): Command[] {
	return compileScene(c.scene, {
		width: c.width,
		height: c.height,
		textEngine: opts.textEngine,
		fontMetrics: opts.fontMetrics,
		leadingTrim: c.compile?.leadingTrim,
		finish: c.compile?.finish,
		scale: c.compile?.scale,
		supersample: c.compile?.supersample,
	});
}

function evaluate(
	assertions: Assertion[],
	pixels: DecodedPixels | null,
	warnings: PaintWarning[],
	// Exact pixel checks do not apply to a backend that declared it approximates
	// or rasterizes the feature: it is conformant and it will not match.
	pixelsAuthoritative: boolean,
): string[] {
	const notes: string[] = [];
	for (const a of assertions) {
		if (a.kind === "warning") {
			const matches = warnings.filter(
				(w) =>
					w.kind === a.warning &&
					Object.entries(a.match ?? {}).every(
						([k, v]) => (w as Record<string, unknown>)[k] === v,
					),
			);
			const detail = a.match ? ` matching ${JSON.stringify(a.match)}` : "";
			if (a.absent && matches.length > 0)
				notes.push(
					`expected no ${a.warning} warning${detail}${a.why ? ` (${a.why})` : ""}`,
				);
			if (!a.absent && matches.length === 0)
				notes.push(
					`expected a ${a.warning} warning${detail}, got ${JSON.stringify(warnings)}${a.why ? ` (${a.why})` : ""}`,
				);
			continue;
		}
		if (a.kind === "hue") {
			if (!pixels) {
				notes.push("backend produced no readable pixels");
				continue;
			}
			const h = hueOf(pixelAt(pixels, a.at[0], a.at[1]));
			if (a.expect === undefined) continue;
			// Shortest arc, so 359 and 1 are two degrees apart.
			const delta = Math.abs(((h - a.expect + 540) % 360) - 180);
			if (a.awayBy !== undefined) {
				if (delta < a.awayBy)
					notes.push(
						`hue at ${a.at.join(",")} is ${h.toFixed(1)}deg, only ${delta.toFixed(1)}deg from ${a.expect}deg, expected at least ${a.awayBy}${a.why ? ` — ${a.why}` : ""}`,
					);
			} else if (delta > (a.tolerance ?? 1)) {
				notes.push(
					`hue at ${a.at.join(",")} is ${h.toFixed(1)}deg, expected ${a.expect}deg +/- ${a.tolerance ?? 1}${a.why ? ` — ${a.why}` : ""}`,
				);
			}
			continue;
		}
		if (!pixelsAuthoritative) continue;
		if (!pixels) {
			notes.push("backend produced no readable pixels");
			continue;
		}
		if (a.kind === "pixel") {
			const got = pixelAt(pixels, a.at[0], a.at[1]);
			const slack = a.tolerance ?? 0;
			const ok = got.every((v, i) => Math.abs(v - a.expect[i]) <= slack);
			if (!ok)
				notes.push(
					`pixel ${a.at.join(",")} expected ${a.expect.join(",")} got ${got.join(",")}${a.why ? ` — ${a.why}` : ""}`,
				);
			continue;
		}
		const here = pixelAt(pixels, a.at[0], a.at[1]);
		const there = pixelAt(pixels, a.from[0], a.from[1]);
		const delta = Math.max(...here.map((v, i) => Math.abs(v - there[i])));
		if (delta < a.minDelta)
			notes.push(
				`pixels ${a.at.join(",")} and ${a.from.join(",")} differ by ${delta}, expected >= ${a.minDelta}${a.why ? ` — ${a.why}` : ""}`,
			);
	}
	return notes;
}

export async function runConformance(
	opts: RunOptions,
): Promise<ConformanceReport> {
	const cases = loadCases().filter(
		(c) => !opts.only || opts.only.includes(c.id),
	);
	const results: CaseResult[] = [];

	for (const c of cases) {
		const notes: string[] = [];
		if (!opts.capabilities.profiles.includes(c.profile)) {
			results.push({
				id: c.id,
				status: "skip",
				notes: [`profile ${c.profile} not claimed`],
			});
			continue;
		}
		const fidelities = c.requires.map(
			(f) => [f, fidelityOf(opts.capabilities, f)] as const,
		);
		const unavailable = fidelities.filter(([, f]) => f === "n/a");
		if (unavailable.length > 0) {
			results.push({
				id: c.id,
				status: "skip",
				notes: unavailable.map(([k]) => `${k} is n/a for this backend`),
			});
			continue;
		}
		// "refused" and the approximating fidelities both stop the exact pixel
		// checks from applying, but they are not the same claim: a refusal still has
		// to be announced, which is the rule that keeps a silent no-op from passing.
		const refused = fidelities
			.filter(([, f]) => f === "refused")
			.map(([k]) => k);
		const inexact = fidelities.some(([, f]) => f !== "native");

		const commands = compileCase(c, opts);
		const irIssues = validateCommands(commands);
		if (irIssues.length > 0)
			notes.push(
				...irIssues.map((i) => `malformed IR at ${i.path}: ${i.message}`),
			);

		const rt = makeRuntime(
			{
				resolveFont: (req) => {
					const family = typeof req === "string" ? req : req.family;
					const bytes = opts.fonts?.get(family);
					return bytes ? { kind: "bytes", bytes } : { kind: "none" };
				},
				loadBytes: async (src) => {
					const bytes = opts.images?.get(src);
					if (!bytes) throw new Error(`no image bytes for ${src}`);
					return bytes;
				},
			},
			"encode",
			undefined,
			opts.painter,
		);

		let pixels: DecodedPixels | null = null;
		let warnings: PaintWarning[] = [];
		try {
			// paint() applies the disposal policy, so reach the raw output through the
			// painter directly: conformance wants the pixels, not an encoding of them.
			const output = await opts.painter(commands, rt);
			warnings = output.warnings;
			pixels = output.readPixels?.() ?? null;
			if (opts.checkGoldens) {
				const expected = loadExpected(c.id);
				if (!expected) notes.push("no golden committed");
				else {
					if (JSON.stringify(commands) !== JSON.stringify(expected.commands))
						notes.push("Command[] differs from the L1 golden");
					if (pixels) {
						if (sha256(pixels.data) !== expected.rgbaSha256)
							notes.push(
								`rendered pixels differ from the reference (${expected.deviceWidth}x${expected.deviceHeight}, CanvasKit ${expected.canvasKitVersion})`,
							);
					}
				}
			}
			output.dispose();
		} catch (error) {
			notes.push(`paint threw: ${(error as Error).message}`);
		}

		if (refused.length > 0 && warnings.length === 0)
			notes.push(
				`refuses ${refused.join(", ")} but emitted no warning; a declined feature is never a silent no-op`,
			);

		notes.push(...evaluate(c.assertions, pixels, warnings, !inexact));
		results.push({
			id: c.id,
			status: notes.length === 0 ? "pass" : "fail",
			notes,
		});
	}

	const passed = results.filter((r) => r.status === "pass").length;
	const failed = results.filter((r) => r.status === "fail").length;
	const skipped = results.filter((r) => r.status === "skip").length;
	// A profile is claimed only when nothing in it failed AND nothing in it was
	// skipped: a backend cannot claim `core` by declaring half of it n/a. A run
	// narrowed with `only` claims nothing at all — `every` over two cases is
	// trivially true, and a subset passing is not the claim the word makes.
	const claimed = opts.only
		? []
		: opts.capabilities.profiles.filter((p: Profile) =>
				cases
					.filter((c) => c.profile === p)
					.every((c) => results.find((r) => r.id === c.id)?.status === "pass"),
			);

	return {
		profiles: opts.capabilities.profiles,
		results,
		passed,
		failed,
		skipped,
		claimed,
	};
}
