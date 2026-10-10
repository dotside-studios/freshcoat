import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError, type Io } from "./io";

const MODULE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"];

export function isTemplateModule(path: string): boolean {
	return MODULE_EXTENSIONS.includes(extname(path).toLowerCase());
}

const BOOTSTRAP = `
import { writeFileSync } from "node:fs";
const env = process.env;
const fail = (message) => { process.stderr.write(message + "\\n"); process.exit(3); };
const mod = await import(env.FRESHCOAT_MODULE);
let value = "default" in mod ? mod.default : mod.template;
if (value === undefined) fail("the module has no default or template export");
value = await (typeof value === "function" ? value() : value);
if (value === null || typeof value !== "object" || Array.isArray(value))
	fail("the module's export is not a template object");
writeFileSync(env.FRESHCOAT_MODULE_OUT, JSON.stringify(value));
`;

type Runtime = { command: string; args: string[] };

export function moduleRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
	const command = env.FRESHCOAT_RUNTIME || process.execPath;
	const name = basename(command).toLowerCase().replace(/\.exe$/, "");
	if (name.startsWith("deno")) return { command, args: ["eval", BOOTSTRAP] };
	if (name.startsWith("bun")) return { command, args: ["-e", BOOTSTRAP] };
	return { command, args: ["--input-type=module", "-e", BOOTSTRAP] };
}

export async function evaluateTemplateModule(io: Io, path: string): Promise<string> {
	const runtime = moduleRuntime(io.env);
	const dir = await mkdtemp(join(tmpdir(), "freshcoat-module-"));
	const out = join(dir, "template.json");
	try {
		const { code, error, output } = await run(runtime, {
			...(io.env ?? process.env),
			FRESHCOAT_MODULE: pathToFileURL(resolve(io.cwd, path)).href,
			FRESHCOAT_MODULE_OUT: out,
		}, io.cwd);
		if (error)
			throw new CliError(`${path}: cannot start ${runtime.command}: ${error.message}`);
		if (code === 3) throw new CliError(`${path}: ${output.trim()}`);
		if (code !== 0)
			throw new CliError(
				`${path}: evaluating the module failed with code ${code}${output ? `\n${output.trimEnd()}` : ""}`,
			);
		if (output) io.stderr(output);
		return await readFile(out, "utf8");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function run(
	runtime: Runtime,
	env: NodeJS.ProcessEnv,
	cwd: string,
): Promise<{ code: number | null; error?: Error; output: string }> {
	return new Promise((done) => {
		const child = spawn(runtime.command, runtime.args, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.on("error", (error) => done({ code: null, error, output }));
		child.on("close", (code) => done({ code, output }));
	});
}
