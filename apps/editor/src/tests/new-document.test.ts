import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EditorController } from "~/app/controller";
import { VEND_SANS } from "~/samples/vend-sans";
import { loadVendSans } from "~/samples/vend-sans-file";

const toast = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("@freshcoat-js/ui/toast", async (actual) => ({
	...(await actual<object>()),
	toast,
}));

const APP_ROOT = resolve(import.meta.dirname, "../..");

function serveFromDisk() {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async (url: string) => new Response(await readFile(join(APP_ROOT, url))),
		),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	toast.mockClear();
});

describe("new document", () => {
	test("reports a font that fails to load, and opens nothing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 503 })),
		);
		const c = new EditorController();
		expect(await c.newDocument({ width: 100, height: 100 })).toBe(false);
		expect(c.template).toBeNull();
		expect(toast).toHaveBeenCalledWith(
			"Couldn't load Vend Sans for the new template",
			expect.objectContaining({ tone: "danger" }),
		);
	});

	test("fetches the same Vend Sans the samples inline", async () => {
		serveFromDisk();
		expect(await loadVendSans()).toEqual(VEND_SANS);
	});

	test("opens with Vend Sans embedded", async () => {
		serveFromDisk();
		const c = new EditorController();
		expect(await c.newDocument({ width: 100, height: 100 })).toBe(true);
		expect(c.template?.fonts).toEqual([VEND_SANS]);
	});
});
