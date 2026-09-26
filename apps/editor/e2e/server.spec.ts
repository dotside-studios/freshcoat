import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { state } from "./helpers";

// The Railway image is `dist/` plus `server.ts`, and Bun serves it with no
// framework: every route must load from a cold start through its fallback.
test.describe("the production server", () => {
	test.describe.configure({ mode: "serial" });

	let dir = "";
	let server: ChildProcess | undefined;
	let origin = "";

	test.beforeAll(async () => {
		test.setTimeout(180_000);
		dir = mkdtempSync(join(tmpdir(), "freshcoat-server-"));
		execFileSync(
			"bunx",
			["vite", "build", "--outDir", join(dir, "dist"), "--emptyOutDir"],
			{ cwd: join(import.meta.dirname, ".."), stdio: "pipe" },
		);
		copyFileSync(
			join(import.meta.dirname, "..", "server.ts"),
			join(dir, "server.ts"),
		);
		const child = spawn("bun", [join(dir, "server.ts")], {
			env: { ...process.env, PORT: "0" },
			stdio: ["ignore", "pipe", "inherit"],
		});
		server = child;
		origin = await new Promise<string>((resolve, reject) => {
			let out = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				out += chunk.toString();
				const m = out.match(/http:\/\/localhost:\d+/);
				if (m) resolve(m[0]);
			});
			child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
		});
	});

	test.afterAll(() => {
		server?.kill();
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	test("/data?… loads directly and opens in Data", async ({ page }) => {
		const failed: string[] = [];
		page.on("response", (r) => {
			if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
		});
		await page.goto(`${origin}/data?theme=dark&record=r_gone`);
		await page.getByTestId("sample-membership-card").click();
		await expect(page.getByTestId("section-data")).toBeVisible();
		expect(await state<string>(page, "s.section")).toBe("data");
		await expect
			.poll(() => page.evaluate(() => `${location.pathname}${location.search}`))
			.toBe("/data?theme=dark");
		await page.getByTestId("section-switcher").getByText("Edit").click();
		await expect(page.getByTestId("artboard-canvas")).toBeAttached();
		expect(failed).toEqual([]);
	});

	test("/kit, /bench and a legacy link load directly", async ({ page }) => {
		await page.goto(`${origin}/kit`);
		await expect(page.getByRole("heading").first()).toBeVisible();
		await page.goto(`${origin}/?bench&sample=minimal&frames=5`);
		await expect
			.poll(() => page.evaluate(() => `${location.pathname}${location.search}`))
			.toBe("/bench?sample=minimal&frames=5");
		await expect(page.getByTestId("bench-panel")).toBeVisible();
		await page.goto(`${origin}/#section=export`);
		await expect
			.poll(() => page.evaluate(() => location.pathname))
			.toBe("/export");
	});
});
