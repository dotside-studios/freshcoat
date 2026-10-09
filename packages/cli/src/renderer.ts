import {
	type ByteLoader,
	createRenderer,
	type Renderer,
} from "@freshcoat-js/engine";
import {
	type CanvasKitBuild,
	fileLoader,
	loadCanvasKit,
} from "@freshcoat-js/engine/node";
import type { Io } from "./io";

export function createLoader(io: Io, root: string): ByteLoader {
	return fileLoader({ root, ...(io.fetch ? { next: remoteLoader(io) } : {}) });
}

export async function openRenderer(
	io: Io,
	options: {
		root: string;
		build: CanvasKitBuild;
		fonts?: Map<string, Uint8Array[]>;
	},
): Promise<Renderer> {
	return createRenderer({
		ck: await loadCanvasKit(options.build),
		load: createLoader(io, options.root),
		...(options.fonts ? { fonts: Object.fromEntries(options.fonts) } : {}),
	});
}

function remoteLoader(io: Io): ByteLoader {
	return async (src) => {
		if (!io.fetch) throw new Error(`cannot fetch ${src}`);
		const response = await io.fetch(src, {
			headers: {},
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw new Error(`fetch ${src} -> ${response.status}`);
		return new Uint8Array(await response.arrayBuffer());
	};
}
