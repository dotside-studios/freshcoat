import { subtleSha256 } from "@freshcoat-js/coatfile";
import { fixtures } from "@freshcoat-js/coatfile/fixtures";
import type { DatasetAsset } from "@freshcoat-js/workspace";
import { createAutosaveStore } from "~/app/autosave";
import { singleTemplateWorkspace } from "~/state/workspace";

export type AutosaveProbe = { assets: DatasetAsset[] };

/** Photos from the files picked into `selector`, read while they are intact. */
export async function pickAssets(selector: string): Promise<AutosaveProbe> {
	const input = document.querySelector(selector) as HTMLInputElement;
	const assets: DatasetAsset[] = [];
	for (const file of input.files ?? []) {
		const blob = file.slice(0, file.size, file.type);
		assets.push({
			sha256: await subtleSha256(new Uint8Array(await blob.arrayBuffer())),
			contentType: file.type,
			name: file.name,
			size: file.size,
			blob,
		});
	}
	return { assets };
}

function open(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name);
		req.onupgradeneeded = () => req.result.createObjectStore("a");
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function rawPut(blob: Blob): Promise<{
	thrown?: string;
	request?: string;
	transaction: string;
}> {
	const db = await open(`raw-${crypto.randomUUID()}`);
	const out: { thrown?: string; request?: string; transaction: string } = {
		transaction: "",
	};
	const tx = db.transaction("a", "readwrite");
	try {
		const req = tx.objectStore("a").put(blob, "k");
		req.onerror = () => {
			out.request = req.error?.name;
		};
	} catch (err) {
		out.thrown = (err as Error).name;
	}
	out.transaction = await new Promise<string>((resolve) => {
		tx.oncomplete = () => resolve("complete");
		tx.onabort = () => resolve(`abort ${tx.error?.name ?? "null"}`);
	});
	db.close();
	return out;
}

/** Autosaves a workspace holding `probe`'s photos and reads it back. */
export async function runAutosave(probe: AutosaveProbe) {
	const unreadable: string[] = [];
	const store = createAutosaveStore(`autosave-${crypto.randomUUID()}`, {
		onUnreadable: (asset) => unreadable.push(asset.name),
	});
	const ws = singleTemplateWorkspace(fixtures.fullFeatureCard, "w.coat");
	ws.datasets = [
		{
			id: "d1",
			name: "People",
			columns: [],
			records: [],
			assets: probe.assets,
		},
	];
	await store.write({ workspace: ws, fileName: "w.coatworkspace" });
	const read = await store.read();
	return {
		saved: read !== null,
		assets: read?.workspace.datasets[0]?.assets.map((a) => a.name) ?? [],
		missingAssets: read?.missingAssets ?? 0,
		unreadable,
	};
}
