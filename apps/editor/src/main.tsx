import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "~/app/App";
import { initTheme } from "~/app/theme";
import { getCanvasKit } from "~/render/canvaskit";
import "./styles.css";

initTheme();

// Compiles the preloaded wasm before a workspace opens and the viewport asks.
const warmCanvasKit = () => getCanvasKit().catch(() => {});
if ("requestIdleCallback" in window) requestIdleCallback(warmCanvasKit);
else setTimeout(warmCanvasKit, 1);

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
