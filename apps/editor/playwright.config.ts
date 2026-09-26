import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const port = Number(process.env.FRESHCOAT_PORT ?? 3010);
// FRESHCOAT_PREVIEW=1 serves the production build, which is what the bench
// should measure: React's development build costs several times as much.
const preview = !!process.env.FRESHCOAT_PREVIEW;

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
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1440, height: 900 },
				launchOptions: {
					...(executablePath ? { executablePath } : {}),
					args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
				},
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
