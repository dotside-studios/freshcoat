import { defineConfig } from "@playwright/test";

const port = Number(process.env.HARNESS_PORT ?? 5803);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

// The harness tests and screenshots. The server builds nothing itself: run
// `bun run build` first, or use `bun run harness:test`, which does both.
export default defineConfig({
	testDir: "./tests",
	testMatch: "**/*.pw.ts",
	timeout: 30_000,
	fullyParallel: true,
	reporter: [["list"]],
	use: {
		baseURL: `http://localhost:${port}`,
		launchOptions: executablePath ? { executablePath } : {},
	},
	webServer: {
		command: `bun harness/serve.ts ${port}`,
		// The plugin's root, whose tsconfig resolves the `~/` imports.
		cwd: "..",
		port,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
