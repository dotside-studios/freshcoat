import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
let log: string;
// Resolve through version-manager shims once. Launching a shim inside the
// fixture can prepend its own bin directory ahead of the fake npm executable.
const node = Bun.spawnSync(["node", "-p", "process.execPath"])
	.stdout.toString()
	.trim();
let artifacts: {
	name: string;
	version: string;
	filename: string;
	integrity: string;
}[];

beforeEach(() => {
	directory = realpathSync(mkdtempSync(join(tmpdir(), "freshcoat-publisher-")));
	log = join(directory, "calls.jsonl");
	mkdirSync(join(directory, "scripts"));
	mkdirSync(join(directory, "dist", "releases"), { recursive: true });
	mkdirSync(join(directory, "bin"));
	cpSync(
		join(import.meta.dir, "publish-packages.mjs"),
		join(directory, "scripts", "publish-packages.mjs"),
	);
	artifacts = ["@freshcoat-js/engine", "@freshcoat-js/for-print", "@freshcoat-js/coatfile"].map(
		(name) => {
			const filename = `${name.replace(/^@/, "").replace("/", "-")}-0.1.0.tgz`;
			const bytes = Buffer.from(name);
			writeFileSync(join(directory, "dist", "releases", filename), bytes);
			return {
				name,
				version: "0.1.0",
				filename,
				integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
			};
		},
	);
	writeFileSync(
		join(directory, "dist", "releases", "packages.json"),
		JSON.stringify(artifacts),
	);
	// The publisher runs real Node processes against a fake registry CLI.
	// No test can contact npm or publish anything.
	writeFileSync(
		join(directory, "bin", "npm"),
		`#!${node}
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "view") {
  if (process.env.REGISTRY_MODE === "same") {
    const entries = JSON.parse(readFileSync(process.env.ARTIFACTS, "utf8"));
    console.log(JSON.stringify(entries.find(e => args[1] === e.name + "@" + e.version).integrity));
  } else if (process.env.REGISTRY_MODE === "different") console.log(JSON.stringify("sha512-other"));
  else { console.error(process.env.REGISTRY_MODE === "network" ? "ENETUNREACH" : "E404"); process.exit(1); }
} else console.log("published");
`,
		{ mode: 0o755 },
	);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function publish(dryRun = false, env: Record<string, string> = {}) {
	return Bun.spawnSync(
		[
			node,
			join(directory, "scripts", "publish-packages.mjs"),
			...(dryRun ? ["--dry-run"] : []),
		],
		{
			cwd: directory,
			env: {
				...process.env,
				PATH: `${join(directory, "bin")}:${process.env.PATH}`,
				RELEASE_TAG: "v0.1.0",
				CALL_LOG: log,
				ARTIFACTS: join(directory, "dist", "releases", "packages.json"),
				...env,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
}

function calls(): string[][] {
	return existsSync(log)
		? readFileSync(log, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
		: [];
}

describe("release publisher", () => {
	test("rejects a wrong tag before invoking npm", () => {
		expect(publish(false, { RELEASE_TAG: "v9.0.0" }).exitCode).not.toBe(0);
		expect(calls()).toEqual([]);
	});

	test("checks all tarball hashes before publishing the first package", () => {
		writeFileSync(
			join(directory, "dist", "releases", artifacts[2]!.filename),
			"modified",
		);
		expect(publish().exitCode).not.toBe(0);
		expect(calls()).toEqual([]);
	});

	test("dry runs never inspect or publish to the registry", () => {
		expect(publish(true).exitCode).toBe(0);
		expect(calls()).toHaveLength(3);
		for (const args of calls()) {
			expect(args[0]).toBe("publish");
			expect(args).toContain("--dry-run");
		}
	});

	test("reruns skip versions only when registry integrity matches", () => {
		expect(publish(false, { REGISTRY_MODE: "same" }).exitCode).toBe(0);
		expect(calls().map((args) => args[0])).toEqual(["view", "view", "view"]);
	});

	test("refuses to overwrite an existing version with different bytes", () => {
		expect(publish(false, { REGISTRY_MODE: "different" }).exitCode).not.toBe(0);
		expect(calls().map((args) => args[0])).toEqual(["view"]);
	});

	test("registry connection failures are not mistaken for missing packages", () => {
		expect(publish(false, { REGISTRY_MODE: "network" }).exitCode).not.toBe(0);
		expect(calls().map((args) => args[0])).toEqual(["view"]);
	});

	test("publishes missing versions in dependency order", () => {
		expect(publish().exitCode).toBe(0);
		const invoked = calls();
		expect(invoked.map((args) => args[0])).toEqual([
			"view",
			"publish",
			"view",
			"publish",
			"view",
			"publish",
		]);
		expect(
			invoked.filter((args) => args[0] === "publish").map((args) => args[1]),
		).toEqual(
			artifacts.map((artifact) =>
				join(directory, "dist", "releases", artifact.filename),
			),
		);
	});
});
