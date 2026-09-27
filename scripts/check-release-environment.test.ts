import { describe, expect, test } from "bun:test";
import {
	checkNpmVersion,
	checkReleaseRef,
} from "./check-release-environment.mjs";

describe("release environment", () => {
	const env = {
		RELEASE_TAG: "v0.1.0",
		GITHUB_REF: "refs/tags/v0.1.0",
		GITHUB_SHA: "release-commit",
		DRY_RUN: "false",
	};

	test("accepts publication from the matching tag and commit", () => {
		expect(() => checkReleaseRef(env, "release-commit")).not.toThrow();
	});

	test("rejects publication dispatched from a branch or another tag", () => {
		for (const ref of ["refs/heads/master", "refs/tags/v0.2.0", ""]) {
			expect(() =>
				checkReleaseRef({ ...env, GITHUB_REF: ref }, "release-commit"),
			).toThrow("select the release tag");
		}
	});

	test("rejects mismatched or missing provenance commits", () => {
		expect(() => checkReleaseRef(env, "other-commit")).toThrow("GITHUB_SHA");
		expect(() =>
			checkReleaseRef({ ...env, GITHUB_SHA: "" }, "release-commit"),
		).toThrow("GITHUB_SHA");
	});

	test("rejects a missing release tag", () => {
		expect(() =>
			checkReleaseRef({ ...env, RELEASE_TAG: "" }, "release-commit"),
		).toThrow();
	});

	test("allows dry runs from another workflow ref", () => {
		expect(() =>
			checkReleaseRef(
				{ ...env, DRY_RUN: "true", GITHUB_REF: "refs/heads/master" },
				"other-commit",
			),
		).not.toThrow();
	});

	test("accepts supported stable npm versions", () => {
		for (const version of ["11.5.1", "11.5.2", "11.6.0", "12.0.0"]) {
			expect(() => checkNpmVersion(version)).not.toThrow();
		}
	});

	test("rejects old, malformed, and prerelease npm versions", () => {
		for (const version of [
			"10.9.9",
			"11.4.9",
			"11.5.0",
			"",
			"invalid",
			"11.5.1-beta.1",
		]) {
			expect(() => checkNpmVersion(version)).toThrow("npm 11.5.1 or later");
		}
	});
});
