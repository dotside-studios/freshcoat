import type { FontFetch } from "@freshcoat-js/engine";

export type Io = {
	stdout(text: string): void;
	stderr(text: string): void;
	cwd: string;
	fetch?: FontFetch;
	tty?: boolean;
};

export function processIo(): Io {
	return {
		stdout: (text) => void process.stdout.write(text),
		stderr: (text) => void process.stderr.write(text),
		cwd: process.cwd(),
		tty: process.stderr.isTTY === true,
	};
}

export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode = 1,
	) {
		super(message);
		this.name = "CliError";
	}
}

export type Log = {
	out(line: string): void;
	warn(line: string): void;
	info(line: string): void;
	progress(line: string): void;
	endProgress(): void;
	readonly quiet: boolean;
	readonly tty: boolean;
};

export function createLog(io: Io, quiet: boolean): Log {
	let open = false;
	const end = () => {
		if (open) io.stderr("\n");
		open = false;
	};
	return {
		quiet,
		tty: io.tty === true,
		out: (line) => io.stdout(`${line}\n`),
		warn(line) {
			if (quiet) return;
			end();
			io.stderr(`warning: ${line}\n`);
		},
		info(line) {
			if (quiet) return;
			end();
			io.stderr(`${line}\n`);
		},
		progress(line) {
			if (quiet) return;
			if (io.tty) {
				io.stderr(`\r\x1b[K${line}`);
				open = true;
			} else io.stderr(`${line}\n`);
		},
		endProgress: end,
	};
}
