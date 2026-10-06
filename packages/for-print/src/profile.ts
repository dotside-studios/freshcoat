// What was measured about one printer.
//
// A print profile is DATA, deliberately. `YMCKO_PRESET` is a set of hand-tuned
// constants compiled into every build, which is the right shape for a starting
// guess and the wrong shape for a measurement: what a gray ramp reports belongs
// to one printer, one ribbon batch, one card stock and roughly one set of room
// conditions. Re-measuring after a ribbon change should be a data change, not a
// deploy, and two printers should be able to disagree.
//
// So a profile carries only the parts a per-image analysis cannot know. It does
// NOT override saturation, contrast or gamma — those are chosen per image from
// the art itself, and a profile that pinned them would throw that away.

import { fitChannelBalance } from "./balance";
import {
	assessCalibration,
	type CalibrationAssessment,
	type CalibrationBlocker,
} from "./calibration";
import type { ChartReading } from "./measure";
import type { ChannelBalance, PrintOptimizeOptions } from "./types";
import { z } from "zod";

export interface PrintProfileConditions {
	printer?: string;
	ribbon?: string;
	stock?: string;
}

export interface PrintProfile {
	// Kept on the data rather than implied by the deploy, so exports remain
	// interpretable as the profile format evolves. Profiles written before this
	// field existed are read as version 1 for backwards compatibility.
	version?: 1;
	// Printer, ribbon and stock, in whatever words the operator uses. This is what
	// tells someone six months later that the profile no longer describes what is
	// in the machine, so it is required and should be specific.
	name: string;
	// The measured cast correction. Absent means a profile exists but no gray ramp
	// has been read into it yet.
	balance?: ChannelBalance;
	// When it was measured, ISO 8601. Free-form notes for anything the name cannot
	// carry — the room, the season, which batch.
	measuredAt?: string;
	notes?: string;
	// The equipment and consumables present when this profile was measured. They
	// are not pixels, but they are the evidence needed to decide whether the
	// profile still applies after a ribbon or stock change.
	conditions?: PrintProfileConditions;
	// The quality checks that passed when this balance was created. Retaining this
	// makes a copied profile auditable without retaining the operator's photo.
	assessment?: CalibrationAssessment;
}

export type PrintProfileDetails = {
	name: string;
	measuredAt?: string;
	notes?: string;
	conditions?: PrintProfileConditions;
};

export type PrintProfileCreation =
	| { ok: true; profile: PrintProfile; assessment: CalibrationAssessment }
	| {
			ok: false;
			reason: "unsafe-reading" | "missing-name" | "invalid-conditions";
			assessment: CalibrationAssessment;
	  };

// A profile with nothing measured. Named so a render can always say which profile
// it used, including when the answer is "none".
export const UNMEASURED_PROFILE: PrintProfile = {
	version: 1,
	name: "unmeasured",
};

// The one sanctioned route from a chart reading to profile data. Fitting and
// assessment happen together, so callers cannot accidentally save a balance
// while discarding the evidence that says whether it was safe to make.
export function createPrintProfile(
	reading: ChartReading,
	details: PrintProfileDetails,
): PrintProfileCreation {
	const assessment = assessCalibration(reading);
	if (!assessment.usable) {
		return { ok: false, reason: "unsafe-reading", assessment };
	}
	if (details.name.trim() === "") {
		return { ok: false, reason: "missing-name", assessment };
	}
	const conditions = parseConditions(details.conditions);
	if (conditions instanceof Error) {
		return { ok: false, reason: "invalid-conditions", assessment };
	}
	const balance = fitChannelBalance(reading);
	// An assessment that accepts a gray chart should fit; retain the guard so a
	// future fitting algorithm can become stricter without emitting partial data.
	if (!balance) return { ok: false, reason: "unsafe-reading", assessment };
	return {
		ok: true,
		assessment,
		profile: {
			version: 1,
			name: details.name.trim(),
			balance,
			assessment,
			...(details.measuredAt ? { measuredAt: details.measuredAt } : {}),
			...(details.notes ? { notes: details.notes } : {}),
			...(conditions ? { conditions } : {}),
		},
	};
}

// Fold a profile into a correction. The profile wins on the fields it owns and
// leaves every analysis-derived field alone.
export function withProfile(
	options: PrintOptimizeOptions,
	profile: PrintProfile | undefined,
): PrintOptimizeOptions {
	if (!profile?.balance) return options;
	return { ...options, balance: profile.balance };
}

// Identity for a render cache. A correction is part of what produced a PNG, so a
// profile change has to miss the cache — otherwise re-measuring a printer quietly
// keeps serving cards corrected the old way, which is the failure this whole
// pipeline exists to avoid. Deliberately built from the fields that CHANGE THE
// PIXELS: renaming a profile or editing its notes is not a re-render.
export function profileCacheKey(profile: PrintProfile | undefined): string {
	const b = profile?.balance;
	return b ? `${b.r}/${b.g}/${b.b}` : "none";
}

