import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Workspace } from "@freshcoat-js/workspace";
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

describe("saveWorkspace", () => {
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
