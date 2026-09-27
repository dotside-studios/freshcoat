import { validate } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import { issueMessage, issuePathToKey, pathSegments } from "~/app/issue-path";
import { unwrap, updateElement } from "~/doc/ops";
import { googleFontUrls, verifyGoogleFont } from "~/panels/setup/google-font";
import { doc } from "./doc-fixture";

describe("issuePathToKey", () => {
	test("a top-level element and anything inside it", () => {
		expect(issuePathToKey("/template_data/0/elements/3")).toBe("0/3");
		expect(issuePathToKey("/template_data/0/elements/4/properties/value")).toBe(
			"0/4",
		);
		expect(issuePathToKey("/template_data/1/elements/0/visibleWhen/1")).toBe(
			"1/0",
		);
	});

	test("nested children and the mask source", () => {
		expect(
			issuePathToKey(
				"/template_data/0/elements/1/properties/children/2/properties/children/0/properties/value",
			),
		).toBe("0/1/2/0");
		expect(
			issuePathToKey(
				"/template_data/0/elements/2/properties/mask/properties/fill",
			),
		).toBe("0/2/-1");
		expect(
			issuePathToKey(
				"/template_data/0/elements/2/properties/mask/properties/children/1",
			),
		).toBe("0/2/-1/1");
		expect(
			issuePathToKey("/template_data/0/elements/2/properties/children/0/pos"),
		).toBe("0/2/0");
	});

	test("the background", () => {
		expect(issuePathToKey("/template_data/1/background/size")).toBe("1/bg");
	});

	test("dotted paths and zod path arrays", () => {
		expect(
			issuePathToKey("template_data.0.elements.1.properties.children.1"),
		).toBe("0/1/1");
		expect(
			issuePathToKey(["template_data", 0, "elements", 5, "rotation"]),
		).toBe("0/5");
		expect(pathSegments("/a~1b/c")).toEqual(["a/b", "c"]);
	});

	test("paths that are not layers", () => {
		expect(issuePathToKey("")).toBeNull();
		expect(issuePathToKey("/name")).toBeNull();
		expect(issuePathToKey("/fields/properties/x/default")).toBeNull();
		expect(issuePathToKey("/variants/0/overrides/0/name")).toBeNull();
		expect(issuePathToKey("/template_data/0/name")).toBeNull();
		expect(issuePathToKey("/template_data/0/elements")).toBeNull();
		expect(issuePathToKey("/template_data/x/elements/0")).toBeNull();
	});

	test("with a template, keys that do not resolve are null", () => {
		const t = doc();
		expect(issuePathToKey("/template_data/0/elements/99", t)).toBeNull();
		expect(
			issuePathToKey("/template_data/0/elements/0/properties/mask", t),
		).toBeNull();
		expect(
			issuePathToKey("/template_data/0/elements/2/properties/mask", t),
		).toBe("0/2/-1");
	});

	test("maps what validate() actually reports", () => {
		const broken = unwrap(
			updateElement(doc(), "0/1/1", { properties: { value: "{{nope}}" } }),
		).template;
		const result = validate(broken);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const issue = result.errors.find(
			(e) => e.code === "unknown_field_reference",
		);
		expect(issue?.path).toBe(
			"/template_data/0/elements/1/properties/children/1/properties/value",
		);
		expect(issuePathToKey(issue?.path ?? "", broken)).toBe("0/1/1");
	});
});

describe("issueMessage", () => {
	/** What the editor says for each error validate() reports on `t`. */
	function said(t: unknown): string[] {
		const result = validate(t);
		if (result.ok) throw new Error("expected errors");
		return result.errors.map((e) => issueMessage(e, t as never));
	}

	test("a text that uses a field that doesn't exist", () => {
		const broken = unwrap(
			updateElement(doc(), "0/1/1", { properties: { value: "{{nope}}" } }),
		).template;
		expect(said(broken)).toEqual(["Uses {{nope}}, which isn't a field"]);
	});

	test("two layers with one name", () => {
		const broken = doc();
		const els = broken.template_data[0]?.elements ?? [];
		if (els[1]) els[1].id = els[0]?.id ?? "";
		expect(said(broken)).toEqual(["Another layer is also named a"]);
	});

	test("a value of the wrong kind names what holds it", () => {
		const broken = doc() as unknown as {
			template_data: { elements: { opacity?: unknown }[] }[];
		};
		const el = broken.template_data[0]?.elements[0];
		if (el) el.opacity = "half";
		// A layer's schema is a union of its types, so the layer is what fails.
		expect(said(broken)).toEqual(["This layer isn't valid"]);
		const wide = { ...doc(), width: 0 };
		expect(said(wide)).toContain("Width must be a whole number above 0");
	});

	test("a variant that changes a side the template doesn't have", () => {
		const broken = doc();
		broken.variants = [
			{ id: "dark", label: "Dark", overrides: [{ name: "inside" }] },
		];
		expect(said(broken)).toEqual(["Dark changes inside, which isn't a side"]);
	});

	test("a code without copy keeps the coatfile's message", () => {
		expect(
			issueMessage({ path: "/x", code: "something_new", message: "As is" }),
		).toBe("As is");
	});

	test("an unknown key and a whole invalid layer", () => {
		expect(
			issueMessage({
				path: "/template_data/0/elements/2",
				code: "invalid_shape",
				message: 'Unrecognized key: "wobble"',
			}),
		).toBe("Unknown setting wobble");
		expect(
			issueMessage({
				path: "/template_data/0/elements/2",
				code: "invalid_shape",
				message: "Invalid input",
			}),
		).toBe("This layer isn't valid");
		expect(
			issueMessage({
				path: "/template_data/0/elements/2/properties/fontSize",
				code: "invalid_shape",
				message: "Invalid input: expected number, received string",
			}),
		).toBe("Font size isn't valid");
	});
});

describe("Google font check", () => {
	test("builds the css2 URLs, with weights first", () => {
		expect(googleFontUrls(" Open  Sans ")).toEqual([
			"https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap",
			"https://fonts.googleapis.com/css2?family=Open+Sans&display=swap",
		]);
	});

	test("falls back to the URL without weights", async () => {
		const seen: string[] = [];
		const fetcher = (async (url: string) => {
			seen.push(url);
			return url.includes("wght")
				? new Response("bad", { status: 400 })
				: new Response("@font-face { src: url(x) }");
		}) as unknown as typeof fetch;
		expect(await verifyGoogleFont("Pacifico", fetcher)).toBe(
			"https://fonts.googleapis.com/css2?family=Pacifico&display=swap",
		);
		expect(seen).toHaveLength(2);
	});

	test("reports failure when neither form serves a face", async () => {
		const fetcher = (async () => {
			throw new Error("offline");
		}) as unknown as typeof fetch;
		expect(await verifyGoogleFont("Nope", fetcher)).toBeNull();
	});
});
