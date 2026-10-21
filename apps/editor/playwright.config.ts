import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const port = Number(process.env.FRESHCOAT_PORT ?? 3010);
// FRESHCOAT_PREVIEW=1 serves the production build, which is what the bench
// should measure: React's development build costs several times as much.
const preview = !!process.env.FRESHCOAT_PREVIEW;

const BENCH = /bench\.spec\.ts$/;
// FRESHCOAT_SMOKE=1 narrows desktop to the subset e2e:smoke runs, so one
// server serves it and the cross-browser projects.
const SMOKE = [
	"smoke",
	"inspector",
	"workspace",
	"data",
	"export",
	"starters",
	"barcode",
	"sheets",
	"url",
	"handoff",
].map((name) => `${name}.spec.ts`);
const chromium = {
	...devices["Desktop Chrome"],
	viewport: { width: 1440, height: 900 },
	launchOptions: {
		...(executablePath ? { executablePath } : {}),
		args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
	},
};

export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	expect: { timeout: 15_000 },
	fullyParallel: true,
	// CI keeps an HTML report beside the traces, for the artifact a failed run
	// uploads.
	reporter: process.env.CI
		? [["list"], ["html", { open: "never" }]]
		: [["list"]],
	use: {
		baseURL: `http://localhost:${port}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "desktop",
			...(process.env.FRESHCOAT_SMOKE ? { testMatch: SMOKE } : {}),
			testIgnore: BENCH,
			use: chromium,
		},
		// Timings for e2e:bench: slow and machine-bound, so not in desktop.
		{
			name: "bench",
			testMatch: BENCH,
			use: chromium,
		},
		{
			name: "firefox",
			grep: /@smoke/,
			use: {
				...devices["Desktop Firefox"],
				viewport: { width: 1440, height: 900 },
			},
		},
		{
			name: "webkit",
			grep: /@smoke/,
			use: {
				...devices["Desktop Safari"],
				viewport: { width: 1440, height: 900 },
			},
		},
	],
	webServer: {
		command: preview
			? `bunx vite build --mode e2e && bunx vite preview --port ${port} --strictPort`
			: `bunx vite dev --port ${port} --strictPort`,
		port,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
