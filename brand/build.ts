// Builds the Freshcoat brand files from the Figma exports in source/.
//
// Figma exports an angular gradient as a foreignObject holding a CSS
// conic-gradient, which favicons, <img> and GitHub do not render. This rebuilds
// it as thin SVG wedges clipped to the mark, then renders the PNGs in Chromium.
//
//   bun freshcoat/brand/build.ts          write everything
//   bun freshcoat/brand/build.ts --check  also diff the rebuilt mark against the original

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dir;
const PUBLIC = join(HERE, "../apps/editor/public");
const source = (name: string) => readFileSync(join(HERE, "source", name), "utf8");

const figmaMark = source("figma-mark.svg");
const figmaMarkBw = source("figma-mark-bw.svg");
const figmaStudioLogo = source("figma-studio-logo.svg");

const pick = (svg: string, re: RegExp) => {
	const match = svg.match(re);
	if (!match?.[1]) throw new Error(`source is missing ${re}`);
	return match[1];
};

const markPath = pick(figmaMark, /<clipPath id="a"><path d="([^"]+)"/);
const markBwPath = pick(figmaMarkBw, /<path fill="#000" d="([^"]+)"/);
const gradientTransform = pick(figmaMark, /<foreignObject[^>]* transform="([^"]+)"/);
const conic = pick(figmaMark, /conic-gradient\(([^)]+)\)/);
// The logo carries its own drawing of the mark, and "freshcoat" in black
// beside "studio" in grey.
const logoMarkPath = pick(figmaStudioLogo, /<clipPath id="a"><path d="([^"]+)"/);
const freshcoatTextPath = pick(figmaStudioLogo, /<path fill="#000" d="([^"]+)"/);
const studioTextPath = pick(figmaStudioLogo, /<path fill="#696969" d="([^"]+)"/);
// #696969 is black at this opacity over white, so a wordmark drawn in
// currentColor keeps the same contrast between the two words on any theme.
const STUDIO_OPACITY = 0.588;

// "from 90deg,#009ddc 0deg,#48b164 57.1154deg,..."
const [fromPart, ...stopParts] = conic.split(",");
const from = Number.parseFloat(fromPart.replace("from", ""));
const stops = stopParts.map((part) => {
	const [hex, deg] = part.trim().split(/\s+/);
	return {
		rgb: [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)),
		at: Number.parseFloat(deg),
	};
});

