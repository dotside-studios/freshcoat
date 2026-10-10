import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FontFetch } from "@freshcoat-js/engine";
import type { Io } from "./io";

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.FRESHCOAT_CACHE_DIR) return env.FRESHCOAT_CACHE_DIR;
	if (process.platform === "darwin")
		return join(homedir(), "Library", "Caches", "freshcoat");
	if (process.platform === "win32" && env.LOCALAPPDATA)
		return join(env.LOCALAPPDATA, "freshcoat", "Cache");
	return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "freshcoat");
}

export function fontFetch(io: Io): FontFetch | undefined {
	if (io.cacheDir === undefined) return io.fetch;
	const base: FontFetch = io.fetch ?? ((url, init) => fetch(url, init));
	return cachedFetch(base, join(io.cacheDir, "fonts"));
}

export function withFetch(fetch: FontFetch | undefined): { fetch?: FontFetch } {
	return fetch ? { fetch } : {};
}

export function cachedFetch(base: FontFetch, dir: string): FontFetch {
	return async (url, init) => {
		const key = createHash("sha256")
			.update(`${url}\n${JSON.stringify(init.headers)}`)
			.digest("hex");
		const path = join(dir, key);
		try {
			if (Date.now() - (await stat(path)).mtimeMs < MAX_AGE_MS)
				return hit(new Uint8Array(await readFile(path)));
		} catch {}
		const response = await base(url, init);
		if (!response.ok) return response;
		const bytes = new Uint8Array(await response.arrayBuffer());
		try {
			await mkdir(dir, { recursive: true });
			const temporary = `${path}.${process.pid}.tmp`;
			await writeFile(temporary, bytes);
			await rename(temporary, path);
		} catch {}
		return hit(bytes);
	};
}

function hit(bytes: Uint8Array): Awaited<ReturnType<FontFetch>> {
	return {
		ok: true,
		status: 200,
		text: async () => new TextDecoder().decode(bytes),
		arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
	};
}
