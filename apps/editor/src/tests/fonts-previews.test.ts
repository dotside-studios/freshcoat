import { describe, expect, test } from "vitest";
import { createPreviewLoader, parsePreviewCss } from "~/fonts/previews";

const CSS = `@font-face {
  font-family: 'Lobster';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/l/font?kit=abc) format('woff2');
  unicode-range: U+4c, U+62;
}`;

function deferred() {
	let resolve: (css: string) => void = () => {};
	let reject: (e: Error) => void = () => {};
	const promise = new Promise<string>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("font previews", () => {
	test("reads each face's source and range from the stylesheet", () => {
		expect(parsePreviewCss(CSS)).toEqual([
			{
				src: "https://fonts.gstatic.com/l/font?kit=abc",
				unicodeRange: "U+4c, U+62",
			},
		]);
		expect(parsePreviewCss("bad")).toEqual([]);
	});

	test("at most six requests run at once, and the rest wait", async () => {
		const pending = new Map<string, ReturnType<typeof deferred>>();
		const loader = createPreviewLoader({
			fetchCss: (url) => {
				const d = deferred();
				pending.set(url, d);
				return d.promise;
			},
			loadFaces: async () => {},
		});
		const families = Array.from({ length: 10 }, (_, i) => `Family ${i}`);
		const results = families.map((f) => loader.request(f).result);
		expect(loader.inFlight).toBe(6);
		expect(loader.waiting).toBe(4);
		expect(pending.size).toBe(6);
		for (const d of pending.values()) d.resolve(CSS);
		await tick();
		expect(pending.size).toBe(10);
		expect(loader.inFlight).toBe(4);
		for (const d of pending.values()) d.resolve(CSS);
		expect(await Promise.all(results)).toEqual(
			families.map((f) => `fc-preview-${f.replace(" ", "-")}`),
		);
		expect(loader.inFlight).toBe(0);
	});

	test("a family is fetched once a session", async () => {
		let fetches = 0;
		const loader = createPreviewLoader({
			fetchCss: async () => {
				fetches++;
				return CSS;
			},
			loadFaces: async () => {},
		});
		await loader.request("Lobster").result;
		await loader.request("Lobster").result;
		expect(fetches).toBe(1);
	});

	test("a failed preview falls back quietly, and is not retried", async () => {
		let fetches = 0;
		const offline = createPreviewLoader({
			fetchCss: async () => {
				fetches++;
				throw new Error("offline");
			},
		});
		expect(await offline.request("Lobster").result).toBeNull();
		expect(await offline.request("Lobster").result).toBeNull();
		expect(fetches).toBe(1);
		const broken = createPreviewLoader({
			fetchCss: async () => CSS,
			loadFaces: async () => {
				throw new Error("bad font");
			},
		});
		expect(await broken.request("Lobster").result).toBeNull();
		const empty = createPreviewLoader({ fetchCss: async () => "" });
		expect(await empty.request("Lobster").result).toBeNull();
	});

	test("a request cancelled before it starts is never fetched", async () => {
		const seen: string[] = [];
		const hold = deferred();
		const loader = createPreviewLoader({
			limit: 1,
			fetchCss: (url) => {
				seen.push(url);
				return hold.promise;
			},
			loadFaces: async () => {},
		});
		const first = loader.request("A");
		const second = loader.request("B");
		second.cancel();
		expect(loader.waiting).toBe(0);
		hold.resolve(CSS);
		await first.result;
		await tick();
		expect(seen).toHaveLength(1);
		// asked for again later, it queues afresh
		expect(await loader.request("B").result).toBe("fc-preview-B");
	});
});