const colorAt = (deg: number) => {
	let i = 0;
	while (i < stops.length - 2 && stops[i + 1].at <= deg) i++;
	const a = stops[i];
	const b = stops[i + 1];
	const t = (deg - a.at) / (b.at - a.at);
	const rgb = a.rgb.map((v, k) => Math.round(v + (b.rgb[k] - v) * t));
	return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const WEDGES = 240;
const RADIUS = 1100;
// Each wedge reaches across the whole of the next one, so the background never
// shows through an antialiased seam where the wedges converge.
const OVERLAP = 360 / WEDGES;

const point = (deg: number) => {
	// CSS conic angles run clockwise from the top, with y pointing down.
	const rad = ((from + deg) * Math.PI) / 180;
	return `${(RADIUS * Math.sin(rad)).toFixed(1)} ${(-RADIUS * Math.cos(rad)).toFixed(1)}`;
};

const wedges = Array.from({ length: WEDGES }, (_, i) => {
	const start = (i * 360) / WEDGES;
	const end = ((i + 1) * 360) / WEDGES;
	return `<path fill="${colorAt((start + end) / 2)}" d="M0 0L${point(start)}L${point(end + OVERLAP)}z"/>`;
}).join("");

const gradient = `<g transform="${gradientTransform}">${wedges}</g>`;

const markBody = (id: string, path = markPath) =>
	`<defs><clipPath id="${id}"><path d="${path}"/></clipPath></defs><g clip-path="url(#${id})">${gradient}</g>`;

const studioLogo = (text: string) =>
	svg(
		"0 0 1000 120",
		`${markBody("fc-logo", logoMarkPath)}<path fill="${text}" d="${freshcoatTextPath}"/><path fill="${text}" fill-opacity="${STUDIO_OPACITY}" d="${studioTextPath}"/>`,
	);

// The core Freshcoat lockup omits the Studio qualifier. It is the repository
// mark and works on a light background such as GitHub's README renderer.
const freshcoatLogo = (text: string) =>
	svg(
		"0 0 668 120",
		`${markBody("fc-logo", logoMarkPath)}<path fill="${text}" d="${freshcoatTextPath}"/>`,
	);

const svg = (viewBox: string, body: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>\n`;

const files: Record<string, string> = {
	"freshcoat-mark.svg": svg("0 0 138 120", markBody("fc-mark")),
	"freshcoat-mark-mono.svg": svg("0 0 138 120", `<path fill="currentColor" d="${markBwPath}"/>`),
	"freshcoat-studio-logo.svg": studioLogo("#000"),
	"freshcoat-studio-logo-dark.svg": studioLogo("#fff"),
	"freshcoat-logo.svg": freshcoatLogo("#000"),
	"freshcoat-studio-wordmark.svg": svg(
		"169 0 831 120",
		`<path fill="currentColor" d="${freshcoatTextPath}"/><path fill="currentColor" fill-opacity="${STUDIO_OPACITY}" d="${studioTextPath}"/>`,
	),
};

for (const [name, content] of Object.entries(files)) writeFileSync(join(HERE, name), content);
writeFileSync(join(PUBLIC, "favicon.svg"), files["freshcoat-mark.svg"]);
writeFileSync(
	join(HERE, "../apps/editor/src/app/logo-paths.ts"),
	`// Generated by brand/build.ts from source/figma-studio-logo.svg.
export const FRESHCOAT_TEXT_PATH =
	"${freshcoatTextPath}";
export const STUDIO_TEXT_PATH =
	"${studioTextPath}";
export const STUDIO_OPACITY = ${STUDIO_OPACITY};
`,
);
writeFileSync(join(PUBLIC, "freshcoat-mark-mono.svg"), files["freshcoat-mark-mono.svg"]);

const { chromium } = createRequire(join(HERE, "../apps/editor/package.json"))("@playwright/test");
const browser = await chromium.launch({
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const page = await browser.newPage();

const render = async (markup: string, width: number, height: number, background = "transparent") => {
	await page.setViewportSize({ width, height });
	await page.setContent(
		`<style>html,body{margin:0;background:${background}}img{display:block;width:100%;height:100%;object-fit:contain}</style><img src="data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}">`,
	);
	await page.waitForFunction(() => document.querySelector("img")?.complete);
	return page.screenshot({ omitBackground: background === "transparent" });
};

// A square icon with the mark inset, for launchers that crop to a circle or rounded square.
const icon = (inset: number) =>
	svg(
		"0 0 138 138",
		`<rect width="138" height="138" fill="#fff"/><g transform="translate(${inset} ${inset + (9 * (138 - inset * 2)) / 138}) scale(${(138 - inset * 2) / 138})">${markBody("fc-icon")}</g>`,
	);

mkdirSync(join(HERE, "png"), { recursive: true });
const pngs: [string, Buffer][] = [
	["png/freshcoat-mark-512.png", await render(files["freshcoat-mark.svg"], 512, 512)],
	["png/freshcoat-studio-logo-2000.png", await render(files["freshcoat-studio-logo.svg"], 2000, 240)],
	[
		"png/freshcoat-studio-logo-dark-2000.png",
		await render(files["freshcoat-studio-logo-dark.svg"], 2000, 240),
	],
	["png/freshcoat-icon-512.png", await render(icon(22), 512, 512)],
];
for (const [name, png] of pngs) writeFileSync(join(HERE, name), png);
writeFileSync(join(PUBLIC, "apple-touch-icon.png"), await render(icon(22), 180, 180));

if (process.argv.includes("--check")) {
	const W = 690;
	const H = 600;
	// Chromium ignores the clip on Figma's foreignObject, so compare the gradient
	// fields themselves, unclipped, which also covers every angle of the sweep.
	const shot = async (markup: string) => {
		await page.setViewportSize({ width: W, height: H });
		await page.setContent(
			`<style>html,body{margin:0;background:#fff}svg{display:block;width:${W}px;height:${H}px}</style>${markup}`,
		);
		return page.screenshot();
	};
	const original = await shot(figmaMark.replace(' clip-path="url(#a)"', ""));
	const rebuilt = await shot(svg("0 0 138 120", gradient));
	const diff = await page.evaluate(
		async ([a, b]) => {
			const load = async (b64: string) => {
				const img = new Image();
				img.src = `data:image/png;base64,${b64}`;
				await img.decode();
				const c = document.createElement("canvas");
				c.width = img.width;
				c.height = img.height;
				const ctx = c.getContext("2d");
				if (!ctx) throw new Error("no 2d context");
				ctx.drawImage(img, 0, 0);
				return ctx.getImageData(0, 0, c.width, c.height).data;
			};
			const [pa, pb] = await Promise.all([load(a), load(b)]);
			let max = 0;
			let sum = 0;
			let over8 = 0;
			for (let i = 0; i < pa.length; i += 4) {
				const d = Math.max(
					Math.abs(pa[i] - pb[i]),
					Math.abs(pa[i + 1] - pb[i + 1]),
					Math.abs(pa[i + 2] - pb[i + 2]),
				);
				max = Math.max(max, d);
				sum += d;
				if (d > 8) over8++;
			}
			return { max, mean: sum / (pa.length / 4), over8 };
		},
		[original.toString("base64"), rebuilt.toString("base64")],
	);
	writeFileSync(join(tmpdir(), "freshcoat-mark-original.png"), original);
	writeFileSync(join(tmpdir(), "freshcoat-mark-rebuilt.png"), rebuilt);
	console.log("pixel diff", diff);
}

await browser.close();
