// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Autosave } from "~/app/autosave";
import { createRecentStore, type RecentEntry, reopenable } from "~/app/recent";
import { singleTemplateWorkspace } from "~/state/workspace";
import { doc } from "./doc-fixture";

let dbCount = 0;
const freshDb = () => `recent-test-${++dbCount}`;

const entry = (
	id: string,
	openedAt: number,
	source: RecentEntry["source"] = { kind: "workspace" },
): RecentEntry => ({ id, name: id, openedAt, source });

describe("recent store", () => {
	it("lists the newest first and keeps the last 20", async () => {
		const store = createRecentStore(freshDb());
		for (let i = 0; i < 22; i++) await store.record(entry(`r${i}`, i));
		const list = await store.list();
		expect(list).toHaveLength(20);
		expect(list[0]?.id).toBe("r21");
		expect(list.at(-1)?.id).toBe("r2");
	});

	it("updates the name and time of an entry it has, keeping the rest", async () => {
		const store = createRecentStore(freshDb());
		await store.record(entry("a", 1, { kind: "sample", id: "minimal" }));
		const thumb = new Blob([new Uint8Array([1])], { type: "image/png" });
		await store.setThumbnail("a", thumb, 5);
		await store.record({ ...entry("a", 9), name: "Renamed" });
		const [a] = await store.list();
		expect(a).toMatchObject({
			name: "Renamed",
			openedAt: 9,
			source: { kind: "sample", id: "minimal" },
			thumbnailFor: 5,
		});
		expect(a?.thumbnail?.size).toBe(1);
	});

	it("removes an entry", async () => {
		const store = createRecentStore(freshDb());
		await store.record(entry("a", 1));
		await store.record(entry("b", 2));
		await store.remove("a");
		expect((await store.list()).map((e) => e.id)).toEqual(["b"]);
	});
});

describe("reopenable", () => {
	const saved: Autosave = {
		workspace: singleTemplateWorkspace(doc(), "doc.coat"),
		fileName: "Untitled.coatworkspace",
		savedAt: 10,
		recentId: "w1",
	};
	const exists = (s: { id: string }) => s.id !== "gone";

	it("keeps the autosaved workspace, and samples and starters that exist, each once", () => {
		const items = reopenable(
			[
				entry("w2", 6),
				entry("w1", 5),
				entry("s2", 4, { kind: "sample", id: "minimal" }),
				entry("s1", 3, { kind: "sample", id: "minimal" }),
				entry("g", 2, { kind: "starter", id: "gone" }),
				entry("t", 1, { kind: "starter", id: "davi-card" }),
			],
			saved,
			exists,
		);
		expect(items.map((i) => [i.entry.id, i.reopen.kind])).toEqual([
			["w1", "restore"],
			["s2", "sample"],
			["t", "starter"],
		]);
		expect(items[0]?.entry.name).toBe(saved.workspace.name);
	});

	it("restores a sample the autosave was written for, rather than opening it again", () => {
		const items = reopenable(
			[{ ...entry("w1", 5, { kind: "sample", id: "minimal" }) }],
			saved,
			exists,
		);
		expect(items[0]?.reopen.kind).toBe("restore");
	});

	it("drops workspaces once nothing holds them", () => {
		expect(reopenable([entry("w1", 5)], null, exists)).toEqual([]);
	});
});