// Exponents outside this are not a cast, they are a mistake — a fit off bad picks
// or a hand-typed digit. Rejected rather than clamped, because a profile that
// silently became something else is worse than one that refused to load.
const MIN_EXPONENT = 0.2;
const MAX_EXPONENT = 5;

const exponent = (channel: keyof ChannelBalance) =>
	z
		.number({ error: `balance.${channel} must be a number` })
		.refine((k) => k >= MIN_EXPONENT && k <= MAX_EXPONENT, {
			error: (issue) =>
				`balance.${channel} is ${issue.input}, outside the ${MIN_EXPONENT}–${MAX_EXPONENT} a cast correction can plausibly be`,
		});

const balanceSchema = z.object(
	{ r: exponent("r"), g: exponent("g"), b: exponent("b") },
	{ error: "balance must be an object" },
);

const conditionField = (field: keyof PrintProfileConditions) => {
	const error = `conditions.${field} must be a non-empty string`;
	return z.string({ error }).trim().min(1, { error }).optional();
};

const conditionsSchema = z.object(
	{
		printer: conditionField("printer"),
		ribbon: conditionField("ribbon"),
		stock: conditionField("stock"),
	},
	{ error: "conditions must be an object" },
);

const CALIBRATION_BLOCKERS = [
	"stock-clipped",
	"patches-missed",
	"uneven-lighting",
	"uneven-print",
	"not-enough-gray-steps",
] as const satisfies readonly CalibrationBlocker[];

const metric = (field: keyof CalibrationAssessment["metrics"]) => {
	const error = `assessment.metrics.${field} must be a non-negative number`;
	return z.number({ error }).min(0, { error });
};

const blockersError =
	"assessment.blockers must contain known calibration blockers";

const assessmentSchema = z
	.object(
		{
			usable: z.boolean({ error: "assessment.usable must be a boolean" }),
			blockers: z.array(z.enum(CALIBRATION_BLOCKERS, { error: blockersError }), {
				error: blockersError,
			}),
			metrics: z.object(
				{
					graySteps: metric("graySteps"),
					missedPatches: metric("missedPatches"),
					lightSpread: metric("lightSpread"),
					repeatSpread: metric("repeatSpread"),
				},
				{ error: "assessment.metrics must be an object" },
			),
		},
		{ error: "assessment must be an object" },
	)
	.refine((a) => a.usable === (a.blockers.length === 0), {
		error: "assessment.usable must agree with assessment.blockers",
	});

const profileSchema = z.object(
	{
		version: z.literal(1, { error: "profile version must be 1" }).optional(),
		name: z
			.string({ error: "profile needs a name saying which printer it describes" })
			.trim()
			.min(1, {
				error: "profile needs a name saying which printer it describes",
			}),
		balance: balanceSchema.nullish(),
		conditions: conditionsSchema.nullish(),
		assessment: assessmentSchema.nullish(),
		measuredAt: z.string().optional().catch(undefined),
		notes: z.string().optional().catch(undefined),
	},
	{ error: "profile must be a JSON object" },
);

function parseConditions(
	value: unknown,
): PrintProfileConditions | undefined | Error {
	const result = conditionsSchema.nullish().safeParse(value);
	if (!result.success) return new Error(result.error.issues[0]?.message);
	return result.data ?? undefined;
}

// Parse a profile from whatever a deploy handed over — an env var, a settings
// row, a pasted export. Returns the profile or an Error explaining what is wrong
// with it, never a partially-applied one: a correction that half-loaded would
// print cards nobody could account for.
export function parsePrintProfile(input: unknown): PrintProfile | Error {
	let value = input;
	if (typeof value === "string") {
		const text = value.trim();
		if (text === "") return new Error("profile is empty");
		try {
			value = JSON.parse(text);
		} catch (e) {
			return new Error(
				`profile is not valid JSON: ${e instanceof Error ? e.message : "parse failed"}`,
			);
		}
	}
	const result = profileSchema.safeParse(value);
	if (!result.success) return new Error(result.error.issues[0]?.message);
	const raw = result.data;

	const profile: PrintProfile = { version: 1, name: raw.name };
	if (raw.balance) profile.balance = raw.balance;
	if (raw.measuredAt !== undefined) profile.measuredAt = raw.measuredAt;
	if (raw.notes !== undefined) profile.notes = raw.notes;
	if (raw.conditions) profile.conditions = raw.conditions;
	if (raw.assessment) profile.assessment = raw.assessment;
	return profile;
}
