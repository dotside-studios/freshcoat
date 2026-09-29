import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { mod, run, settle, state } from "./helpers";

// FRESHCOAT_SHOTS=<dir> also saves a picture of each state for review.
const SHOTS = process.env.FRESHCOAT_SHOTS;
async function shot(page: Page, name: string, painted = true) {
	if (!SHOTS) return;
	if (painted) await settle(page);
	await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

// The browser here has no route to Google Fonts, so text in the Davi card's
// families would not paint. For pictures, those requests are answered through
// curl, which does.
test.beforeEach(async ({ page }) => {
	if (!SHOTS) return;
	await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
		const req = route.request();
		try {
			const body = execFileSync(
				"curl",
				["-sSfL", "-A", req.headers()["user-agent"] ?? "", req.url()],
				{ maxBuffer: 32 << 20 },
			);
			await route.fulfill({
				body,
				headers: { "access-control-allow-origin": "*" },
				contentType: req.url().includes("googleapis")
					? "text/css"
					: "font/woff2",
			});
		} catch {
			await route.abort();
		}
	});
});

async function openStarter(page: Page, id: string) {
	await page.goto("/");
	await page.getByTestId(`starter-${id}`).click();
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
}

/** Width and height from a PNG's IHDR. */
function pngSize(bytes: Buffer): [number, number] {
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

async function exportPng(page: Page): Promise<[number, number]> {
	const pending = page.waitForEvent("download");
	await run(page, "void c.exportPng(1)");
	const download = await pending;
	const path = await download.path();
	const { readFileSync } = await import("node:fs");
	return pngSize(readFileSync(path));
}

/** A generated photo, so the picture has something to sit on. */
async function setGeneratedPhoto(page: Page) {
	await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 800;
		canvas.height = 600;
		const g = canvas.getContext("2d") as CanvasRenderingContext2D;
		const sky = g.createLinearGradient(0, 0, 0, 600);
		sky.addColorStop(0, "#f6b26b");
		sky.addColorStop(0.55, "#e06666");
		sky.addColorStop(1, "#3d2b56");
		g.fillStyle = sky;
		g.fillRect(0, 0, 800, 600);
		g.fillStyle = "#1c1530";
		g.beginPath();
		g.moveTo(0, 470);
		g.lineTo(220, 330);
		g.lineTo(420, 450);
		g.lineTo(610, 300);
		g.lineTo(800, 430);
		g.lineTo(800, 600);
		g.lineTo(0, 600);
		g.fill();
		const c = (
			window as unknown as {
				__freshcoat: {
					controller: { dispatch(a: unknown): void };
				};
			}
		).__freshcoat.controller;
		c.dispatch({
			type: "setValue",
			field: "photo",
			value: canvas.toDataURL("image/jpeg", 0.9),
		});
	});
	await settle(page);
}

test("the welcome screen offers the starters ahead of the samples", async ({
	page,
}) => {
	await page.goto("/");
	const start = page.getByRole("region", { name: "Start from" });
	await expect(start).toBeVisible();
	for (const id of [
		"davi-card",
		"davi-card-portrait",
		"photo-watermark",
		"event-badge",
	])
		await expect(start.getByTestId(`starter-${id}`)).toBeVisible();
	const startTop = (await start.boundingBox())?.y ?? 0;
	const sampleTop =
		(await page.getByTestId("sample-membership-card").boundingBox())?.y ?? 0;
	expect(startTop).toBeLessThan(sampleTop);
	await shot(page, "welcome", false);
});

test("?starter=davi-card opens the Davi card with print guides, and the parameter goes", async ({
	page,
}) => {
	await page.goto("/?starter=davi-card");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await settle(page);
	expect(await state<string>(page, "t.id")).toBe("davi-card");
	expect(await state<number[]>(page, "[t.width, t.height]")).toEqual([
		1012, 638,
	]);
	await expect.poll(() => page.evaluate(() => location.search)).toBe("");

	const guides = page.getByTestId("print-guides");
	await expect(guides).toBeVisible();
	expect(Number(await guides.getAttribute("data-safe"))).toBeCloseTo(35.47, 1);
	expect(Number(await guides.getAttribute("data-corner"))).toBeCloseTo(37.6, 1);
	await shot(page, "davi-card-front");

	// View > Print guides turns them off, and back on.
	await page.getByRole("button", { name: "View" }).click();
	await page.getByRole("menuitem", { name: "Print guides" }).click();
	await expect(guides).toHaveCount(0);
	await page.getByRole("button", { name: "View" }).click();
	await page.getByRole("menuitem", { name: "Print guides" }).click();
	await expect(page.getByTestId("print-guides")).toBeVisible();

	await run(page, `c.dispatch({ type: "setSide", side: 1 })`);
	await shot(page, "davi-card-back");
});

