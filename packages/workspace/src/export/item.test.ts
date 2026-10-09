import { fitDesignSize, MAX_EXPORT_DIMENSION } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { planExport } from "../plan";
import {
	memberCard,
	members,
	photoSha,
	preset,
	workspace,
} from "../test-fixtures";
import type { DatasetAsset, ExportPreset, Workspace } from "../types";
import {
	assetsByRef,
	imagesOf,
	itemRequest,
	itemSize,
	itemTemplate,
	type JobPool,
	type RenderRequest,
	runExportJob,
} from "./index";

const wide: DatasetAsset = {
	sha256: "wide",
	contentType: "image/jpeg",
	name: "wide.jpg",
	size: 1,
	width: 1601,
	height: 1067,
	blob: new Blob([]),
};

const capped: ExportPreset = {
	...preset,
	size: { kind: "image", field: "photo", maxEdge: 500 },
};

const item = { values: { photo: "ws:wide" }, side: "front" };
const assets = assetsByRef([wide]);

describe("imagesOf", () => {
	it("names each photo an item's values reference once", () => {
		const refs = assetsByRef(members.assets);
		const photo = `ws:${photoSha}`;
		expect(
			imagesOf({ values: { a: photo, b: photo, c: "Ana" } }, refs).map(
				([ref]) => ref,
			),
		).toEqual([photo]);
	});
});

describe("itemSize", () => {
	it("stays within the longest edge the render allows", () => {
		const big = itemSize(memberCard, { ...preset, scale: 100 }, item, assets);
		if ("error" in big) throw new Error(big.error);
		expect(Math.max(big.width, big.height)).toBe(MAX_EXPORT_DIMENSION);

		const huge = assetsByRef([{ ...wide, width: 16000, height: 10000 }]);
		const uncapped = { ...preset, size: { kind: "image", field: "photo" } };
		const photo = itemSize(memberCard, uncapped as ExportPreset, item, huge);
		if ("error" in photo) throw new Error(photo.error);
		expect([photo.width, photo.height]).toEqual([MAX_EXPORT_DIMENSION, 5120]);
	});
});

describe("itemTemplate", () => {
	it("lays the template out as the export does when maxEdge applies", () => {
		const size = itemSize(memberCard, capped, item, assets);
		if ("error" in size || !size.resize) throw new Error("no size");
		const built = itemRequest(memberCard, capped, item, assets);
		if ("error" in built) throw new Error(built.error);
		expect(built.request.resize).toEqual(size.resize);
		expect([size.width, size.height]).toEqual([500, 333]);

		const sized = itemTemplate(memberCard, capped, item, assets);
		expect([sized.width, sized.height]).toEqual([
			Math.round(size.resize.width),
			Math.round(size.resize.height),
		]);
		// The photo's own aspect, before the cap, lays it out a unit narrower.
		const uncapped = fitDesignSize(memberCard, 1601, 1067);
		expect(Math.round(uncapped.width)).not.toBe(sized.width);
	});

	it("is the template itself for a template-sized preset or a missing photo", () => {
		expect(itemTemplate(memberCard, preset, item, assets)).toBe(memberCard);
		expect(
			itemTemplate(
				memberCard,
				capped,
				{ values: { photo: "ws:gone" } },
				assets,
			),
		).toBe(memberCard);
	});
});

describe("itemRequest", () => {
	it("is the request runExportJob renders", async () => {
		const ws: Workspace = {
			...workspace,
			datasets: [{ ...members, assets: [...members.assets, wide] }],
		};
		const seen: RenderRequest[] = [];
		const pool: JobPool = {
			size: 1,
			async render(request) {
				seen.push(request);
				throw new Error("not rendered");
			},
			cancel() {},
		};
		const jpeg: ExportPreset = { ...preset, format: "jpeg-zip", quality: 70 };
		await runExportJob(ws, jpeg, { pool });
		const plan = planExport(ws, jpeg);
		const refs = assetsByRef(ws.datasets[0]?.assets);
		expect(seen).toEqual(
			plan.map((i) => {
				const built = itemRequest(memberCard, jpeg, i, refs);
				if ("error" in built) throw new Error(built.error);
				return built.request;
			}),
		);
		expect(seen[0]).toMatchObject({ format: "jpeg", quality: 70 });
	});
});
