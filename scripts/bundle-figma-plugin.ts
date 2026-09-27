import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { artifactRoot, releaseVersion, root, run } from "./release-packages";

const version = releaseVersion(process.env.RELEASE_TAG);
const pluginRoot = join(root, "apps", "figma-plugin");
const manifestPath = join(pluginRoot, "manifest.json");
if (!existsSync(manifestPath))
	throw new Error("Build the Figma plugin before bundling");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const entry of [manifest.main, manifest.ui]) {
	if (
		typeof entry !== "string" ||
		isAbsolute(entry) ||
		!entry.startsWith("build/") ||
		relative(pluginRoot, resolve(pluginRoot, entry)).startsWith("..") ||
		!existsSync(join(pluginRoot, entry))
	) {
		throw new Error(`Missing or unsafe plugin entry: ${entry}`);
	}
}

const stage = join(root, "dist", "figma-plugin");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(artifactRoot, { recursive: true });
cpSync(manifestPath, join(stage, "manifest.json"));
cpSync(join(pluginRoot, "build"), join(stage, "build"), { recursive: true });
cpSync(join(pluginRoot, "README.md"), join(stage, "README.md"));
for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"])
	cpSync(join(root, file), join(stage, file));
const archive = join(artifactRoot, `freshcoat-figma-plugin-${version}.zip`);
rmSync(archive, { force: true });
run(
	[
		"zip",
		"-qr",
		archive,
		"manifest.json",
		"build",
		"README.md",
		"LICENSE",
		"NOTICE",
		"THIRD_PARTY_NOTICES.md",
	],
	stage,
);
console.log(`Bundled ${archive}`);
