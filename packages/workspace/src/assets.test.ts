import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { AssetFile } from "./assets";
import {
	addAssets,
	addPreparedAssets,
	assetForRef,
	assetRef,
	filesFromZip,
	findAssetByName,
	imageContentType,
	isHiddenPath,
	parseAssetRef,
	photoDataset,
	prepareAssets,
	sha256Hex,
} from "./assets";
import { jpegHeader } from "./image-fixtures";
import {
	backPng,
	backSha,
	deepFreeze,
	members,
	photoPng,
	photoSha,
} from "./test-fixtures";
import type { Dataset } from "./types";

const file = (name: string, bytes: Uint8Array, type = ""): AssetFile => ({
	name,
	blob: new Blob([bytes as BlobPart], { type }),
});

async function bytesOf(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

describe("asset references", () => {
	it("round-trips ws: refs", () => {
		expect(assetRef("abc")).toBe("ws:abc");
		expect(parseAssetRef("ws:abc")).toBe("abc");
		expect(parseAssetRef("ws:")).toBeNull();
		expect(parseAssetRef("https://x")).toBeNull();
		expect(parseAssetRef(3)).toBeNull();
		expect(assetForRef(members, `ws:${photoSha}`)?.name).toBe("ana.png");
		expect(assetForRef(members, "ws:nope")).toBeUndefined();
	});

	it("hashes with sha256", async () => {
		expect(await sha256Hex(backPng)).toBe(backSha);
		expect(await sha256Hex(new Blob([backPng]))).toBe(backSha);
	});

	it("sniffs image types, falling back to the extension", () => {
		expect(imageContentType("x.bin", photoPng)).toBe("image/png");
		expect(imageContentType("x.JPG", new Uint8Array([0xff, 0xd8, 0xff]))).toBe(
			"image/jpeg",
		);
		expect(imageContentType("x.webp")).toBe("image/webp");
		expect(imageContentType("x.txt")).toBe("application/octet-stream");
	});

	it("finds an asset by name with or without extension", () => {
		expect(findAssetByName(members.assets, "photos/ANA.png")?.sha256).toBe(
			photoSha,
		);
		expect(findAssetByName(members.assets, "ana")?.sha256).toBe(photoSha);
		expect(findAssetByName(members.assets, "an")).toBeUndefined();
		expect(findAssetByName(members.assets, " ")).toBeUndefined();
	});
});

describe("addAssets", () => {
	const dataset: Dataset = deepFreeze({
		...members,
		assets: [],
		records: [
			{
				id: "r_1",
				status: "pending",
				values: { photo: "Ben.JPG", name: "Ben" },
			},
			{ id: "r_2", status: "pending", values: { photo: "ben" } },
			{ id: "r_3", status: "pending", values: { photo: "https://x/y.png" } },
			{
				id: "r_4",
				status: "pending",
				values: { photo: "cy.png", name: "cy.png" },
			},
		],
	} as Dataset);

	it("adds files by hash and rewrites the image cells that name them", async () => {
		const files = [
			file("ben.jpg", backPng),
			file("folder/ghost.png", photoPng),
			file("copy.png", backPng),
		];
		const result = await addAssets(dataset, files);
		expect(result.added).toBe(2);
		expect(result.rewritten).toBe(2);
		expect(result.appended).toBe(0);
		expect(result.unmatched).toEqual(["ghost.png"]);
		expect(result.dataset.assets).toEqual([
			{
				sha256: backSha,
				contentType: "image/png",
				name: "ben.jpg",
				size: backPng.length,
				width: 4,
				height: 4,
				blob: files[0]?.blob,
			},
			{
				sha256: photoSha,
				contentType: "image/png",
				name: "ghost.png",
				size: photoPng.length,
				width: 2,
				height: 2,
				blob: files[1]?.blob,
			},
		]);
		expect(result.dataset.assets[0]?.blob).toBe(files[0]?.blob);
		expect(result.dataset.records.map((r) => r.values.photo)).toEqual([
			`ws:${backSha}`,
			`ws:${backSha}`,
			"https://x/y.png",
			"cy.png",
		]);
		expect(result.dataset.records[2]).toBe(dataset.records[2]);
		expect(result.dataset.records[3]?.values.name).toBe("cy.png");
	});

	it("does not add bytes it already holds", async () => {
		const first = await addAssets(dataset, [file("ben.png", backPng)]);
		const again = await addAssets(first.dataset, [file("cy.png", backPng)]);
		expect(again.added).toBe(0);
		expect(again.dataset.assets).toHaveLength(1);
		expect(again.rewritten).toBe(1);
	});

	it("reads the images out of a zip, counting what it skipped", async () => {
		const zip = zipSync({
			"photos/ben.png": photoPng,
			"photos/": new Uint8Array(),
			"__MACOSX/photos/._ben.png": photoPng,
			".DS_Store": new Uint8Array([0]),
			"photos/.hidden/x.png": photoPng,
			"notes.txt": new TextEncoder().encode("hi"),
		});
		const { files, skipped } = await filesFromZip(new Blob([zip]));
		expect(skipped).toBe(4);
		expect(files.map((f) => [f.name, f.contentType, f.blob.type])).toEqual([
			["ben.png", "image/png", "image/png"],
		]);
		expect(await bytesOf(files[0]?.blob as Blob)).toEqual(photoPng);
	});

	it("knows hidden paths", () => {
		expect(isHiddenPath(".DS_Store")).toBe(true);
		expect(isHiddenPath("a/.git/x.png")).toBe(true);
		expect(isHiddenPath("__MACOSX/a.png")).toBe(true);
		expect(isHiddenPath("Thumbs.db")).toBe(true);
		expect(isHiddenPath("trip/IMG_1.JPG")).toBe(false);
	});

	it("appends a record per unmatched photo when asked", async () => {
		const jpeg = jpegHeader({
			width: 60,
			height: 40,
			orientation: 6,
			dateTimeOriginal: "2024:05:01 13:22:10",
		});
		const columns = [
			...dataset.columns,
			{ key: "width", type: "integer" as const },
			{ key: "taken_at", type: "date" as const },
			{ key: "file_name", type: "text" as const },
		];
		const prepared = await prepareAssets([
			file("ben.jpg", backPng),
			file("new.jpg", jpeg),
			file("again.jpg", jpeg),
		]);
		const result = addPreparedAssets({ ...dataset, columns }, prepared, {
			appendUnmatched: { column: "photo" },
		});
		expect(result.rewritten).toBe(2);
		expect(result.appended).toBe(1);
		const added = result.dataset.records.at(-1);
		expect(added?.values).toMatchObject({
			photo: `ws:${prepared[1]?.asset.sha256}`,
			width: 40,
			taken_at: "2024-05-01",
			file_name: "new.jpg",
		});
		// Adding the same photos again appends nothing.
		const again = addPreparedAssets(result.dataset, prepared, {
			appendUnmatched: { column: "photo" },
		});
		expect(again.appended).toBe(0);
	});

	it("hashes a few files at a time and reports progress", async () => {
		const seen: number[] = [];
		const prepared = await prepareAssets(
			[
				file("a.png", photoPng),
				file("b.png", backPng),
				file("c.png", photoPng),
			],
			{ onProgress: (done) => seen.push(done) },
		);
		expect(prepared.map((p) => p.asset.name)).toEqual([
			"a.png",
			"b.png",
			"c.png",
		]);
		expect(seen).toEqual([1, 2, 3]);
	});
});

describe("photoDataset", () => {
	it("makes one record per photo with its name, size and day", async () => {
		const jpeg = jpegHeader({
			width: 60,
			height: 40,
			orientation: 8,
			dateTimeOriginal: "2023:12:31 23:59:59",
			littleEndian: true,
		});
		const prepared = await prepareAssets([
			file("trip/IMG_2.JPG", jpeg),
			file("b.png", backPng),
			file("copy.JPG", jpeg),
		]);
		const d = photoDataset("Trip", prepared, "d_trip");
		expect(d.columns.map((c) => [c.key, c.type])).toEqual([
			["photo", "image"],
			["file_name", "text"],
			["width", "integer"],
			["height", "integer"],
			["taken_at", "date"],
		]);
		expect(d.assets).toHaveLength(2);
		expect(d.records.map((r) => r.values)).toEqual([
			{
				photo: `ws:${prepared[0]?.asset.sha256}`,
				file_name: "IMG_2.JPG",
				width: 40,
				height: 60,
				taken_at: "2023-12-31",
			},
			{
				photo: `ws:${backSha}`,
				file_name: "b.png",
				width: 4,
				height: 4,
			},
		]);
		expect(d.assets[0]).toMatchObject({
			contentType: "image/jpeg",
			width: 60,
			height: 40,
			orientation: 8,
		});
	});
});
