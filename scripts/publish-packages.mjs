import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../dist/releases/", import.meta.url));
const artifacts = JSON.parse(readFileSync(join(directory, "packages.json"), "utf8"));
const tag = process.env.RELEASE_TAG;
const dryRun = process.argv.includes("--dry-run");
const expectedNames = ["freshcoat", "@freshcoat/for-print", "@freshcoat/coatfile"];
if (artifacts.length !== expectedNames.length) throw new Error("Unexpected release package count");

function npm(args) {
	return spawnSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Validate every artifact before the first package can be published.
for (const [index, artifact] of artifacts.entries()) {
	if (artifact.name !== expectedNames[index] || tag !== `v${artifact.version}` || basename(artifact.filename) !== artifact.filename || !artifact.filename.endsWith(".tgz")) {
		throw new Error("Release metadata does not match the tag or publication order");
	}
	const bytes = readFileSync(join(directory, artifact.filename));
	const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
	if (integrity !== artifact.integrity) throw new Error(`Integrity mismatch: ${artifact.filename}`);
}

for (const artifact of artifacts) {
	if (!dryRun) {
		const existing = npm(["view", `${artifact.name}@${artifact.version}`, "dist.integrity", "--json"]);
		if (existing.status === 0) {
			if (JSON.parse(existing.stdout) !== artifact.integrity) throw new Error(`${artifact.name}@${artifact.version} already exists with different contents`);
			console.log(`Already published: ${artifact.name}@${artifact.version}`);
			continue;
		}
		// Missing versions can be published; auth, network and other failures
		// must not be interpreted as a missing package.
		if (!existing.stderr.includes("E404")) throw new Error(existing.stderr);
	}
	const result = npm(["publish", join(directory, artifact.filename), "--access", "public", "--tag", artifact.version.includes("-") ? "next" : "latest", ...(dryRun ? ["--dry-run"] : [])]);
	if (result.status !== 0) throw new Error(result.stderr || result.stdout);
	console.log(result.stdout.trim());
}
