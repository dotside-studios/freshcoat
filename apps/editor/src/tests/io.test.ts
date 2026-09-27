import {
	COAT_MEDIA_TYPE,
	LEGACY_TKIT_MEDIA_TYPE,
} from "@freshcoat-js/coatfile/coat";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import {
	exportFileName,
	openFile,
	saveCoat,
	saveFileName,
	saveJson,
} from "../doc/io";
import { removeElements, unwrap } from "../doc/ops";
import { deepFreeze, doc, frozenDoc, PNG_SHA } from "./doc-fixture";

describe("round trip", () => {
	test("saveCoat then openFile gives the same template", async () => {
		const t = frozenDoc();
		const saved = await saveCoat(t);
		if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
		expect(Array.from(saved.data.slice(0, 4))).toEqual([
			0x50, 0x4b, 0x03, 0x04,
		]);
		const opened = await openFile(saved.data, "doc.coat");
		if (opened.kind !== "ok") throw new Error(opened.kind);
		expect(opened.template).toEqual(t);
		expect(opened).toMatchObject({
			healed: [],
			newerFormat: false,
			misKeyedAssets: [],
		});
	});

	test("writes the .coat media type and still opens a .tkit package", async () => {
		const t = frozenDoc();
		const saved = await saveCoat(t);
		if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
		const entries = unzipSync(saved.data);
		expect(strFromU8(entries.mimetype as Uint8Array)).toBe(COAT_MEDIA_TYPE);
		entries.mimetype = strToU8(LEGACY_TKIT_MEDIA_TYPE);
		const opened = await openFile(zipSync(entries), "doc.tkit");
		expect(opened.kind === "ok" && opened.template).toEqual(t);
	});

	test("saveJson then openFile gives the same template", async () => {
		const t = frozenDoc();
		const saved = saveJson(t);
		if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
		const opened = await openFile(saved.data, "doc.coat.json");
		expect(opened.kind === "ok" && opened.template).toEqual(t);
		const bytes = await openFile(
			new TextEncoder().encode(saved.data),
			"doc.json",
		);
		expect(bytes.kind === "ok" && bytes.template).toEqual(t);
	});

	test("saving prunes unused assets", async () => {
		const t = unwrap(removeElements(frozenDoc(), ["0/2"])).template;
		const saved = await saveCoat(t);
		if (!saved.ok) throw new Error("save failed");
		const opened = await openFile(saved.data, "x.coat");
		expect(opened.kind === "ok" && opened.template.assets).toBeUndefined();
		const json = saveJson(t);
		expect(json.ok && JSON.parse(json.data).assets).toBeUndefined();
		const kept = saveJson(frozenDoc());
		expect(kept.ok && JSON.parse(kept.data).assets[0].sha256).toBe(PNG_SHA);
	});
});

describe("refusals", () => {
	test("an invalid template is not written", async () => {
		const bad = deepFreeze({ ...doc(), width: 0 });
		const coat = await saveCoat(bad);
		expect(coat.ok).toBe(false);
		expect(!coat.ok && coat.errors[0].code).toBe("invalid_dimension");
		const json = saveJson(bad);
		expect(!json.ok && json.errors[0].code).toBe("invalid_dimension");
	});

	test("a newer-format template is not written", async () => {
		const newer = { ...doc(), format_version: "1.99" };
		const r = await saveCoat(newer);
		expect(!r.ok && r.errors[0].code).toBe("newer_format_version");
	});
});

describe("openFile", () => {
	test("reports unreadable input", async () => {
		expect((await openFile("{nope", "x.json")).kind).toBe("unreadable");
		expect(
			(await openFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]), "x.coat"))
				.kind,
		).toBe("unreadable");
	});

	test("reports an invalid template", async () => {
		const r = await openFile(
			JSON.stringify({ ...doc(), template_data: [] }),
			"x.json",
		);
		expect(r.kind).toBe("invalid");
		expect(r.kind === "invalid" && r.errors.map((e) => e.code)).toContain(
			"empty_template_data",
		);
	});

	test("heals duplicate ids and says which", async () => {
		const t = doc();
		t.template_data[0].elements[1].id = "a";
		const r = await openFile(JSON.stringify(t), "x.json");
		expect(r.kind).toBe("ok");
		expect(r.kind === "ok" && r.healed).toEqual(["a_2"]);
	});

	test("flags a newer format and mis-keyed assets", async () => {
		const t = doc();
		const raw = {
			...t,
			format_version: "1.9",
			assets: [{ ...t.assets?.[0], sha256: "deadbeef" }],
		};
		const r = await openFile(JSON.stringify(raw), "x.json");
		expect(r.kind === "ok" && r.newerFormat).toBe(true);
		expect(r.kind === "ok" && r.misKeyedAssets).toEqual(["deadbeef"]);
	});
});

describe("names", () => {
	test("exportFileName", () => {
		expect(exportFileName("card", "front")).toBe("card-front.png");
		expect(exportFileName("card", "front", "midnight")).toBe(
			"card-front-midnight.png",
		);
		expect(exportFileName("card", "back", undefined, 2)).toBe(
			"card-back@2x.png",
		);
		expect(exportFileName("card", "back", "dark", 3)).toBe(
			"card-back-dark@3x.png",
		);
	});

	test("saveFileName", () => {
		expect(saveFileName(frozenDoc(), ".coat")).toBe("doc.coat");
		expect(saveFileName({ ...doc(), id: " my card! " }, ".coat.json")).toBe(
			"my-card.coat.json",
		);
	});
});
