import type { FrameWarning } from "@freshcoat-js/coatfile";
import type { PrintRenderOptions } from "@freshcoat-js/coatfile/render";
import type { ChannelBalance } from "@freshcoat-js/for-print";
import type { ExportPreset, PresetPrint } from "../types";

/** What a render request carries when the preset prints: plain data, so it
 *  can cross to a worker as it is. */
export type RenderPrint = {
	analyze: boolean;
	/** the profile's measured cast, when it has one */
	balance?: ChannelBalance;
};

/** One photo layer that gave up color to fit the printer's range. */
export type GamutNote = {
	layer?: string;
	/** share of the layer past the range, 0..1 */
	clipped: number;
	/** how much chroma was given back, 0..1 */
	pullback: number;
};

/** How an item came out: through the print path, rendered plain after the
 *  print path failed, or plain because the preset does not print. */
export type PrintOutcome = "on" | "fallback" | "off";

export function printEnabled(preset: Pick<ExportPreset, "print">): boolean {
	return preset.print?.enabled === true;
}

/** The print part of a render request for this preset, or undefined when it
 *  does not print. */
export function printRequest(
	print: PresetPrint | undefined,
): RenderPrint | undefined {
	if (!print?.enabled) return undefined;
	const balance = print.profile?.balance;
	return {
		analyze: print.analyze ?? true,
		...(balance ? { balance } : {}),
	};
}

/** What an item render hands `renderCompiled`. The finish is coatfile's
 *  default, YMCKO, with the balance as its curve. */
export function printRenderOptions(print: RenderPrint): PrintRenderOptions {
	return {
		analyze: print.analyze,
		...(print.balance ? { balance: print.balance } : {}),
	};
}

/**
 * Renders through the print path, and on any failure renders again without
 * it, as Davi's card shop does for its print runs: a plain file and the
 * reason beat no file.
 */
export async function withPrintFallback<T>(
	print: RenderPrint | undefined,
	render: (print: PrintRenderOptions | undefined) => Promise<T>,
): Promise<{ result: T; print: PrintOutcome; error?: string }> {
	if (!print) return { result: await render(undefined), print: "off" };
	try {
		return { result: await render(printRenderOptions(print)), print: "on" };
	} catch (e) {
		return {
			result: await render(undefined),
			print: "fallback",
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/** The gamut warnings among a render's warnings. */
export function gamutNotes(warnings: readonly FrameWarning[]): GamutNote[] {
	const out: GamutNote[] = [];
	for (const w of warnings)
		if (w.kind === "gamut_compressed")
			out.push({
				...(w.layer ? { layer: w.layer } : {}),
				clipped: w.clipped,
				pullback: w.pullback,
			});
	return out;
}

/** The largest share of photo color pulled into range, as a whole percent;
 *  0 when nothing was. */
export function gamutPercent(notes: readonly GamutNote[] | undefined): number {
	let most = 0;
	for (const n of notes ?? []) most = Math.max(most, n.clipped);
	return Math.round(most * 100);
}

/** Items that rendered plain because the print path failed. They count as
 *  warnings: the file is there, uncorrected. */
export function printFallbacks(
	items: readonly { ok: boolean; print?: PrintOutcome }[],
): number {
	let n = 0;
	for (const item of items) if (item.ok && item.print === "fallback") n++;
	return n;
}
