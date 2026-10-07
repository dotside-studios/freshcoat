// freshcoat graded against its own conformance corpus, plus the rules the
// corpus exists to enforce. The reference backend passing is the least of it:
// what matters is that a backend cannot claim a profile it does not implement,
// and cannot decline a feature quietly.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	createFixture,
	type Fixture,
} from "../conformance/src/canvaskit-fixture";
import { loadCases } from "../conformance/src/corpus";
import { runConformance, sha256 } from "../conformance/src/run";
import { makeRuntime } from "../src/runtime";
import type { Painter } from "../src/types";

let fixture: Fixture;

beforeAll(async () => {
	fixture = await createFixture();
});
afterAll(() => fixture?.dispose());

const base = () => ({
	painter: fixture.painter,
	textEngine: fixture.textEngine,
	fontMetrics: fixture.fontMetrics,
	fonts: fixture.fonts,
	images: fixture.images,
});

describe("the reference backend", () => {
	test("passes every case and claims both profiles it implements", async () => {
		const report = await runConformance({
			...base(),
			capabilities: { profiles: ["core", "raster"] },
			checkGoldens: true,
		});
		const failures = report.results.filter((r) => r.status !== "pass");
		expect(failures.map((f) => `${f.id}: ${f.notes.join("; ")}`)).toEqual([]);
		expect(report.claimed.sort()).toEqual(["core", "raster"]);
		expect(report.passed).toBe(loadCases().length);
	});

	// The goldens are only worth committing because this holds; it is the spike
	// that justified exact comparison, kept as a standing check.
	test("paints the same pixels twice in one process", async () => {
		const rt = makeRuntime(
			{
				resolveFont: (req) => {
					const family = typeof req === "string" ? req : req.family;
					const bytes = fixture.fonts.get(family);
					return bytes ? { kind: "bytes", bytes } : { kind: "none" };
				},
				loadBytes: async (src) => {
					const bytes = fixture.images.get(src);
					if (!bytes) throw new Error(`no image bytes for ${src}`);
					return bytes;
				},
			},
			"encode",
			undefined,
			fixture.painter,
		);
		const { compileCase } = await import("../conformance/src/run");
		for (const c of loadCases().slice(0, 5)) {
			const commands = compileCase(c, fixture);
			const hashes: string[] = [];
			for (let i = 0; i < 2; i++) {
				const out = await fixture.painter(commands, rt);
				const pixels = out.readPixels?.() ?? null;
				expect(pixels).not.toBeNull();
				if (pixels) hashes.push(sha256(pixels.data));
				out.dispose();
			}
			expect(hashes[0], `${c.id} is not deterministic`).toBe(hashes[1]);
		}
	});
});

describe("profiles gate what a backend may claim", () => {
	test("an unclaimed profile's cases are skipped, and it is not claimed", async () => {
		const report = await runConformance({
			...base(),
			capabilities: { profiles: ["core"] },
		});
		expect(report.claimed).toEqual(["core"]);
		expect(report.skipped).toBeGreaterThan(0);
		expect(
			report.results
				.filter((r) => r.status === "skip")
				.every((r) => r.notes.some((n) => n.includes("not claimed"))),
		).toBe(true);
	});

	// The hole a flat capability list leaves: declaring a feature away must not be
	// a route to claiming the profile that contains it.
	test("a backend cannot claim core by declaring part of it n/a", async () => {
		const report = await runConformance({
			...base(),
			capabilities: { profiles: ["core"], fidelity: { "fill.angular": "n/a" } },
		});
		expect(report.results.find((r) => r.id === "fill-angular")?.status).toBe(
			"skip",
		);
		expect(report.claimed).not.toContain("core");
	});

	test("an approximating backend runs the case but is not graded on exact pixels", async () => {
		// The reference backend is exact, so approximation can only be simulated by
		// declaring it: the point is that the DECLARATION relaxes the grading.
		const report = await runConformance({
			...base(),
			capabilities: {
				profiles: ["core"],
				fidelity: { "fill.angular": "approximated" },
			},
		});
		expect(report.results.find((r) => r.id === "fill-angular")?.status).toBe(
			"pass",
		);
	});
});

describe("a declined feature is never a silent no-op", () => {
	test("refusing without warning fails the case", async () => {
		// A backend that drops the feature and says nothing: the pixels may even be
		// defensible, and the case still has to fail, or "unsupported" is
		// indistinguishable from "supported".
		const silent: Painter = async (commands, rt) => {
			const out = await fixture.painter(commands, rt);
			return { ...out, warnings: [] };
		};
		const report = await runConformance({
			...base(),
			painter: silent,
			capabilities: {
				profiles: ["core"],
				fidelity: { "fill.angular": "refused" },
			},
		});
		const result = report.results.find((r) => r.id === "fill-angular");
		expect(result?.status).toBe("fail");
		expect(result?.notes.join(" ")).toContain("no warning");
	});

	test("refusing with a warning passes", async () => {
		const announced: Painter = async (commands, rt) => {
			const out = await fixture.painter(commands, rt);
			return {
				...out,
				warnings: [{ kind: "unhandled_op" as const, op: "angular fill" }],
			};
		};
		const report = await runConformance({
			...base(),
			painter: announced,
			capabilities: {
				profiles: ["core"],
				fidelity: { "fill.angular": "refused" },
			},
		});
		expect(report.results.find((r) => r.id === "fill-angular")?.status).toBe(
			"pass",
		);
	});
});

describe("the corpus itself", () => {
	test("every case compiles to well-formed IR", async () => {
		const { validateCommands } = await import("../src/validate-commands");
		const { compileCase } = await import("../conformance/src/run");
		for (const c of loadCases())
			expect(validateCommands(compileCase(c, fixture)), c.id).toEqual([]);
	});

	test("case ids are unique and every case has assertions", () => {
		const cases = loadCases();
		expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
		for (const c of cases) expect(c.assertions.length, c.id).toBeGreaterThan(0);
	});
});
