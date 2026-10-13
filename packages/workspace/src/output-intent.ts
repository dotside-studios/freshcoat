// The ICC profiles a workspace keeps for its PDF presets' output intents.

import { subtleSha256 } from "@freshcoat-js/coatfile";
import {
	type OutputIntent,
	readIccProfile,
	SRGB_OUTPUT_INTENT,
} from "@freshcoat-js/engine/icc";
import type { ExportPreset, IccProfileAsset, Workspace } from "./types";

export type ReadOutputProfile =
	| { ok: true; profile: IccProfileAsset }
	| { ok: false; message: string };

/** A profile file read for an output intent, or why it cannot be one. */
export async function readOutputProfile(
	bytes: Uint8Array,
	name: string,
	identifier?: string,
): Promise<ReadOutputProfile> {
	const read = readIccProfile(bytes);
	if (!read.ok) return read;
	return {
		ok: true,
		profile: {
			sha256: await subtleSha256(bytes),
			name,
			description: read.info.description,
			...(identifier?.trim() ? { identifier: identifier.trim() } : {}),
			bytes,
		},
	};
}

/** The profiles some preset's output intent names, in workspace order. A
 *  preset keeps its intent while set to another format, so its profile is
 *  kept too. */
export function usedProfiles(
	profiles: readonly IccProfileAsset[] | undefined,
	presets: readonly ExportPreset[],
): IccProfileAsset[] {
	const named = new Set(
		presets.flatMap((p) =>
			p.outputIntent?.kind === "profile" ? [p.outputIntent.sha256] : [],
		),
	);
	return (profiles ?? []).filter((p) => named.has(p.sha256));
}

export class MissingProfileError extends Error {
	override readonly name = "MissingProfileError";
}

/** The output intent `assemblePdf` takes for a preset. Throws a
 *  `MissingProfileError` when the profile it names is not in the
 *  workspace. */
export function presetOutputIntent(
	workspace: Pick<Workspace, "profiles">,
	preset: ExportPreset,
): OutputIntent | false {
	const intent = preset.outputIntent ?? { kind: "srgb" };
	if (intent.kind === "none") return false;
	if (intent.kind === "srgb") return SRGB_OUTPUT_INTENT;
	const profile = workspace.profiles?.find((p) => p.sha256 === intent.sha256);
	if (!profile)
		throw new MissingProfileError(
			`preset "${preset.name}": its output intent profile is not in the workspace`,
		);
	return {
		profile: profile.bytes,
		...(profile.identifier ? { identifier: profile.identifier } : {}),
		...(profile.description ? { info: profile.description } : {}),
	};
}
