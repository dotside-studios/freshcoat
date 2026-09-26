import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: { "~": resolve(__dirname, "src") },
		dedupe: ["@chenglou/pretext"],
	},
	test: { environment: "node" },
});
