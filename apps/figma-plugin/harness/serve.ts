// Serves the harness: a page standing in for Figma's main thread, and the
// plugin's built UI in an iframe beneath it, as Figma hosts it.
//
//   bun run build && bun harness/serve.ts [port]
//   open http://localhost:5803/?state=export&theme=dark&w=320&h=480
//
// The UI is the build output (`build/ui.js`), not the source, so what the
// harness shows is what Figma would load.

import { join } from "node:path";

const root = join(import.meta.dir, "..");
const port = Number(process.argv[2] ?? process.env.HARNESS_PORT ?? 5803);

const built = await Bun.build({
	entrypoints: [join(import.meta.dir, "fake-main.ts")],
	target: "browser",
	tsconfig: join(root, "tsconfig.json"),
});
if (!built.success) {
	for (const log of built.logs) console.error(log);
	process.exit(1);
}
const fakeMain = await built.outputs[0].text();

const HOST = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Freshcoat for Figma harness</title>
<link rel="stylesheet" href="/theme.css">
<style>
	html, body { margin: 0; background: var(--figma-color-bg-secondary, #eee); }
	body { padding: 0; }
</style>
</head>
<body>
<script type="module" src="/fake-main.js"></script>
</body>
</html>`;

// What create-figma-plugin's showUI hands Figma: the mount point, the two
// globals the bundle reads, then the bundle itself. Figma supplies the theme's
// color variables; here theme.css, the UI kit's copy of them, does, scoped
// under the figma-light or figma-dark class on the body.
const UI = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/theme.css">
</head>
<body>
<div id="create-figma-plugin"></div>
<script>
	document.body.classList.add(
		new URLSearchParams(location.search).get("theme") === "dark" ? "figma-dark" : "figma-light",
	);
	document.body.classList.add("theme-figma");
	const __FIGMA_COMMAND__ = "";
	const __SHOW_UI_DATA__ = {};
</script>
<script src="/ui.js"></script>
</body>
</html>`;

const themeCss = Bun.file(
	join(root, "node_modules/@create-figma-plugin/ui/lib/css/theme.css"),
);

const server = Bun.serve({
	port,
	fetch(req) {
		const { pathname } = new URL(req.url);
		const html = { "content-type": "text/html; charset=utf-8" };
		if (pathname === "/") return new Response(HOST, { headers: html });
		if (pathname === "/ui.html") return new Response(UI, { headers: html });
		if (pathname === "/fake-main.js")
			return new Response(fakeMain, {
				headers: { "content-type": "text/javascript" },
			});
		if (pathname === "/ui.js")
			return new Response(Bun.file(join(root, "build/ui.js")), {
				headers: { "content-type": "text/javascript" },
			});
		if (pathname === "/theme.css") return new Response(themeCss);
		return new Response("Not found", { status: 404 });
	},
});

console.log(`Harness on http://localhost:${server.port}/`);
