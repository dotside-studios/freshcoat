import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { listenForCancel, pendingFiles } from "../src/cancel";
import { main } from "../src/main";
import {
	card,
	type Sandbox,
	sandbox,
	workspaceBytes,
	workspaceOf,
} from "./helpers";

let box: Sandbox;

beforeAll(async () => {
	box = await sandbox();
	await box.write("badge.json", JSON.stringify(card()));
	const rows = Array.from({ length: 80 }, (_, i) => `Person ${i}`);
	await box.write("offline.json", JSON.stringify(card({ fonts: [] })));
	await box.write("people.csv", `name\n${rows.join("\n")}\n`);
	await box.write("pair.csv", `name\n${rows.slice(0, 2).join("\n")}\n`);
	await box.write("crew.coatworkspace", await crew(rows));
	await box.write("pair.coatworkspace", await crew(rows.slice(0, 2)));
});

function crew(rows: string[]): Promise<Uint8Array> {
	const workspace = workspaceOf(card());
	const [dataset] = workspace.datasets;
	if (dataset)
		dataset.records = rows.map((name, i) => ({
			id: `r_${String(i + 1).padStart(8, "0")}`,
			values: { name },
			status: "pending" as const,
		}));
	return workspaceBytes(workspace);
}

afterAll(() => box.cleanup());

