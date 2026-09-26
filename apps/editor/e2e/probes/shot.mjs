// Scratch screenshot driver: node e2e/probes/shot.mjs <url-path> <out.png> [w h] [touch]
import { chromium } from "@playwright/test";
const [, , path, out, w = "1440", h = "900", touch] = process.argv;
const browser = await chromium.launch({
	executablePath: "/opt/pw-browsers/chromium",
	args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
	viewport: { width: Number(w), height: Number(h) },
	hasTouch: touch === "touch",
});
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e}`));
await page.goto(`http://localhost:3012${path}`);
await page.waitForTimeout(1500);
if (process.env.STEPS) {
	const steps = await import(process.env.STEPS);
	await steps.default(page);
}
await page.screenshot({ path: out });
console.log(logs.join("\n") || "no console errors");
await browser.close();
