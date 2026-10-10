import {
	type ByteLoader,
	createRenderer,
	fetchLoader,
	type Renderer,
} from "@freshcoat-js/engine";
import {
	type CanvasKitBuild,
	fileLoader,
	loadCanvasKit,
} from "@freshcoat-js/engine/node";
import { assetRef, type DatasetAsset } from "@freshcoat-js/workspace";
import type { Io } from "./io";

export function createLoader(
	io: Io,
	root: string,
	assets: readonly DatasetAsset[] = [],
): ByteLoader {
	const files = fileLoader({ root, ...(io.fetch ? { next: remoteLoader(io) } : {}) });
	if (assets.length === 0) return files;
	const refs = new Map(assets.map((asset) => [assetRef(asset.sha256), asset.blob]));
	return async (src) => {
		const blob = refs.get(src);
		return blob ? new Uint8Array(await blob.arrayBuffer()) : files(src);
	};
}

export async function openRenderer(
	io: Io,
	options: {
		root: string;
		build: CanvasKitBuild;
		fonts?: Map<string, Uint8Array[]>;
		assets?: readonly DatasetAsset[];
	},
): Promise<Renderer> {
	return createRenderer({
		ck: await loadCanvasKit(options.build),
		load: createLoader(io, options.root, options.assets),
		...(options.fonts ? { fonts: Object.fromEntries(options.fonts) } : {}),
	});
}

function remoteLoader(io: Io): ByteLoader {
	return async (src) => {
		if (src.startsWith("data:")) return fetchLoader(src);
		if (!io.fetch) throw new Error(`cannot fetch ${src}`);
		const response = await io.fetch(src, {
			headers: {},
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw new Error(`fetch ${src} -> ${response.status}`);
		return new Uint8Array(await response.arrayBuffer());
	};
}
