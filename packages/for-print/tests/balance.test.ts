// Fitting a cast correction from a gray ramp, and proving it corrects.
//
// The decisive test is the closed loop at the bottom: run a synthetic printer
// with a known cast, fit a balance off what it produced, then run the SAME
// printer with that balance applied and check the neutrals came back neutral.
// A fit that merely returns plausible numbers would pass everything above it.
import { describe, expect, test } from "vitest";
import { fitChannelBalance, isBalanceMeaningful } from "../src/balance";
import { assessCalibration } from "../src/assess";
import { grayBalanceChart, type RGB } from "../src/chart";
import type { ChartReading, PatchReading } from "../src/measure";
import type { ChannelBalance } from "../src/types";

// A printer as a per-channel response curve: what it lays down for a level sent.
type Printer = (level: number, channel: number) => number;

const clamp = (v: number) => Math.max(0, Math.min(255, v));

// A printer with a per-channel gamma of its own — the shape a cast actually has,
// stronger through the midtones than at either end.
const gammaPrinter =
	(exps: [number, number, number]): Printer =>
	(level, channel) =>
		clamp(255 * (level / 255) ** exps[channel]);

// Build the reading a gray chart would produce off `printer`, optionally after a
// correction has been applied to what is sent.
function readingFrom(
	printer: Printer,
	correction?: ChannelBalance,
): ChartReading {
	const spec = grayBalanceChart(16);
	const exps = correction
		? [correction.r, correction.g, correction.b]
		: [1, 1, 1];
	const patches: PatchReading[] = [];
	for (const p of spec.patches) {
		if (p.role === "fiducial") continue;
		const measured = [0, 1, 2].map((c) => {
			// The correction rewrites what is SENT; the printer then does what it does.
			const sent = clamp(255 * (p.rgb[c] / 255) ** exps[c]);
			return printer(sent, c);
		}) as RGB;
		patches.push({
			id: p.id,
			role: p.role,
			sent: p.rgb,
			raw: measured,
			measured,
			...(p.repeatOf ? { repeatOf: p.repeatOf } : {}),
		});
	}
	return {
		chartId: spec.id,
		patches,
		stock: [255, 255, 255],
		stockClipped: false,
		lightSpread: 0,
		missed: [],
	};
}

// The worst neutral error left in a reading: how far apart the three channels sit
// on a patch that was sent gray.
function worstCast(reading: ChartReading): number {
	let worst = 0;
	for (const p of reading.patches) {
		if (p.role !== "measure") continue;
		if (p.sent[0] !== p.sent[1] || p.sent[1] !== p.sent[2]) continue;
		// The ends cannot be corrected — 0 and 255 map to themselves under any
		// exponent — so they are not evidence either way.
		if (p.sent[0] < 24 || p.sent[0] > 232) continue;
		worst = Math.max(worst, Math.max(...p.measured) - Math.min(...p.measured));
	}
	return worst;
}

