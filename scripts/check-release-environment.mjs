import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function checkReleaseRef(env, head) {
	// Dry runs may validate an existing tag from another workflow ref.
	if (env.DRY_RUN === "true") return;
	if (!env.RELEASE_TAG || env.GITHUB_REF !== `refs/tags/${env.RELEASE_TAG}`) {
		throw new Error(
			"For publication, select the release tag as the workflow ref and use the same tag input",
		);
	}
	if (!env.GITHUB_SHA || head !== env.GITHUB_SHA) {
		throw new Error(
			"The checked-out release commit must match GITHUB_SHA for accurate npm provenance",
		);
	}
}

export function checkNpmVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	const [major, minor, patch] = match ? match.slice(1).map(Number) : [];
	if (
		!match ||
		major < 11 ||
		(major === 11 && (minor < 5 || (minor === 5 && patch < 1)))
	) {
		throw new Error(
			`Trusted publishing requires npm 11.5.1 or later; found ${version}`,
		);
	}
}

function output(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (result.status !== 0)
		throw new Error(
			result.error?.message || result.stderr || `${command} failed`,
		);
	return result.stdout.trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === "--ref") {
		checkReleaseRef(process.env, output("git", ["rev-parse", "HEAD"]));
	} else if (process.argv[2] === "--npm") {
		const version = output("npm", ["--version"]);
		checkNpmVersion(version);
		console.log(`Trusted publishing CLI: npm ${version}`);
	} else {
		throw new Error("Specify --ref or --npm");
	}
}
