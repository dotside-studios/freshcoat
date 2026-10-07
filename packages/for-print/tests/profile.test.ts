// Parsing a profile from a deploy, and the cache key that keeps a re-measured
// printer from serving cards corrected the old way.
import { describe, expect, test } from "vitest";
import { grayBalanceChart } from "../src/chart";
import type { ChartReading, PatchReading } from "../src/measure";
import { NO_PROCESSING } from "../src/presets";
import {
	createPrintProfile,
	parsePrintProfile,
	profileCacheKey,
	withProfile,
} from "../src/profile";

const neutralReading = (): ChartReading => {
	const spec = grayBalanceChart(8);
	const patches: PatchReading[] = spec.patches
		.filter((patch) => patch.role !== "fiducial")
		.map((patch) => ({
			id: patch.id,
			role: patch.role,
			sent: patch.rgb,
			raw: patch.rgb,
			measured: patch.rgb,
			...(patch.repeatOf ? { repeatOf: patch.repeatOf } : {}),
		}));
	return {
		chartId: spec.id,
		patches,
		stock: [250, 250, 250],
		stockClipped: false,
		lightSpread: 0,
		missed: [],
	};
};

describe("parsePrintProfile", () => {
	test("takes a JSON string or an object", () => {
		const expected = { version: 1, name: "IDP Smart-51 / batch A / Zebra PVC" };
		expect(parsePrintProfile(JSON.stringify(expected))).toEqual({
			ok: true,
			profile: expected,
		});
		expect(parsePrintProfile(expected)).toEqual({ ok: true, profile: expected });
	});

	test("keeps a measured balance and its provenance", () => {
		const profile = parsePrintProfile({
			name: "IDP Smart-51",
			balance: { r: 1.08, g: 0.98, b: 1.02 },
			measuredAt: "2026-08-12T09:00:00Z",
			notes: "aircon room, 24C",
		});
		expect(profile).toEqual({
			ok: true,
			profile: {
				version: 1,
				name: "IDP Smart-51",
				balance: { r: 1.08, g: 0.98, b: 1.02 },
				measuredAt: "2026-08-12T09:00:00Z",
				notes: "aircon room, 24C",
			},
		});
	});

	test("keeps profile conditions and the calibration evidence", () => {
		const assessment = {
			usable: true,
			blockers: [],
			metrics: {
				graySteps: 16,
				missedPatches: 0,
				lightSpread: 1,
				repeatSpread: 2,
			},
		};
		expect(
			parsePrintProfile({
				version: 1,
				name: "IDP Smart-51",
				conditions: {
					printer: "Smart-51",
					ribbon: "batch A",
					stock: "Zebra PVC",
				},
				assessment,
			}),
		).toEqual({
			ok: true,
			profile: {
				version: 1,
				name: "IDP Smart-51",
				conditions: {
					printer: "Smart-51",
					ribbon: "batch A",
					stock: "Zebra PVC",
				},
				assessment,
			},
		});
	});

	test("a profile with no balance is valid — measured nothing yet", () => {
		const result = parsePrintProfile({ name: "IDP Smart-51" });
		if (!result.ok) throw new Error(result.message);
		expect(result.profile.balance).toBeUndefined();
	});

	test("refuses what it cannot apply, and says why", () => {
		const cases: Record<string, unknown> = {
			"not valid JSON": "{oops",
			empty: "   ",
			"must be a JSON object": "[1,2,3]",
			"needs a name": { balance: { r: 1, g: 1, b: 1 } },
			"balance.g must be a number": { name: "p", balance: { r: 1, b: 1 } },
			"outside the": { name: "p", balance: { r: 40, g: 1, b: 1 } },
			"version must be 1": { version: 2, name: "p" },
			"conditions.stock": { name: "p", conditions: { stock: "" } },
		};
		for (const [fragment, input] of Object.entries(cases)) {
			const result = parsePrintProfile(input);
			if (result.ok) throw new Error(`accepted: ${fragment}`);
			expect(result.message, fragment).toContain(fragment);
		}
	});

	test("an out-of-range exponent is refused, not clamped", () => {
		// Clamping would load a profile that is not the one written down, and print
		// a run nobody could account for afterwards.
		const result = parsePrintProfile({
			name: "p",
			balance: { r: 1.05, g: 1, b: 0.05 },
		});
		expect(result.ok).toBe(false);
	});
});

describe("createPrintProfile", () => {
	test("records a fitted balance, assessment, and operating conditions together", () => {
		const result = createPrintProfile(neutralReading(), {
			name: "IDP Smart-51 / batch A / Zebra PVC",
			measuredAt: "2026-08-13T09:00:00Z",
			conditions: {
				printer: "IDP Smart-51",
				ribbon: "batch A",
				stock: "Zebra PVC",
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("profile was not created");
		expect(result.profile).toMatchObject({
			version: 1,
			balance: { r: 1, g: 1, b: 1 },
			assessment: { usable: true },
		});
	});

	test("refuses unsafe readings instead of emitting partial profile data", () => {
		const reading = neutralReading();
		reading.stockClipped = true;
		const result = createPrintProfile(reading, { name: "p" });
		expect(result).toMatchObject({
			ok: false,
			reason: "unsafe-reading",
			assessment: { blockers: ["stock-clipped"] },
		});
	});

	test("refuses conditions it could not later parse", () => {
		const result = createPrintProfile(neutralReading(), {
			name: "p",
			conditions: { stock: "" },
		});
		expect(result).toMatchObject({ ok: false, reason: "invalid-conditions" });
	});
});

describe("withProfile", () => {
	test("supplies the balance and leaves the analysis alone", () => {
		const analysed = { ...NO_PROCESSING, saturation: 1.25, gamma: 0.9 };
		const merged = withProfile(analysed, {
			name: "p",
			balance: { r: 1.08, g: 1, b: 1 },
		});
		// The profile owns the cast and nothing else: a profile that pinned
		// saturation would throw away the per-image analysis.
		expect(merged.balance).toEqual({ r: 1.08, g: 1, b: 1 });
		expect(merged.saturation).toBe(1.25);
		expect(merged.gamma).toBe(0.9);
	});

	test("an unmeasured profile changes nothing", () => {
		const analysed = { ...NO_PROCESSING, saturation: 1.25 };
		expect(withProfile(analysed, { name: "p" })).toBe(analysed);
		expect(withProfile(analysed, undefined)).toBe(analysed);
	});
});

describe("profileCacheKey", () => {
	test("a different measurement is a different key", () => {
		const a = profileCacheKey({ name: "p", balance: { r: 1.08, g: 1, b: 1 } });
		const b = profileCacheKey({ name: "p", balance: { r: 1.09, g: 1, b: 1 } });
		expect(a).not.toBe(b);
	});

	test("renaming or annotating a profile is not a re-render", () => {
		const balance = { r: 1.08, g: 1, b: 1 };
		expect(profileCacheKey({ name: "before", balance })).toBe(
			profileCacheKey({
				name: "after",
				balance,
				notes: "swapped the ribbon",
				measuredAt: "2026-08-12T09:00:00Z",
			}),
		);
	});

	test("no profile and an unmeasured profile share the one key", () => {
		expect(profileCacheKey(undefined)).toBe("none");
		expect(profileCacheKey({ name: "p" })).toBe("none");
	});
});
