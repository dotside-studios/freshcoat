// Turning a gray-ramp reading into a cast correction.
//
// The gray chart sends neutral and the printer returns something that is not,
// measured against the bare card so the camera and the light are already divided
// out (see ./measure). What is left is the printer's own cast, and this is where
// it becomes a correction the render can apply.
//
// The method is an inversion, not a fit to a formula. Each step's measured curve
// says what the printer did with a level; asking that curve what level it WOULD
// have printed as neutral gives the level to send instead. Doing that at every
// step and reading off the exponent that connects them is the whole of it.

import { assessCalibration } from "./assess";
import type { ChartReading } from "./measure";
import type { ChannelBalance } from "./types";

type Step = { level: number; measured: [number, number, number] };

const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// The neutral steps of a reading, one entry per level sent, repeats averaged and
// in order. Averaging the repeats is what the three passes across the card were
// for: the cast is what they agree on, the disagreement is the sheet.
function neutralSteps(reading: ChartReading): Step[] {
	const byLevel = new Map<
		number,
		{ sum: [number, number, number]; n: number }
	>();
	for (const p of reading.patches) {
		if (p.role !== "measure") continue;
		if (p.sent[0] !== p.sent[1] || p.sent[1] !== p.sent[2]) continue;
		const at = byLevel.get(p.sent[0]) ?? { sum: [0, 0, 0], n: 0 };
		at.sum[0] += p.measured[0];
		at.sum[1] += p.measured[1];
		at.sum[2] += p.measured[2];
		at.n += 1;
		byLevel.set(p.sent[0], at);
	}
	return [...byLevel.entries()]
		.map(([level, at]) => ({
			level,
			measured: [at.sum[0] / at.n, at.sum[1] / at.n, at.sum[2] / at.n] as [
				number,
				number,
				number,
			],
		}))
		.sort((a, b) => a.level - b.level);
}

// The level that would have printed `value` on this channel, by interpolating
// between the two measured steps that bracket it. Null when the channel never
// printed anything that dark or that light — the correction cannot be derived
// past the ends of what was measured, and guessing there is how a profile starts
// inventing density the ribbon does not have.
function inputFor(
	steps: Step[],
	channel: number,
	value: number,
): number | null {
	for (let i = 1; i < steps.length; i++) {
		const lo = steps[i - 1];
		const hi = steps[i];
		const a = lo.measured[channel];
		const b = hi.measured[channel];
		if (value < Math.min(a, b) || value > Math.max(a, b)) continue;
		if (a === b) return lo.level;
		return lo.level + ((value - a) / (b - a)) * (hi.level - lo.level);
	}
	return null;
}

// Levels this close to the ends are left out of the fit. The exponent comes from
// a ratio of logarithms, and ln(level/255) goes to zero at white and to negative
// infinity at black — a level or two of camera noise there swings the answer
// wildly, while the midtones carry the same information cleanly.
const FIT_MIN = 24;
const FIT_MAX = 232;

// The per-channel exponent that would have made this printer's neutrals neutral.
// Null when the reading has too few steps to invert — a chart that is not a gray
// ramp, or one where the picks went wrong.
export type FitChannelBalanceOptions = {
	// Unsafe readings can still be explored by diagnostics, but are never fitted
	// by default. This escape hatch is deliberately explicit for investigation,
	// not a path used by the profile-saving workflow.
	allowUnsafe?: boolean;
};

export function fitChannelBalance(
	reading: ChartReading,
	options: FitChannelBalanceOptions = {},
): ChannelBalance | null {
	if (!options.allowUnsafe && !assessCalibration(reading).usable) return null;
	const steps = neutralSteps(reading);
	if (steps.length < 4) return null;

	const exponents = [0, 1, 2].map((channel) => {
		const ks: number[] = [];
		for (const step of steps) {
			if (step.level < FIT_MIN || step.level > FIT_MAX) continue;
			// The neutral this printer can actually make at this level: the average of
			// what its three channels did. Correcting toward that costs no density,
			// where correcting toward the level that was SENT would ask the ribbon for
			// ink it does not have and clip instead.
			const target =
				(step.measured[0] + step.measured[1] + step.measured[2]) / 3;
			const input = inputFor(steps, channel, target);
			if (input === null || input <= 0 || input >= 255) continue;
			ks.push(Math.log(input / 255) / Math.log(step.level / 255));
		}
		// Median, not mean: one patch spoiled by a speck or a highlight should not
		// move the correction the other fifteen agree on.
		return ks.length ? median(ks) : 1;
	});

	return {
		r: round(exponents[0]),
		g: round(exponents[1]),
		b: round(exponents[2]),
	};
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// Whether a balance is worth applying at all. A reading always produces some
// number; below this the correction is smaller than the noise it was measured
// through, and storing it would dress up a rounding error as a measurement.
export function isBalanceMeaningful(balance: ChannelBalance): boolean {
	return [balance.r, balance.g, balance.b].some((k) => Math.abs(k - 1) >= 0.01);
}