describe("fitChannelBalance", () => {
	test("refuses an unsafe reading unless diagnostics explicitly opt in", () => {
		const reading = readingFrom(gammaPrinter([0.88, 1, 0.92]));
		reading.stockClipped = true;
		const assessment = assessCalibration(reading);
		expect(assessment).toMatchObject({
			usable: false,
			blockers: ["stock-clipped"],
		});
		expect(fitChannelBalance(reading)).toBeNull();
		expect(fitChannelBalance(reading, { allowUnsafe: true })).not.toBeNull();
	});

	test("distinguishes lighting from an uneven printer", () => {
		const litUneven = readingFrom(gammaPrinter([1, 1, 1]));
		litUneven.lightSpread = 8;
		expect(assessCalibration(litUneven).blockers).toContain("uneven-lighting");

		const printUneven = readingFrom(gammaPrinter([1, 1, 1]));
		for (const patch of printUneven.patches) {
			if (patch.repeatOf)
				patch.measured = [
					patch.measured[0] - 8,
					patch.measured[1] - 8,
					patch.measured[2] - 8,
				];
		}
		expect(assessCalibration(printUneven).blockers).toContain("uneven-print");
	});

	test("a neutral printer needs no correction", () => {
		const balance = fitChannelBalance(readingFrom(gammaPrinter([1, 1, 1])));
		if (!balance) throw new Error("no fit");
		for (const k of [balance.r, balance.g, balance.b]) {
			expect(Math.abs(k - 1)).toBeLessThan(0.02);
		}
		expect(isBalanceMeaningful(balance)).toBe(false);
	});

	test("a printer running magenta is corrected against, in the right direction", () => {
		// Red and blue laid down heavier than green — what "everything looks
		// magenta" is, measured.
		const balance = fitChannelBalance(
			readingFrom(gammaPrinter([0.88, 1.0, 0.92])),
		);
		if (!balance) throw new Error("no fit");
		// The correction is toward the neutral this printer can actually make — the
		// average of its three channels — not toward the level that was sent, which
		// would ask for ink the ribbon does not have. So the size of each channel's
		// correction is how far IT sits from that average, and the three of them
		// straddle it: red laid down most and is pushed back hardest, blue is over
		// by less, green laid down least and is asked for more.
		expect(balance.r).toBeGreaterThan(1.05);
		expect(balance.b).toBeGreaterThan(1);
		expect(balance.b).toBeLessThan(balance.r);
		expect(balance.g).toBeLessThan(1);
		expect(isBalanceMeaningful(balance)).toBe(true);
	});

	test("a printer running cold is corrected the other way", () => {
		const balance = fitChannelBalance(
			readingFrom(gammaPrinter([1.12, 1.0, 0.9])),
		);
		if (!balance) throw new Error("no fit");
		expect(balance.r).toBeLessThan(1); // under-delivered red: send more
		expect(balance.b).toBeGreaterThan(1); // over-delivered blue: send less
	});

	test("one spoiled patch does not move the fit", () => {
		const reading = readingFrom(gammaPrinter([0.88, 1.0, 0.92]));
		const clean = fitChannelBalance(reading);
		// A speck or a highlight on one patch — the median has to ignore it.
		const spoiled = reading.patches.find(
			(p) => p.role === "measure" && p.sent[0] === 136,
		);
		if (!spoiled || !clean) throw new Error("missing patch");
		spoiled.measured = [255, 10, 255];
		// The spoiled patch is separately visible as an uneven sheet, so the
		// production gate correctly refuses it. This test isolates the robust fit.
		const after = fitChannelBalance(reading, { allowUnsafe: true });
		if (!after) throw new Error("no fit");
		expect(Math.abs(after.r - clean.r)).toBeLessThan(0.05);
		expect(Math.abs(after.b - clean.b)).toBeLessThan(0.05);
	});

	test("a reading with too few neutral steps is refused", () => {
		const reading = readingFrom(gammaPrinter([1, 1, 1]));
		reading.patches = reading.patches.slice(0, 3);
		expect(fitChannelBalance(reading)).toBeNull();
	});
});

describe("the correction actually corrects", () => {
	// Every cast worth naming, run round the loop: measure it, fit it, apply it,
	// measure again.
	const casts: Record<string, [number, number, number]> = {
		magenta: [0.88, 1.0, 0.92],
		warm: [0.85, 0.95, 1.05],
		cold: [1.12, 1.0, 0.9],
		green: [1.06, 0.9, 1.04],
	};

	for (const [name, exps] of Object.entries(casts)) {
		test(`a ${name} cast is neutralized by the balance fitted from it`, () => {
			const printer = gammaPrinter(exps);

			const before = readingFrom(printer);
			const balance = fitChannelBalance(before);
			if (!balance) throw new Error("no fit");

			const after = readingFrom(printer, balance);

			// The cast was real to begin with...
			expect(worstCast(before)).toBeGreaterThan(8);
			// ...and what is left is inside the noise of the measurement it came from.
			expect(worstCast(after)).toBeLessThanOrEqual(2);
		});
	}
});
