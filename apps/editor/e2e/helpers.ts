import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };

export async function settingsTab(page: Page, name: string) {
	await page.getByTestId("export-settings").getByRole("tab", { name }).click();
}

/** Opens a bundled sample from the welcome screen and waits for its first paint. */
export async function openSample(page: Page, id = "membership-card") {
	await page.goto("/");
	await page.getByTestId(`sample-${id}`).click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
}

/** Waits until nothing is waiting to render. */
export async function settle(page: Page) {
	await page.waitForFunction(() => {
		const f = (window as unknown as { __freshcoat?: { renderIdle?: unknown } })
			.__freshcoat;
		return typeof f?.renderIdle === "function";
	});
	await page.evaluate(async () => {
		const f = (
			window as unknown as {
				__freshcoat: { renderIdle(): Promise<void> };
			}
		).__freshcoat;
		await new Promise((r) => requestAnimationFrame(() => r(null)));
		await f.renderIdle();
	});
}

/** Reads a slice of editor state through the controller exposed for tests. */
export function state<T>(page: Page, pick: string): Promise<T> {
	return page.evaluate((expr) => {
		const c = (
			window as unknown as {
				__freshcoat: { controller: { state: unknown; template: unknown } };
			}
		).__freshcoat.controller;
		return new Function("s", "t", "c", `return (${expr});`)(
			c.state,
			c.template,
			c,
		);
	}, pick);
}

export async function run(page: Page, code: string) {
	await page.evaluate((src) => {
		const c = (window as unknown as { __freshcoat: { controller: unknown } })
			.__freshcoat.controller;
		return new Function("c", src)(c);
	}, code);
	await settle(page);
}

/** Screen position of a template-space point on the artboard. */
export async function artboardPoint(page: Page, x: number, y: number) {
	const box = (await page.getByTestId("artboard").boundingBox()) as Box;
	const width = await state<number>(page, "t.width");
	const s = box.width / width;
	return { x: box.x + x * s, y: box.y + y * s, scale: s };
}

/** Drags in template units, in small steps so each one previews. */
export async function dragTemplate(
	page: Page,
	from: { x: number; y: number },
	by: { x: number; y: number },
	opts: { steps?: number; modifiers?: string[] } = {},
) {
	const a = await artboardPoint(page, from.x, from.y);
	const steps = opts.steps ?? 12;
	for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++)
		await page.mouse.move(
			a.x + (by.x * a.scale * i) / steps,
			a.y + (by.y * a.scale * i) / steps,
		);
	await page.mouse.up();
	for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
	await settle(page);
}

/** RGBA of a pixel on the painted artboard, in template units. The live
 *  canvas is repainted and copied in the same task, while its WebGL drawing
 *  buffer is still readable. */
export async function pixel(page: Page, x: number, y: number) {
	return page.evaluate(
		async ([px, py]) => {
			const f = (
				window as unknown as {
					__freshcoat: {
						snapshot(): Promise<HTMLCanvasElement>;
						controller: { template: { width: number } };
					};
				}
			).__freshcoat;
			const c = await f.snapshot();
			const s = c.width / f.controller.template.width;
			const ctx = c.getContext("2d") as CanvasRenderingContext2D;
			return Array.from(
				ctx.getImageData(Math.round(px * s), Math.round(py * s), 1, 1).data,
			);
		},
		[x, y],
	);
}

/** Where the page imports an e2e probe from: its source on the dev server,
 *  or the module `vite build --mode e2e` emits for the production build. */
export function probePath(name: string): string {
	return process.env.FRESHCOAT_PREVIEW
		? `/e2e/probes/${name}.js`
		: `/e2e/probes/${name}.ts`;
}

// The Desktop Chrome project reports Windows through userAgentData, so the app
// takes Ctrl as its modifier whatever the host is, macOS included.
export const mod = "Control";

const STUB_FONT = readFileSync(
	join(
		import.meta.dirname,
		"../src/samples/fonts/VendSans-Variable-latin.woff2",
	),
);

/**
 * Google Fonts answered locally, so previews and the picked family load the
 * same way on any machine: every stylesheet names one face, and every face is
 * Vend Sans. Returns the stylesheet URLs asked for.
 */
export async function stubGoogleFonts(page: Page) {
	const css: string[] = [];
	await page.route(/fonts\.googleapis\.com\/css2/, async (route) => {
		const url = route.request().url();
		css.push(url);
		const family = new URL(url).searchParams.get("family")?.split(":")[0];
		await route.fulfill({
			contentType: "text/css",
			headers: { "access-control-allow-origin": "*" },
			body: `@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/stub/${encodeURIComponent(family ?? "x")}.woff2) format('woff2');
}`,
		});
	});
	await page.route(/fonts\.gstatic\.com/, (route) =>
		route.fulfill({
			contentType: "font/woff2",
			headers: { "access-control-allow-origin": "*" },
			body: STUB_FONT,
		}),
	);
	return css;
}
