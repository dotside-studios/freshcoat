import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { listenForCancel } from "../src/cancel";
import { main } from "../src/main";
import { card, type Sandbox, sandbox, workspaceBytes, workspaceOf } from "./helpers";

let box: Sandbox;

beforeAll(async () => {
	box = await sandbox();
	await box.write("badge.json", JSON.stringify(card()));
	const rows = Array.from({ length: 80 }, (_, i) => `Person ${i}`);
	await box.write("offline.json", JSON.stringify(card({ fonts: [] })));
	await box.write("people.csv", `name\n${rows.join("\n")}\n`);
	const workspace = workspaceOf(card());
	const [dataset] = workspace.datasets;
	if (dataset)
		dataset.records = rows.map((name, i) => ({
			id: `r_${String(i + 1).padStart(8, "0")}`,
			values: { name },
			status: "pending" as const,
		}));
	await box.write("crew.coatworkspace", await workspaceBytes(workspace));
});

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
			["render", "badge.json", "--data", "people.csv", "--out", "early.zip", "-q"],
			{ stdout() {}, stderr() {}, cwd: box.dir, fetch: box.fetch, signal: controller.signal },
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
			"people.csv",
			"--out",
			"done.zip",
			"-q",
		);
		expect(run.code).toBe(0);
		expect(existsSync(box.path("done.zip"))).toBe(true);
	});
});

describe("listenForCancel", () => {
	test("aborts on SIGTERM with 143 and removes its listeners", () => {
		const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
		const cancel = listenForCancel();
		expect(process.listenerCount("SIGTERM")).toBe(before[1]! + 1);
		process.emit("SIGTERM");
		expect(cancel.signal.aborted).toBe(true);
		expect(cancel.code).toBe(143);
		cancel.dispose();
		expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
	});

	test("aborts on SIGINT with 130", () => {
		const cancel = listenForCancel();
		process.emit("SIGINT");
		expect(cancel.signal.aborted).toBe(true);
		expect(cancel.code).toBe(130);
		cancel.dispose();
	});

	test("follows an outer signal", () => {
		const outer = new AbortController();
		const cancel = listenForCancel(outer.signal);
		outer.abort();
		expect(cancel.signal.aborted).toBe(true);
		cancel.dispose();
	});

	test("main leaves no listeners behind", async () => {
		const before = process.listenerCount("SIGINT");
		await box.run("--version");
		expect(process.listenerCount("SIGINT")).toBe(before);
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
		const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
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
