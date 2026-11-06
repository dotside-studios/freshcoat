import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Workspace } from "@freshcoat-js/workspace";
import { pendingFiles } from "../src/cancel";
import { saveWorkspace } from "../src/commands/workspace";
import {
	card,
	type Sandbox,
	sandbox,
	solidPng,
	workspaceBytes,
	workspaceOf,
} from "./helpers";

let box: Sandbox;

beforeEach(async () => {
	box = await sandbox();
});

afterEach(() => box.cleanup());

async function withAsset(blob: Blob): Promise<Workspace> {
	const workspace = workspaceOf(card());
	const [dataset] = workspace.datasets;
	if (!dataset) throw new Error("no dataset");
	dataset.assets = [
		{
			sha256: "a".repeat(64),
			contentType: "image/png",
			name: "a.png",
			size: blob.size,
			blob,
		},
	];
	return workspace;
}

async function files(): Promise<string[]> {
	return (await readdir(box.dir)).filter(
		(name) => name.endsWith(".coatworkspace") || name.endsWith(".tmp"),
	);
}

function gatedAsset(fail = false) {
	let release!: () => void;
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const blob = Object.assign(new Blob([new Uint8Array([1, 2, 3])]), {
		stream: () =>
			new ReadableStream<Uint8Array>({
				async start(controller) {
					entered();
					await gate;
					if (fail) controller.error(new Error("packing failed"));
					else {
						controller.enqueue(new Uint8Array([1, 2, 3]));
						controller.close();
					}
				},
			}),
	});
	return { blob, started, release };
}

describe("saveWorkspace", () => {
	test("overlapping saves commit in completion order", async () => {
		const path = await box.write("overlap.coatworkspace", "original");
		const gate = gatedAsset();
		const first = await withAsset(gate.blob);
		const second = workspaceOf(card());
		const saving = saveWorkspace(path, first);
		try {
			await gate.started;
			await saveWorkspace(path, second);
			expect((await readFile(path)).equals(await workspaceBytes(second))).toBe(
				true,
			);
		} finally {
			gate.release();
		}
		await saving;
		expect(
			(await readFile(path)).equals(
				await workspaceBytes(
					await withAsset(new Blob([new Uint8Array([1, 2, 3])])),
				),
			),
		).toBe(true);
		expect(await files()).toEqual(["overlap.coatworkspace"]);
	});

	test("failed packing cleans only its own staging while another save waits", async () => {
		const path = await box.write("overlap.coatworkspace", "original");
		const failed = gatedAsset(true);
		const kept = gatedAsset();
		const failure = saveWorkspace(path, await withAsset(failed.blob));
		const rejected = failure.then(
			() => {
				throw new Error("expected packing to fail");
			},
			(error: unknown) => error,
		);
		const success = saveWorkspace(path, await withAsset(kept.blob));
		try {
			await Promise.all([failed.started, kept.started]);
			failed.release();
			expect(await rejected).toBeInstanceOf(Error);
			expect(await readFile(path, "utf8")).toBe("original");
			expect(
				(await files()).filter((name) => name.endsWith(".tmp")),
			).toHaveLength(1);
			expect(
				[...pendingFiles].filter((name) => name.startsWith(path)),
			).toHaveLength(1);
		} finally {
			failed.release();
			kept.release();
		}
		await success;
		expect(await files()).toEqual(["overlap.coatworkspace"]);
		expect(
			[...pendingFiles].filter((name) => name.startsWith(path)),
		).toHaveLength(0);
	});

	test("writes the same bytes as packing to a Blob", async () => {
		const workspace = await withAsset(
			new Blob([(await solidPng(300, 300, [9, 99, 199])) as BlobPart]),
		);
		const path = join(box.dir, "saved.coatworkspace");
		await saveWorkspace(path, workspace);
		const expected = await workspaceBytes(workspace);
		expect((await readFile(path)).equals(expected)).toBe(true);
		expect(await files()).toEqual(["saved.coatworkspace"]);
	});

	test("replaces an existing file", async () => {
		const path = await box.write("saved.coatworkspace", "old");
		const workspace = workspaceOf(card());
		await saveWorkspace(path, workspace);
		expect((await readFile(path)).equals(await workspaceBytes(workspace))).toBe(
			true,
		);
	});

	test("a failure while packing leaves the original and no temp file", async () => {
		const failing = Object.assign(new Blob([new Uint8Array(1000)]), {
			stream: () =>
				new ReadableStream({
					pull() {
						throw new Error("disk on fire");
					},
				}),
		});
		const path = await box.write("saved.coatworkspace", "original");
		const workspace = await withAsset(failing);
		await expect(saveWorkspace(path, workspace)).rejects.toThrow();
		expect(await readFile(path, "utf8")).toBe("original");
		expect(await files()).toEqual(["saved.coatworkspace"]);
	});

	test("a failure to open the temp file rejects and leaves nothing behind", async () => {
		const path = join(box.dir, "missing", "saved.coatworkspace");
		await expect(saveWorkspace(path, workspaceOf(card()))).rejects.toThrow();
		expect(await files()).toEqual([]);
	});
});