test("the Davi card's QR encodes card_url, and the guides stay out of exports", async ({
	page,
}) => {
	await openStarter(page, "davi-card");
	const qr = await state<{ type: string; properties: { value: string } }>(
		page,
		"t.template_data[1].elements.find((e) => e.id === 'qr_tile').properties.children[0]",
	);
	expect(qr.type).toBe("qr_code");
	expect(qr.properties.value).toBe("{{card_url}}");

	await run(page, `c.dispatch({ type: "setSide", side: 1 })`);
	const snapshot = () =>
		page.evaluate(async () => {
			const f = (
				window as unknown as {
					__freshcoat: { snapshot(): Promise<HTMLCanvasElement> };
				}
			).__freshcoat;
			return (await f.snapshot()).toDataURL();
		});
	const before = await snapshot();
	await run(
		page,
		`c.dispatch({ type: "setValue", field: "card_url", value: "https://davi.social/c/ABCD1234" })`,
	);
	const after = await snapshot();
	expect(after).not.toBe(before);

	// The snapshot is the painted side alone: its corner is the card colour,
	// where the guides draw the pasteboard over it.
	const corner = await page.evaluate(async () => {
		const f = (
			window as unknown as {
				__freshcoat: { snapshot(): Promise<HTMLCanvasElement> };
			}
		).__freshcoat;
		const c = await f.snapshot();
		const ctx = c.getContext("2d") as CanvasRenderingContext2D;
		return Array.from(ctx.getImageData(1, 1, 1, 1).data);
	});
	expect(corner).toEqual([0x1d, 0x4e, 0xd8, 255]);

	expect(await exportPng(page)).toEqual([1012, 638]);
	await run(page, `c.dispatch({ type: "setSide", side: 0 })`);
	expect(await exportPng(page)).toEqual([1012, 638]);
});

test("the portrait card", async ({ page }) => {
	await openStarter(page, "davi-card-portrait");
	expect(await state<number[]>(page, "[t.width, t.height]")).toEqual([
		638, 1012,
	]);
	await expect(page.getByTestId("print-guides")).toBeVisible();
	await shot(page, "davi-card-portrait-front");
	await run(page, `c.dispatch({ type: "setSide", side: 1 })`);
	await shot(page, "davi-card-portrait-back");
});

test("a bleed and a safe area set in Design draw as guides", async ({
	page,
}) => {
	await openStarter(page, "davi-card");
	await expect(page.getByTestId("print-guides-bleed")).toHaveCount(0);
	const bleed = page.getByRole("spinbutton", { name: "Template bleed" });
	await bleed.fill("36");
	await bleed.press("Enter");
	const safe = page.getByRole("spinbutton", { name: "Template safe area" });
	await safe.fill("60");
	await safe.press("Enter");
	expect(await state<unknown[]>(page, "[t.bleed, t.safeArea]")).toEqual([
		36, 60,
	]);
	const guides = page.getByTestId("print-guides");
	await expect(page.getByTestId("print-guides-bleed")).toBeVisible();
	expect(Number(await guides.getAttribute("data-bleed"))).toBe(36);
	expect(Number(await guides.getAttribute("data-safe"))).toBe(60);
	const artboard = await page.getByTestId("artboard").boundingBox();
	const line = await page.getByTestId("print-guides-bleed").boundingBox();
	if (!artboard || !line) throw new Error("no boxes");
	expect(line.x).toBeLessThan(artboard.x);
	expect(line.width).toBeGreaterThan(artboard.width);
	await shot(page, "davi-card-bleed");
});

