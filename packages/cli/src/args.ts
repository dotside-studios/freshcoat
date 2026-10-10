import { PAPER_SIZES_MM, type PaperName } from "@freshcoat-js/workspace";

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

export function parseLength(entry: string): number {
	const value = Number(entry);
	if (!Number.isFinite(value) || value < 0)
		throw new ArgumentError("Expected millimetres, 0 or more.");
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
