import {
	CUT_KINDS,
	type CutKind,
	type CutSpots,
	MAX_BACK_OFFSET_MM,
	PAPER_SIZES_MM,
	type PaperName,
	parseFilter,
	type ViewFilter,
} from "@freshcoat-js/workspace";

export class ArgumentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArgumentError";
	}
}

export function collect(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

export function collectSetting(
	entry: string,
	previous: Record<string, string> = {},
): Record<string, string> {
	const at = entry.indexOf("=");
	if (at <= 0) throw new ArgumentError("Expected key=value.");
	return { ...previous, [entry.slice(0, at)]: entry.slice(at + 1) };
}

export function collectCutSpot(entry: string, previous: CutSpots = {}): CutSpots {
	const at = entry.indexOf("=");
	const kind = at < 0 ? "through" : entry.slice(0, at).trim();
	const name = (at < 0 ? entry : entry.slice(at + 1)).trim();
	if (!CUT_KINDS.includes(kind as CutKind))
		throw new ArgumentError(`Expected through, kiss, score or perforate before =, got "${kind}".`);
	if (!name) throw new ArgumentError("Expected a spot colour name.");
	return { ...previous, [kind]: name };
}

export function collectFilter(entry: string, previous: ViewFilter[] = []): ViewFilter[] {
	try {
		return [...previous, parseFilter(entry)];
	} catch (error) {
		throw new ArgumentError(error instanceof Error ? error.message : String(error));
	}
}

export function collectScale(entry: string, previous: number[] = []): number[] {
	return [...previous, parsePositive(entry)];
}

export function parseQuality(entry: string): number {
	const value = Number(entry);
	if (!Number.isInteger(value) || value < 0 || value > 100)
		throw new ArgumentError("Expected a whole number from 0 to 100.");
	return value;
}

export function parseJobs(entry: string): number {
	const value = Number(entry);
	if (!Number.isInteger(value) || value < 1)
		throw new ArgumentError("Expected a whole number, 1 or more.");
	return value;
}

export function parsePositive(entry: string): number {
	const value = Number(entry);
	if (!Number.isFinite(value) || value <= 0)
		throw new ArgumentError("Expected a positive number.");
	return value;
}

export function parseMinDpi(entry: string): number {
	const value = Number(entry);
	if (!Number.isFinite(value) || value < 0)
		throw new ArgumentError("Expected pixels per inch, 0 or more.");
	return value;
}

export function parseLength(entry: string): number {
	const value = Number(entry);
	if (!Number.isFinite(value) || value < 0)
		throw new ArgumentError("Expected millimetres, 0 or more.");
	return value;
}

export function parseCopies(entry: string): number | "fill" {
	if (entry.toLowerCase() === "fill") return "fill";
	const value = Number(entry);
	if (!Number.isInteger(value) || value < 1)
		throw new ArgumentError("Expected a whole number, 1 or more, or fill.");
	return value;
}

export function parsePaper(
	entry: string,
): PaperName | { widthMm: number; heightMm: number } {
	const name = entry.toLowerCase();
	if ((Object.keys(PAPER_SIZES_MM) as string[]).includes(name)) return name as PaperName;
	const size = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(name);
	const [width, height] = [Number(size?.[1]), Number(size?.[2])];
	if (!size || width <= 0 || height <= 0)
		throw new ArgumentError(
			`Expected ${Object.keys(PAPER_SIZES_MM).join(", ")} or <width>x<height> in millimetres.`,
		);
	return { widthMm: Math.min(width, height), heightMm: Math.max(width, height) };
}

export function parseOffset(entry: string): { x: number; y: number } {
	const parts = entry.split(",").map((part) => part.trim());
	const [x, y] = parts.map((part) => (part === "" ? Number.NaN : Number(part)));
	if (parts.length !== 2 || !Number.isFinite(x) || !Number.isFinite(y))
		throw new ArgumentError("Expected <x>,<y> in millimetres, such as 0.5,-1.");
	if (Math.abs(x as number) > MAX_BACK_OFFSET_MM || Math.abs(y as number) > MAX_BACK_OFFSET_MM)
		throw new ArgumentError(
			`Expected <x>,<y> each from -${MAX_BACK_OFFSET_MM} to ${MAX_BACK_OFFSET_MM} millimetres.`,
		);
	return { x: x as number, y: y as number };
}

export const SHEET_MARKS = ["crop", "registration", "colorbar", "slug"] as const;
export type SheetMark = (typeof SHEET_MARKS)[number];

export function parseMarks(entry: string): SheetMark[] {
	const names = entry
		.toLowerCase()
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	if (names.length === 1 && names[0] === "none") return [];
	const unknown = names.filter((name) => !(SHEET_MARKS as readonly string[]).includes(name));
	if (names.length === 0 || unknown.length > 0)
		throw new ArgumentError(`Expected none, or a list of ${SHEET_MARKS.join(", ")}.`);
	return [...new Set(names as SheetMark[])];
}
