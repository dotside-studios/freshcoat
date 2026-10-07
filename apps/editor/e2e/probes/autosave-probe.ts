import { createAutosaveStore } from "~/app/autosave";

const store = createAutosaveStore("freshcoat-autosave-probe");

export async function keepPicked(input: HTMLInputElement) {
	const file = input.files?.[0];
	if (!file) throw new Error("no file picked");
	const blob = file.slice(0, file.size, file.type);
	await store.keep({
		sha256: "picked",
		contentType: file.type,
		name: file.name,
		size: file.size,
		blob,
	});
	return file.size;
}

export async function readKept() {
	const blob = await store.asset("picked");
	if (!blob) return { error: "missing" };
	try {
		return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
	} catch (err) {
		return { error: (err as Error).name };
	}
}
