import { parseArgs } from "node:util";
import { UsageError } from "./io";

type OptionSpec = {
	type: "string" | "boolean";
	short?: string;
	multiple?: boolean;
};

export type Parsed<O extends Record<string, OptionSpec>> = {
	values: {
		[K in keyof O]?: O[K] extends { type: "boolean" }
			? boolean
			: O[K] extends { multiple: true }
				? string[]
				: string;
	};
	positionals: string[];
};

const COMMON = {
	help: { type: "boolean", short: "h" },
	quiet: { type: "boolean", short: "q" },
} as const satisfies Record<string, OptionSpec>;

export function parse<O extends Record<string, OptionSpec>>(
	args: string[],
	options: O,
): Parsed<O & typeof COMMON> {
	try {
		const { values, positionals } = parseArgs({
			args,
			options: { ...COMMON, ...options },
			allowPositionals: true,
			strict: true,
		});
		return { values, positionals } as Parsed<O & typeof COMMON>;
	} catch (error) {
		throw new UsageError(reword(error));
	}
}

function reword(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const option = /Unknown option '([^']+)'/.exec(message);
	if (option) return `unknown option ${option[1]}`;
	const missing = /Option '([^']+)' argument missing/.exec(message);
	if (missing) return `option ${missing[1]?.replace(/ <value>$/, "")} needs a value`;
	return message.replace(/\. To specify.*$/, "");
}

export function exactlyOne(positionals: string[], what: string): string {
	if (positionals.length === 0) throw new UsageError(`missing ${what}`);
	if (positionals.length > 1)
		throw new UsageError(`expected one ${what}, got ${positionals.length}`);
	return positionals[0] as string;
}

export function parseSettings(entries: string[] = []): Record<string, string> {
	const values: Record<string, string> = {};
	for (const entry of entries) {
		const at = entry.indexOf("=");
		if (at <= 0)
			throw new UsageError(`--set expects key=value, got "${entry}"`);
		values[entry.slice(0, at)] = entry.slice(at + 1);
	}
	return values;
}

export function parseScale(entries: string[] = []): number[] {
	const scales = entries.map((entry) => {
		const value = Number(entry);
		if (!Number.isFinite(value) || value <= 0)
			throw new UsageError(`--scale must be a positive number, got "${entry}"`);
		return value;
	});
	return scales.length > 0 ? scales : [1];
}
