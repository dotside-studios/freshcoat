import { fileURLToPath } from "node:url";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { CANVASKIT_BASE } from "./canvaskit-assets";

export default defineConfig({
	define: { __CANVASKIT_BASE__: JSON.stringify(CANVASKIT_BASE) },
	resolve: {
		alias: [
			{
				find: /^~icons\/.+$/,
				replacement: fileURLToPath(
					new URL("./src/tests/icon-stub.tsx", import.meta.url),
				),
			},
			{
				find: "~",
				replacement: fileURLToPath(new URL("./src", import.meta.url)),
			},
		],
		dedupe: ["react", "react-dom"],
	},
	plugins: [viteReact()],
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["src/tests/render-count.ts", "src/tests/setup-locale.ts"],
	},
});
