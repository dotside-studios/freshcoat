import { describe, expect, it, vi } from "vitest";
import type { FlattenMarker } from "~/lib/figma/transpiler/coalesce";
import {
	rasterElementId,
	rasterizeMarkers,
} from "~/lib/figma/transpiler/rasterize";

describe("rasterElementId", () => {
	it("keys a base node and its colorway-instance sublayer to the SAME id", () => {
		// Base card node vs the same node inside an instance (Figma's
		// `I<instanceId>;<baseNodeId>` form) — must align so the variant diff can
		// override the raster instead of seeing two different elements.
		expect(rasterElementId("flatten", "660:365")).toBe("flatten_660_365");
		expect(rasterElementId("flatten", "I660:1184;660:365")).toBe(
			"flatten_660_365",
		);
		expect(rasterElementId("image", "I1:2;3:4")).toBe("image_3_4");
	});
});

const fakeBlob = (n: number) =>
	new Blob([new Uint8Array([n])], { type: "image/png" });

describe("rasterizeMarkers", () => {
	it("renders each marker separately so they get distinct assets", async () => {
		const markers: FlattenMarker[] = [
			{
				nodeId: "1:1",
				pos: { x: 0, y: 0 },
				size: { width: 50, height: 50 },
				reason: "vector_flattened",
				rotation: 0,
			},
			{
				nodeId: "1:2",
				pos: { x: 60, y: 0 },
				size: { width: 50, height: 50 },
				reason: "effect_flattened",
				rotation: 0,
			},
		];
		const renderImage = vi.fn().mockImplementation(async (req) => ({
			blob: fakeBlob(1),
			sha256: req.nodeIds.join("-"),
		}));
		const result = await rasterizeMarkers({
			fileKey: "FILE",
			markers,
			scale: 2,
			renderImage,
		});
		// One call per marker, each with its own single node id...
		expect(renderImage).toHaveBeenCalledTimes(2);
		expect(renderImage).toHaveBeenNthCalledWith(1, {
			fileKey: "FILE",
			nodeIds: ["1:1"],
			scale: 2,
			format: "png",
		});
		expect(renderImage).toHaveBeenNthCalledWith(2, {
			fileKey: "FILE",
			nodeIds: ["1:2"],
			scale: 2,
			format: "png",
		});
		// ...so the two markers point at different assets, not a shared one.
		expect(result.elements[0]?.properties.src).toBe("asset:1:1");
		expect(result.elements[1]?.properties.src).toBe("asset:1:2");
		expect(result.assets.map((a) => a.sha256)).toEqual(["1:1", "1:2"]);
	});

	it("emits one ImageElement per marker, with assets staged", async () => {
		const markers: FlattenMarker[] = [
			{
				nodeId: "1:1",
				pos: { x: 10, y: 10 },
				size: { width: 50, height: 50 },
				reason: "vector_flattened",
				rotation: 0,
			},
		];
		const blob = fakeBlob(7);
		const renderImage = vi.fn().mockResolvedValue({ blob, sha256: "deadbeef" });
		const result = await rasterizeMarkers({
			fileKey: "FILE",
			markers,
			scale: 2,
			renderImage,
		});
		expect(result.elements).toEqual([
			{
				id: "flatten_1_1",
				type: "image",
				pos: { x: 10, y: 10 },
				size: { width: 50, height: 50 },
				properties: { src: "asset:deadbeef", fit: "fill" },
			},
		]);
		expect(result.assets).toEqual([
			{ sha256: "deadbeef", blob, contentType: "image/png" },
		]);
	});

	it("returns empty results when no markers", async () => {
		const renderImage = vi.fn();
		const result = await rasterizeMarkers({
			fileKey: "FILE",
			markers: [],
			scale: 2,
			renderImage,
		});
		expect(result).toEqual({
			elements: [],
			assets: [],
			skipped: [],
			empty: [],
		});
		expect(renderImage).not.toHaveBeenCalled();
	});

	it("skips a marker with no available raster instead of throwing", async () => {
		const markers: FlattenMarker[] = [
			{
				nodeId: "A",
				pos: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				reason: "vector_flattened",
				rotation: 0,
			},
			{
				nodeId: "B",
				pos: { x: 20, y: 0 },
				size: { width: 10, height: 10 },
				reason: "vector_flattened",
				rotation: 0,
			},
		];
		const renderImage = vi.fn().mockImplementation(async (req) => {
			if (req.nodeIds[0] === "A") throw new Error("no exported bytes for A");
			return { blob: fakeBlob(2), sha256: "sha-B" };
		});
		const result = await rasterizeMarkers({
			fileKey: "F",
			markers,
			scale: 2,
			renderImage,
		});
		expect(result.skipped).toEqual(["A"]);
		// One entry per marker, in order, so the caller can put each bitmap back
		// where its node was — the unrenderable marker holds a null.
		expect(result.elements).toEqual([
			null,
			expect.objectContaining({
				properties: { src: "asset:sha-B", fit: "fill" },
			}),
		]);
		expect(result.assets).toHaveLength(1);
	});
});

describe("rasterizeMarkers (empty exports)", () => {
	const marker = (nodeId: string): FlattenMarker => ({
		nodeId,
		pos: { x: 0, y: 0 },
		size: { width: 200, height: 120 },
		reason: "vector_flattened",
		rotation: 0,
	});

	it("drops a marker whose export came back as a 1x1 pixel", async () => {
		// Figma answers an export of a node that renders nothing with a 1x1
		// transparent pixel rather than an error. Emitting it stretches an empty
		// bitmap across the region the node claimed and ships the pixel as an
		// asset — a hole where the author expects a shape.
		const renderImage = vi.fn().mockResolvedValue({
			blob: fakeBlob(1),
			sha256: "EMPTY",
			width: 1,
			height: 1,
		});
		const result = await rasterizeMarkers({
			fileKey: "F",
			markers: [marker("1:1")],
			scale: 3,
			renderImage,
		});
		expect(result.empty).toEqual(["1:1"]);
		expect(result.elements).toEqual([null]);
		expect(result.assets).toEqual([]);
	});

	it("keeps a marker whose export has content", async () => {
		const renderImage = vi.fn().mockResolvedValue({
			blob: fakeBlob(2),
			sha256: "REAL",
			width: 600,
			height: 360,
		});
		const result = await rasterizeMarkers({
			fileKey: "F",
			markers: [marker("1:2")],
			scale: 3,
			renderImage,
		});
		expect(result.empty).toEqual([]);
		expect(result.elements[0]?.properties.src).toBe("asset:REAL");
	});

	it("keeps a marker when the caller reports no dimensions", async () => {
		// Dimensions are optional; a caller that can't supply them cheaply gets
		// the old behaviour rather than having every raster dropped.
		const renderImage = vi
			.fn()
			.mockResolvedValue({ blob: fakeBlob(3), sha256: "UNKNOWN" });
		const result = await rasterizeMarkers({
			fileKey: "F",
			markers: [marker("1:3")],
			scale: 3,
			renderImage,
		});
		expect(result.empty).toEqual([]);
		expect(result.elements[0]?.properties.src).toBe("asset:UNKNOWN");
	});
});
