import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [viteReact()],
	resolve: { dedupe: ["react", "react-dom"] },
	test: { environment: "jsdom", globals: true },
});