describe("cancellation", () => {
	test("a workspace zip export cancelled midway leaves no file", async () => {
		const run = await box.runCancelled(
			/rendered/,
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_png",
			"--out",
			"crew.zip",
			"--jobs",
			"1",
		);
		expect(run.code).toBe(130);
		expect(run.stderr).toContain("cancelled");
		expect(existsSync(box.path("crew.zip"))).toBe(false);
	});

	test("a workspace pdf export cancelled midway leaves no file", async () => {
		const run = await box.runCancelled(
			/rendered|assembling/,
			"render",
			"crew.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"crew.pdf",
			"--jobs",
			"1",
		);
		expect(run.code).toBe(130);
		expect(existsSync(box.path("crew.pdf"))).toBe(false);
	});

	test("a batch export cancelled midway leaves no file", async () => {
		const run = await box.runCancelled(
			/rendered/,
			"render",
			"badge.json",
			"--data",
			"people.csv",
			"--out",
			"people.zip",
			"--jobs",
			"1",
		);
		expect(run.code).toBe(130);
		expect(existsSync(box.path("people.zip"))).toBe(false);
	});

	test("a batch export cancelled before it starts writes nothing", async () => {
		const controller = new AbortController();
		controller.abort();
		const code = await main(
			[
				"render",
				"badge.json",
				"--data",
				"people.csv",
				"--out",
				"early.zip",
				"-q",
			],
			{
				stdout() {},
				stderr() {},
				cwd: box.dir,
				fetch: box.fetch,
				signal: controller.signal,
			},
		);
		expect(code).toBe(130);
		expect(existsSync(box.path("early.zip"))).toBe(false);
	});

	test("a template render cancelled before it starts writes no images", async () => {
		const controller = new AbortController();
		controller.abort();
		const code = await main(["render", "badge.json", "--out", "frames"], {
			stdout() {},
			stderr() {},
			cwd: box.dir,
			fetch: box.fetch,
			signal: controller.signal,
		});
		expect(code).toBe(130);
		expect(existsSync(box.path("frames"))).toBe(false);
	});

	test("an uncancelled export still succeeds", async () => {
		const run = await box.run(
			"render",
			"badge.json",
			"--data",
			"pair.csv",
			"--out",
			"done.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(existsSync(box.path("done.zip"))).toBe(true);
	});
});

describe("listenForCancel", () => {
	const counts = () => [
		process.listenerCount("SIGINT"),
		process.listenerCount("SIGTERM"),
	];

	test("aborts on SIGTERM with 143 and removes its listeners", () => {
		const before = counts();
		const cancel = listenForCancel();
		cancel.cancellable = true;
		expect(process.listenerCount("SIGTERM")).toBe(before[1]! + 1);
		process.emit("SIGTERM");
		expect(cancel.signal.aborted).toBe(true);
		expect(cancel.signal.reason.code).toBe(143);
		cancel.dispose();
		expect(counts()).toEqual(before);
	});

	test("aborts on SIGINT with 130", () => {
		const cancel = listenForCancel();
		cancel.cancellable = true;
		process.emit("SIGINT");
		expect(cancel.signal.aborted).toBe(true);
		expect(cancel.signal.reason.code).toBe(130);
		cancel.dispose();
	});

	test("exits at once while not cancellable, removing pending files", () => {
		const exit = process.exit;
		const codes: (number | undefined)[] = [];
		process.exit = ((code?: number) => {
			codes.push(code);
		}) as typeof process.exit;
		const pending = box.path("pending.tmp");
		writeFileSync(pending, "partial");
		pendingFiles.add(pending);
		const cancel = listenForCancel();
		try {
			process.emit("SIGINT");
		} finally {
			process.exit = exit;
			cancel.dispose();
			pendingFiles.delete(pending);
		}
		expect(codes).toEqual([130]);
		expect(existsSync(pending)).toBe(false);
	});

	test("main adds no process listeners", async () => {
		const before = counts();
		const during: number[][] = [];
		const controller = new AbortController();
		const code = await main(["--version"], {
			stdout() {
				during.push(counts());
			},
			stderr() {},
			cwd: box.dir,
			signal: controller.signal,
		});
		expect(code).toBe(0);
		expect(during).toEqual([before]);
		await box.run("--version");
		expect(counts()).toEqual(before);
	});
});

describe("existing output", () => {
	const cases = [
		["a workspace zip", "kept.zip", "crew.coatworkspace", "--preset", "p_png"],
		["a workspace pdf", "kept.pdf", "crew.coatworkspace", "--preset", "p_pdf"],
		["a batch zip", "kept-batch.zip", "badge.json", "--data", "people.csv"],
		["a batch pdf", "kept-batch.pdf", "badge.json", "--data", "people.csv"],
	] as const;

	for (const [name, out, file, ...args] of cases)
		test(`survives cancelling ${name}`, async () => {
			await box.write(out, "old");
			const run = await box.runCancelled(
				/rendered/,
				"render",
				file,
				...args,
				"--out",
				out,
				"--jobs",
				"1",
			);
			expect(run.code).toBe(130);
			expect(readFileSync(box.path(out), "utf8")).toBe("old");
			expect(readdirSync(box.dir).filter((f) => f.endsWith(".tmp"))).toEqual(
				[],
			);
		});

	test("is replaced by a finished export", async () => {
		await box.write("replaced.pdf", "old");
		const run = await box.run(
			"render",
			"pair.coatworkspace",
			"--preset",
			"p_pdf",
			"--out",
			"replaced.pdf",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(
			readFileSync(box.path("replaced.pdf")).subarray(0, 5).toString(),
		).toBe("%PDF-");
		expect(readdirSync(box.dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
	});
});

describe("signals", () => {
	test("SIGINT stops a running export with 130 and no partial file", async () => {
		const child = spawn(
			process.execPath,
			[
				new URL("../src/bin.ts", import.meta.url).pathname,
				"render",
				"offline.json",
				"--data",
				"people.csv",
				"--out",
				"signalled.zip",
				"--jobs",
				"1",
				"--no-cache",
			],
			{ cwd: box.dir, stdio: ["ignore", "ignore", "pipe"] },
		);
		const exited = new Promise<number | null>((done) =>
			child.on("exit", (code) => done(code)),
		);
		let stderr = "";
		let sent = false;
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			if (!sent && /rendered/.test(stderr)) {
				sent = true;
				child.kill("SIGINT");
			}
		});
		const code = await exited;
		expect(sent).toBe(true);
		expect(code).toBe(130);
		expect(existsSync(box.path("signalled.zip"))).toBe(false);
	}, 60_000);
});

describe("forced exit", () => {
	test("a second SIGINT removes the temporary file", async () => {
		await box.write("forced.zip", "old");
		const child = spawn(
			process.execPath,
			[
				new URL("../src/bin.ts", import.meta.url).pathname,
				"render",
				"offline.json",
				"--data",
				"people.csv",
				"--out",
				"forced.zip",
				"--jobs",
				"1",
				"--no-cache",
			],
			{ cwd: box.dir, stdio: ["ignore", "ignore", "pipe"] },
		);
		const exited = new Promise<number | null>((done) =>
			child.on("exit", (code) => done(code)),
		);
		let stderr = "";
		let sent = false;
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			if (!sent && /rendered/.test(stderr)) {
				sent = true;
				child.kill("SIGINT");
				child.kill("SIGINT");
			}
		});
		const code = await exited;
		expect(sent).toBe(true);
		expect(code).toBe(130);
		expect(readFileSync(box.path("forced.zip"), "utf8")).toBe("old");
		expect(readdirSync(box.dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
	}, 60_000);
});