test("resizing the photo watermark with constraints keeps the mark in the corner", async ({
	page,
}) => {
	await openStarter(page, "photo-watermark");
	await expect(page.getByTestId("print-guides")).toHaveCount(0);
	await setGeneratedPhoto(page);
	await settle(page);
	await shot(page, "photo-watermark");
	await run(page, `c.select(["0/2"])`);
	await expect(page.getByTestId("constraints-diagram")).toHaveAttribute(
		"aria-label",
		"Pinned right, bottom",
	);
	await shot(page, "photo-watermark-constraints");
	// Nothing selected, so no handle sits over the mark in the pictures.
	await run(page, "c.select([])");

	const setup = page.getByTestId("template-setup");
	const resizeWithConstraints = async () => {
		await page.keyboard.press(`${mod}+Alt+Comma`);
		await setup
			.getByRole("checkbox", { name: "Resize with constraints" })
			.click({ force: true });
	};
	await resizeWithConstraints();
	const w = setup.getByRole("spinbutton", { name: "Template width" });
	await w.fill("1200");
	await w.press("Enter");
	const h = setup.getByRole("spinbutton", { name: "Template height" });
	await h.fill("1600");
	await h.press("Enter");
	await setup.getByRole("button", { name: "Done" }).click();
	await settle(page);

	expect(await state<number[]>(page, "[t.width, t.height]")).toEqual([
		1200, 1600,
	]);
	const box = await state<{
		pos: { x: number; y: number };
		size: { width: number; height: number };
	}>(page, "t.template_data[0].elements.find((e) => e.id === 'watermark')");
	expect(box.pos.x + box.size.width).toBe(1200 - 48);
	expect(box.pos.y + box.size.height).toBe(1600 - 48);
	const photo = await state<{ width: number; height: number }>(
		page,
		"t.template_data[0].elements.find((e) => e.id === 'photo').size",
	);
	expect(photo).toEqual({ width: 1200, height: 1600 });
	expect(await markRightMargin(page)).toBe(48);
	await run(page, "c.fitView()");
	await shot(page, "photo-watermark-portrait");

	// And back, the other way round.
	await resizeWithConstraints();
	await w.fill("1600");
	await w.press("Enter");
	await h.fill("1200");
	await h.press("Enter");
	await setup.getByRole("button", { name: "Done" }).click();
	await settle(page);
	expect(await state<number[]>(page, "[t.width, t.height]")).toEqual([
		1600, 1200,
	]);
	expect(await markRightMargin(page)).toBe(48);
});

/** The laid-out mark's distance from the right edge, from the last render. */
function markRightMargin(page: Page) {
	return state<number>(
		page,
		"t.width - (s.geometry.get('0/2').rect.x + s.geometry.get('0/2').rect.width)",
	);
}

test("a logo shows above the mark once the field is set", async ({ page }) => {
	await openStarter(page, "photo-watermark");
	expect(await state<string>(page, "s.values.logo")).toBe("");
	expect(await state<boolean>(page, "s.geometry.has('0/1')")).toBe(false);
	await setGeneratedPhoto(page);
	await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 400;
		canvas.height = 192;
		const g = canvas.getContext("2d") as CanvasRenderingContext2D;
		g.fillStyle = "#ffffff";
		g.beginPath();
		g.arc(304, 96, 80, 0, Math.PI * 2);
		g.fill();
		g.fillStyle = "#1f2328";
		g.font = "bold 88px sans-serif";
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.fillText("YS", 304, 100);
		const c = (
			window as unknown as {
				__freshcoat: { controller: { dispatch(a: unknown): void } };
			}
		).__freshcoat.controller;
		c.dispatch({
			type: "setValue",
			field: "logo",
			value: canvas.toDataURL("image/png"),
		});
	});
	await settle(page);
	const logo = await state<{ y: number; height: number }>(
		page,
		"s.geometry.get('0/1').rect",
	);
	const mark = await state<{ y: number }>(page, "s.geometry.get('0/2').rect");
	expect(logo.y + logo.height).toBeLessThan(mark.y);
	await shot(page, "photo-watermark-logo");
});

test("pictures in the dark theme", async ({ page }) => {
	test.skip(!SHOTS, "pictures only");
	await page.goto("/?theme=dark");
	await shot(page, "welcome-dark", false);
	await page.goto("/?theme=dark&starter=davi-card");
	await expect(page.getByTestId("artboard-canvas")).toBeAttached();
	await run(page, `c.dispatch({ type: "setRightTab", tab: "content" })`);
	await shot(page, "davi-card-front-dark");
});
