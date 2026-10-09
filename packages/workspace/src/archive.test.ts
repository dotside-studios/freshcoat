import { bytesToBase64, validate } from "@freshcoat-js/coatfile";
import {
	LEGACY_TKIT_MEDIA_TYPE,
	unpackTemplate,
} from "@freshcoat-js/coatfile/coat";
import { jpegHeader } from "@freshcoat-js/test-utils";
import {
	strFromU8,
	strToU8,
	unzipSync,
	Zip,
	ZipPassThrough,
	zipSync,
} from "fflate";
import { describe, expect, it } from "vitest";
import {
	packTemplates,
	packWorkspace,
	unpackWorkspace,
	WORKSPACE_MEDIA_TYPE,
} from "./archive";
import { exportSize, pdfLayout } from "./plan";
import {
	backSha,
	deepFreeze,
	makePng,
	memberCard,
	photoPng,
	photoSha,
	sha256,
	workspace,
} from "./test-fixtures";
import type { ExportPreset, UnpackResult, Workspace } from "./types";

const ws: Workspace = deepFreeze(workspace);

async function packed(w: Workspace): Promise<Uint8Array> {
	return new Uint8Array(await (await packWorkspace(w)).arrayBuffer());
}

/** A result with every asset's Blob read into bytes, so two can be compared
 *  by value. */
async function readable(result: UnpackResult | Workspace) {
	const w =
		"formatVersion" in result ? result : result.ok ? result.workspace : null;
	if (w === null) return result;
	const datasets = await Promise.all(
		w.datasets.map(async (d) => ({
			...d,
			assets: await Promise.all(
				d.assets.map(async ({ blob, ...rest }) => ({
					...rest,
					type: blob.type,
					bytes: new Uint8Array(await blob.arrayBuffer()),
				})),
			),
		})),
	);
	const out = { ...w, datasets };
	return "formatVersion" in result ? out : { ...result, workspace: out };
}

async function repack(
	edit: (files: Record<string, Uint8Array>) => void,
): Promise<UnpackResult> {
	const files = unzipSync(await packed(ws));
	edit(files);
	return unpackWorkspace(zipSync(files));
}

function manifestOf(files: Record<string, Uint8Array>) {
	return JSON.parse(strFromU8(files["workspace.json"] as Uint8Array));
}

/** Where an entry's local header starts, found by its name. */
function localHeaderOf(zip: Uint8Array, name: string): number {
	const wanted = strToU8(name);
	for (let i = 0; i + 30 + wanted.length <= zip.length; i++) {
		const view = new DataView(zip.buffer, zip.byteOffset + i);
		if (
			view.getUint32(0, true) === 0x04034b50 &&
			view.getUint16(26, true) === wanted.length &&
			wanted.every((b, j) => zip[i + 30 + j] === b)
		)
			return i;
	}
	throw new Error(`no local header for ${name}`);
}

function codeOf(result: UnpackResult): string {
	return result.ok ? "ok" : result.code;
}

describe("packWorkspace", () => {
	it("fixture templates are valid", () => {
		expect(validate(memberCard).ok).toBe(true);
	});

	it("lays the entries out in order, mimetype first and stored", async () => {
		const bytes = await packed(ws);
		expect(strFromU8(bytes.subarray(30, 38))).toBe("mimetype");
		expect(
			strFromU8(bytes.subarray(38, 38 + WORKSPACE_MEDIA_TYPE.length)),
		).toBe(WORKSPACE_MEDIA_TYPE);
		expect(Object.keys(unzipSync(bytes))).toEqual([
			"mimetype",
			"workspace.json",
			"templates/t_member.coat",
			"templates/t_plain.coat",
			"data/d_members/schema.json",
			"data/d_members/records.json",
			`data/d_members/assets/${photoSha}.png`,
		]);
	});

	it("writes a manifest that points at every entry", async () => {
		const files = unzipSync(await packed(ws));
		const manifest = manifestOf(files);
		expect(manifest).toMatchObject({
			format: "freshcoat.workspace",
			formatVersion: "1.0",
			name: "Club",
			templates: [
				{
					id: "t_member",
					fileName: "Member card.coat",
					path: "templates/t_member.coat",
				},
				{ id: "t_plain", fileName: "Plain", path: "templates/t_plain.coat" },
			],
			datasets: [
				{
					id: "d_members",
					name: "Members",
					schema: "data/d_members/schema.json",
					records: "data/d_members/records.json",
					assets: [
						{
							sha256: photoSha,
							contentType: "image/png",
							name: "ana.png",
							path: `data/d_members/assets/${photoSha}.png`,
						},
					],
				},
			],
			presets: ws.presets,
		});
		expect(manifest.templates[1].binding).toBeUndefined();
		const template = await unpackTemplate(
			files["templates/t_member.coat"] as Uint8Array,
		);
		expect(template).toEqual(memberCard);
		const records = JSON.parse(
			strFromU8(files["data/d_members/records.json"] as Uint8Array),
		);
		expect(records[1]).toEqual({
			id: "r_00000002",
			status: "exported",
			exportedAt: "2026-09-01T10:00:00.000Z",
			values: { name: "Ben Uy", tier: "Gold Tier", vip: false },
		});
	});

	it("packs the same workspace to the same bytes", async () => {
		const a = await packed(ws);
		const b = await packed({ ...workspace });
		expect(b).toEqual(a);
	});

	it("lays out the bytes exactly as phase 2's zipSync did", async () => {
		const files = unzipSync(await packed(ws));
		const phase2 = zipSync(
			Object.fromEntries(
				Object.entries(files).map(([path, data]) => [
					path,
					[
						data,
						{
							level:
								path === "mimetype" ||
								path.endsWith(".coat") ||
								path.endsWith(".png")
									? 0
									: 6,
						},
					],
				]),
			),
			{ mtime: new Date(1980, 0, 1) },
		);
		expect(await packed(ws)).toEqual(phase2);
	});

	it("streams into a sink the same bytes it returns as a Blob", async () => {
		const chunks: Uint8Array[] = [];
		let closed = false;
		const sink = new WritableStream<Uint8Array>({
			write(chunk) {
				chunks.push(chunk.slice());
			},
			close() {
				closed = true;
			},
		});
		await packWorkspace(ws, sink);
		expect(closed).toBe(true);
		const streamed = new Uint8Array(
			await new Blob(chunks as BlobPart[]).arrayBuffer(),
		);
		expect(streamed).toEqual(await packed(ws));
	});

	it("returns a Blob that refers to the assets rather than copying them", async () => {
		const blob = await packWorkspace(ws);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe(WORKSPACE_MEDIA_TYPE);
	});

	it("round-trips to a deep-equal workspace", async () => {
		const result = await unpackWorkspace(await packWorkspace(ws));
		expect(await readable(result)).toEqual({
			ok: true,
			workspace: await readable(ws),
			warnings: [],
		});
	});

	it("round-trips an all-variants source and opens every older one", async () => {
		const sources = [
			{ kind: "all" },
			{ kind: "fixed", id: "gold" },
			{ kind: "fixed" },
			{ kind: "column", column: "tier" },
		] as const;
		for (const variant of sources) {
			const [member, plain] = ws.templates;
			const binding = { datasetId: "d_members", fields: {}, variant };
			const w: Workspace = {
				...ws,
				templates: [{ ...member, binding }, plain],
			};
			const result = await unpackWorkspace(await packWorkspace(w));
			expect(
				result.ok && result.workspace.templates[0].binding?.variant,
			).toEqual(variant);
		}
	});

	it("writes 1.1 for a variant fallback and reads it back without a warning", async () => {
		const [member, plain] = ws.templates;
		const variant = {
			kind: "column",
			column: "tier",
			fallback: { kind: "image", field: "photo" },
		} as const;
		const w: Workspace = {
			...ws,
			templates: [
				{ ...member, binding: { datasetId: "d_members", fields: {}, variant } },
				plain,
			],
		};
		const packed = await packWorkspace(w);
		const files = unzipSync(new Uint8Array(await packed.arrayBuffer()));
		expect(manifestOf(files).formatVersion).toBe("1.1");
		const result = await unpackWorkspace(packed);
		expect(result.ok && result.warnings).toEqual([]);
		expect(result.ok && result.workspace.templates[0].binding?.variant).toEqual(
			variant,
		);
	});

	it("keeps guides in the manifest and leaves the template alone", async () => {
		const [member, plain] = ws.templates;
		const guides = {
			front: { x: [12, 500.5], y: [] },
			back: { x: [], y: [40] },
		};
		const w: Workspace = { ...ws, templates: [{ ...member, guides }, plain] };
		const files = unzipSync(await packed(w));
		const manifest = manifestOf(files);
		expect(manifest.templates[0].guides).toEqual(guides);
		expect(manifest.templates[1].guides).toBeUndefined();
		const pkg = unzipSync(files[manifest.templates[0].path] as Uint8Array);
		for (const bytes of Object.values(pkg))
			expect(strFromU8(bytes, true)).not.toContain("500.5");
		const result = await unpackWorkspace(zipSync(files));
		expect(result.ok && result.workspace.templates[0].guides).toEqual(guides);
		expect(result.ok && "guides" in result.workspace.templates[1]).toBe(false);
	});

	it("refuses guides that are not numbers", async () => {
		const result = await repack((f) => {
			const manifest = manifestOf(f);
			manifest.templates[0].guides = { front: { x: ["a"], y: [] } };
			f["workspace.json"] = strToU8(JSON.stringify(manifest));
		});
		expect(codeOf(result)).toBe("invalid_manifest");
	});

	it("refuses a variant source of an unknown kind", async () => {
		const result = await repack((f) => {
			const manifest = manifestOf(f);
			manifest.templates[0].binding.variant = { kind: "some" };
			f["workspace.json"] = strToU8(JSON.stringify(manifest));
		});
		expect(codeOf(result)).toBe("invalid_manifest");
	});

	it("opens a phase 5 workspace whose templates are .tkit entries", async () => {
		const files = unzipSync(await packed(ws));
		const manifest = manifestOf(files);
		for (const item of manifest.templates) {
			const legacy = item.path.replace(/\.coat$/, ".tkit");
			const pkg = unzipSync(files[item.path] as Uint8Array);
			pkg.mimetype = strToU8(LEGACY_TKIT_MEDIA_TYPE);
			files[legacy] = zipSync(pkg);
			delete files[item.path];
			item.path = legacy;
		}
		files["workspace.json"] = strToU8(JSON.stringify(manifest));
		const result = await unpackWorkspace(zipSync(files));
		expect(await readable(result)).toEqual({
			ok: true,
			workspace: await readable(ws),
			warnings: [],
		});
	});

	it("reads a phase 2 preset as template size and keeps the new fields", async () => {
		const photoPreset = {
			...ws.presets[0],
			id: "p_photos",
			format: "jpeg-zip" as const,
			size: { kind: "image" as const, field: "photo", maxEdge: 4096 },
			quality: 80,
			pdfPageImage: "jpeg" as const,
			destination: "folder" as const,
		};
		const result = await unpackWorkspace(
			await packWorkspace({ ...ws, presets: [...ws.presets, photoPreset] }),
		);
		if (!result.ok) throw new Error("did not open");
		const [phase2, photos] = result.workspace.presets;
		expect(phase2?.size).toBeUndefined();
		expect(exportSize(phase2 as ExportPreset)).toEqual({ kind: "template" });
		expect(photos).toEqual(photoPreset);
	});

	it("keeps a preset's print settings and reads a phase 3 preset as off", async () => {
		const printPreset: ExportPreset = {
			...(ws.presets[0] as ExportPreset),
			id: "p_print",
			print: {
				enabled: true,
				analyze: false,
				profile: {
					version: 1,
					name: "Card printer / ribbon A",
					balance: { r: 1.1, g: 1, b: 0.95 },
					measuredAt: "2026-09-01T09:00:00Z",
				},
			},
		};
		const result = await unpackWorkspace(
			await packWorkspace({ ...ws, presets: [...ws.presets, printPreset] }),
		);
		if (!result.ok) throw new Error("did not open");
		const [phase3, printed] = result.workspace.presets;
		expect(phase3?.print).toBeUndefined();
		expect(printed).toEqual(printPreset);
	});

	it("keeps a preset's sheet layout and reads a phase 4 preset as single", async () => {
		const sheets: ExportPreset = {
			...(ws.presets[0] as ExportPreset),
			id: "p_sheets",
			format: "pdf",
			layout: {
				kind: "sheet",
				paper: { widthMm: 300, heightMm: 200 },
				orientation: "auto",
				marginMm: 5,
				gapMm: 2,
				cropMarks: false,
				duplex: "short-edge",
				backOffsetMm: { x: 0.5, y: -0.25 },
				blankBacks: true,
			},
		};
		const result = await unpackWorkspace(
			await packWorkspace({ ...ws, presets: [...ws.presets, sheets] }),
		);
		if (!result.ok) throw new Error("did not open");
		const [phase4, imposed] = result.workspace.presets;
		expect(phase4?.layout).toBeUndefined();
		expect(pdfLayout(phase4 as ExportPreset)).toEqual({ kind: "single" });
		expect(imposed).toEqual(sheets);
	});

	it("keeps a preset's bleed and reads an older preset as trim only", async () => {
		const bled: ExportPreset = {
			...(ws.presets[0] as ExportPreset),
			id: "p_bleed",
			bleed: true,
		};
		const result = await unpackWorkspace(
			await packWorkspace({ ...ws, presets: [...ws.presets, bled] }),
		);
		if (!result.ok) throw new Error("did not open");
		const [older, kept] = result.workspace.presets;
		expect(older?.bleed).toBeUndefined();
		expect(kept).toEqual(bled);
	});

	it("refuses a preset whose sheet layout is malformed", async () => {
		const bad = {
			...(ws.presets[0] as ExportPreset),
			layout: { kind: "sheet", paper: "a5", orientation: "auto" },
		} as unknown as ExportPreset;
		const result = await unpackWorkspace(
			await packWorkspace({ ...ws, presets: [bad] }),
		);
		expect(result).toMatchObject({ ok: false, code: "invalid_manifest" });
	});

	it("refuses a preset whose print profile is malformed", async () => {
		const bad = {
			...(ws.presets[0] as ExportPreset),
			print: { enabled: true, profile: { name: "p", balance: { r: 40 } } },
		} as unknown as ExportPreset;
		const result = await unpackWorkspace(
			await packWorkspace({ ...ws, presets: [bad] }),
		);
		expect(result).toMatchObject({ ok: false, code: "invalid_manifest" });
	});

	it("round-trips Blobs, reading each photo's header as it opens", async () => {
		const jpeg = jpegHeader({ width: 60, height: 40, orientation: 6 });
		const sha = sha256(jpeg);
		const photos: Workspace = {
			...ws,
			datasets: [
				{
					id: "d_p",
					name: "Photos",
					columns: [{ key: "photo", type: "image" }],
					records: [
						{ id: "r_1", status: "pending", values: { photo: `ws:${sha}` } },
					],
					assets: [
						{
							sha256: sha,
							contentType: "image/jpeg",
							name: "IMG_1.JPG",
							size: jpeg.length,
							blob: new Blob([jpeg as BlobPart], { type: "image/jpeg" }),
						},
					],
				},
			],
		};
		const result = await unpackWorkspace(await packWorkspace(photos));
		if (!result.ok) throw new Error(result.message);
		const asset = result.workspace.datasets[0]?.assets[0];
		expect(asset).toMatchObject({
			sha256: sha,
			contentType: "image/jpeg",
			name: "IMG_1.JPG",
			size: jpeg.length,
			width: 60,
			height: 40,
			orientation: 6,
		});
		expect(asset?.blob.type).toBe("image/jpeg");
		expect(new Uint8Array(await (asset?.blob as Blob).arrayBuffer())).toEqual(
			jpeg,
		);
	});

	it("opens a zip whose stored entries have data descriptors", async () => {
		const files = unzipSync(await packed(ws));
		// A photo that happens to contain a data descriptor's signature.
		const tricky = new Uint8Array([...photoPng, 0x50, 0x4b, 0x07, 0x08, 1, 2]);
		const trickySha = sha256(tricky);
		const manifest = manifestOf(files);
		manifest.datasets[0].assets[0].sha256 = trickySha;
		manifest.datasets[0].assets[0].path = `data/d_members/assets/${trickySha}.png`;
		files["workspace.json"] = strToU8(JSON.stringify(manifest));
		delete files[`data/d_members/assets/${photoSha}.png`];
		files[`data/d_members/assets/${trickySha}.png`] = tricky;
		const parts: Uint8Array[] = [];
		const zip = new Zip((err, chunk) => {
			if (err) throw err;
			parts.push(chunk);
		});
		for (const [path, data] of Object.entries(files)) {
			const file = new ZipPassThrough(path);
			zip.add(file);
			file.push(data, true);
		}
		zip.end();
		const result = await unpackWorkspace(new Blob(parts as BlobPart[]));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const asset = result.workspace.datasets[0]?.assets[0];
		expect(new Uint8Array(await (asset?.blob as Blob).arrayBuffer())).toEqual(
			tricky,
		);
		expect(result.workspace.templates).toEqual(ws.templates);
	});

	it("keeps asset order and header facts while hashing several at once", async () => {
		// Larger photos first, so later ones finish hashing before them, and
		// one whose frame header sits past the first 64 KB of the file.
		const jpegs = Array.from({ length: 9 }, (_, i) =>
			jpegHeader({
				width: 100 + i,
				height: 50 + i,
				orientation: (i % 8) + 1,
				padding: i === 4 ? 200_000 : (9 - i) * 40_000,
			}),
		);
		const many: Workspace = {
			...ws,
			datasets: [
				{
					id: "d_p",
					name: "Photos",
					columns: [{ key: "photo", type: "image" }],
					records: [],
					assets: jpegs.map((jpeg, i) => ({
						sha256: sha256(jpeg),
						contentType: "image/jpeg",
						name: `IMG_${i}.JPG`,
						size: jpeg.length,
						width: 100 + i,
						height: 50 + i,
						orientation: (i % 8) + 1,
						blob: new Blob([jpeg as BlobPart], { type: "image/jpeg" }),
					})),
				},
			],
		};
		const result = await unpackWorkspace(await packed(many));
		if (!result.ok) throw new Error(result.message);
		const facts = async (assets: Workspace["datasets"][number]["assets"]) =>
			Promise.all(
				assets.map(async ({ blob, ...rest }) => ({
					...rest,
					type: blob.type,
					bytes: sha256(new Uint8Array(await blob.arrayBuffer())),
				})),
			);
		const opened = await facts(result.workspace.datasets[0]?.assets ?? []);
		expect(opened.map((a) => a.name)).toEqual(
			jpegs.map((_, i) => `IMG_${i}.JPG`),
		);
		expect(opened).toEqual(await facts(many.datasets[0]?.assets ?? []));
	});

	it("opens to the same workspace whether entries are sliced or streamed", async () => {
		const bytes = await packed(ws);
		const view = new DataView(bytes.buffer);
		const directory = view.getUint32(bytes.length - 22 + 16, true);
		const broken = bytes.slice();
		// The first entry's local header offset pointed one byte off, so the
		// reader cannot trust the directory and streams the file instead.
		new DataView(broken.buffer).setUint32(directory + 42, 1, true);
		const sliced = await unpackWorkspace(bytes);
		const streamed = await unpackWorkspace(broken);
		expect(sliced.ok).toBe(true);
		expect(await readable(sliced)).toEqual(await readable(streamed));
		expect(await readable(sliced)).toEqual({
			ok: true,
			workspace: await readable(ws),
			warnings: [],
		});
	});

	it("round-trips an empty dataset list and a record-less dataset", async () => {
		const bare: Workspace = {
			...ws,
			datasets: [
				{ id: "d_e", name: "E", columns: [], records: [], assets: [] },
			],
			presets: [],
		};
		const result = await unpackWorkspace(await packWorkspace(bare));
		expect(result).toEqual({ ok: true, workspace: bare, warnings: [] });
	});
});

describe("unpackWorkspace rejections", () => {
	it("not_a_zip", async () => {
		expect(codeOf(await unpackWorkspace(strToU8("hello")))).toBe("not_a_zip");
	});

	it("wrong_mimetype, when wrong or absent", async () => {
		expect(
			codeOf(
				await repack((f) => {
					f.mimetype = strToU8("application/zip");
				}),
			),
		).toBe("wrong_mimetype");
		expect(
			codeOf(
				await repack((f) => {
					delete f.mimetype;
				}),
			),
		).toBe("wrong_mimetype");
	});

	it("missing_manifest", async () => {
		expect(
			codeOf(
				await repack((f) => {
					delete f["workspace.json"];
				}),
			),
		).toBe("missing_manifest");
	});

	it("invalid_manifest, for bad JSON or a bad shape", async () => {
		expect(
			codeOf(
				await repack((f) => {
					f["workspace.json"] = strToU8("{");
				}),
			),
		).toBe("invalid_manifest");
		expect(
			codeOf(
				await repack((f) => {
					const m = manifestOf(f);
					m.templates = [];
					f["workspace.json"] = strToU8(JSON.stringify(m));
				}),
			),
		).toBe("invalid_manifest");
		expect(
			codeOf(
				await repack((f) => {
					const m = manifestOf(f);
					m.format = "something.else";
					f["workspace.json"] = strToU8(JSON.stringify(m));
				}),
			),
		).toBe("invalid_manifest");
	});

	it("newer_version for a newer major, a warning for a newer minor", async () => {
		const withVersion = (v: string) =>
			repack((f) => {
				const m = manifestOf(f);
				m.formatVersion = v;
				f["workspace.json"] = strToU8(JSON.stringify(m));
			});
		expect(codeOf(await withVersion("2.0"))).toBe("newer_version");
		const minor = await withVersion("1.3");
		expect(minor.ok).toBe(true);
		expect(minor.ok && minor.warnings).toHaveLength(1);
		const read = await withVersion("1.1");
		expect(read.ok && read.warnings).toEqual([]);
	});

	it("missing_entry, for a template, a data file or an asset", async () => {
		for (const path of [
			"templates/t_plain.coat",
			"data/d_members/records.json",
			"data/d_members/schema.json",
			`data/d_members/assets/${photoSha}.png`,
		]) {
			expect(
				codeOf(
					await repack((f) => {
						delete f[path];
					}),
				),
			).toBe("missing_entry");
		}
	});

	it("invalid_entry, for records that do not parse", async () => {
		expect(
			codeOf(
				await repack((f) => {
					f["data/d_members/records.json"] = strToU8('[{"id":1}]');
				}),
			),
		).toBe("invalid_entry");
	});

	it("asset_hash_mismatch, for a photo or a template asset", async () => {
		expect(
			codeOf(
				await repack((f) => {
					f[`data/d_members/assets/${photoSha}.png`] = new Uint8Array([1, 2]);
				}),
			),
		).toBe("asset_hash_mismatch");
		expect(
			codeOf(
				await repack((f) => {
					const coat = unzipSync(f["templates/t_member.coat"] as Uint8Array);
					const name = Object.keys(coat).find((k) => k.startsWith("assets/"));
					coat[name as string] = new Uint8Array([9]);
					f["templates/t_member.coat"] = zipSync(coat);
				}),
			),
		).toBe("asset_hash_mismatch");
	});

	it("asset_hash_mismatch for the first corrupt photo in manifest order", async () => {
		const jpegs = [3, 1, 2].map((n) =>
			jpegHeader({ width: n, height: n, padding: n * 50_000 }),
		);
		const photos: Workspace = {
			...ws,
			datasets: [
				{
					id: "d_p",
					name: "Photos",
					columns: [{ key: "photo", type: "image" }],
					records: [],
					assets: jpegs.map((jpeg, i) => ({
						sha256: sha256(jpeg),
						contentType: "image/jpeg",
						name: `IMG_${i}.JPG`,
						size: jpeg.length,
						blob: new Blob([jpeg as BlobPart], { type: "image/jpeg" }),
					})),
				},
			],
		};
		const bytes = await packed(photos);
		// Corrupted in place, inside the stored bytes of the second and third
		// photos, so the largest first one is still hashing when they fail.
		for (const jpeg of jpegs.slice(1)) {
			const at = localHeaderOf(bytes, `data/d_p/assets/${sha256(jpeg)}.jpg`);
			bytes[
				at + 30 + new DataView(bytes.buffer).getUint16(at + 26, true) + 1000
			] ^= 0xff;
		}
		const result = await unpackWorkspace(bytes);
		expect(result).toMatchObject({
			ok: false,
			code: "asset_hash_mismatch",
			message: expect.stringContaining(sha256(jpegs[1] as Uint8Array)),
		});
	});

	it("not_a_zip, for a deflated entry that does not inflate", async () => {
		const bytes = await packed(ws);
		const at = localHeaderOf(bytes, "data/d_members/records.json");
		const view = new DataView(bytes.buffer);
		const start = at + 30 + view.getUint16(at + 26, true);
		// A final block of the reserved type, which no inflater accepts.
		bytes.fill(0xff, start, start + view.getUint32(at + 18, true));
		expect(codeOf(await unpackWorkspace(bytes))).toBe("not_a_zip");
	});

	it("invalid_template, for a template that does not validate", async () => {
		expect(
			codeOf(
				await repack((f) => {
					f["templates/t_plain.coat"] = strToU8('{"id":"x"}');
				}),
			),
		).toBe("invalid_template");
	});

	it("heals duplicate element ids, with a warning", async () => {
		const duplicated = {
			...memberCard,
			template_data: memberCard.template_data.map((frame, i) =>
				i === 0
					? {
							...frame,
							elements: frame.elements.map((el) => ({ ...el, id: "same" })),
						}
					: frame,
			),
		};
		const result = await repack((f) => {
			f["templates/t_plain.coat"] = strToU8(JSON.stringify(duplicated));
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.warnings).toEqual(["Plain: renamed duplicate element ids"]);
		const ids =
			result.workspace.templates[1]?.template.template_data[0]?.elements.map(
				(e) => e.id,
			);
		expect(new Set(ids).size).toBe(2);
	});
});

describe("packTemplates", () => {
	it("zips every template as .coat under its file name", async () => {
		const twins: Workspace = {
			...ws,
			templates: [
				...ws.templates,
				{
					...(ws.templates[1] as Workspace["templates"][number]),
					id: "t_3",
					fileName: "plain.tkit.json",
				},
				{
					...(ws.templates[1] as Workspace["templates"][number]),
					id: "t_4",
					fileName: "a/b:c",
				},
			],
		};
		const zip = unzipSync(await packTemplates(twins));
		expect(Object.keys(zip)).toEqual([
			"templates/Member card.coat",
			"templates/Plain.coat",
			"templates/plain-2.coat",
			"templates/a-b-c.coat",
		]);
		expect(
			await unpackTemplate(zip["templates/Member card.coat"] as Uint8Array),
		).toEqual(memberCard);
		expect(await packTemplates(twins)).toEqual(await packTemplates(twins));
	});
});

describe("unused assets", () => {
	const variantPng = makePng(3, 3, [0, 128, 0]);
	const unusedPng = makePng(5, 5, [0, 0, 255]);
	const png = (bytes: Uint8Array) => ({
		sha256: sha256(bytes),
		base64: bytesToBase64(bytes),
		contentType: "image/png" as const,
	});
	const carried: Workspace = {
		...ws,
		templates: ws.templates.map((entry, i) =>
			i === 0
				? {
						...entry,
						template: {
							...memberCard,
							variants: [
								{
									id: "gold",
									label: "Gold Tier",
									overrides: [
										{
											name: "front",
											elements: [
												{
													id: "photo",
													properties: {
														src: `asset:${sha256(variantPng)}`,
													},
												},
											],
										},
									],
								},
							],
							assets: [
								...(memberCard.assets ?? []),
								png(variantPng),
								png(unusedPng),
							],
						},
					}
				: entry,
		),
	};
	const kept = [backSha, sha256(variantPng)];

	it("packWorkspace drops the ones nothing references", async () => {
		const result = await unpackWorkspace(await packed(carried));
		if (!result.ok) throw new Error(JSON.stringify(result));
		expect(
			result.workspace.templates[0]?.template.assets?.map((a) => a.sha256),
		).toEqual(kept);
	});

	it("packTemplates drops them too", async () => {
		const zip = unzipSync(await packTemplates(carried));
		const bytes = zip["templates/Member card.coat"];
		if (!bytes) throw new Error(Object.keys(zip).join());
		const template = (await unpackTemplate(bytes)) as {
			assets: { sha256: string }[];
		};
		expect(template.assets.map((a) => a.sha256)).toEqual(kept);
	});
});

describe("format_version", () => {
	const oldLabel: Workspace = {
		...ws,
		templates: ws.templates.map((entry) => ({
			...entry,
			template: {
				...entry.template,
				format_version: "1.0",
				$schema: "https://example.test/coatfile.json",
			},
		})),
	};

	it("packWorkspace raises each template to what its fields need", async () => {
		const result = await unpackWorkspace(await packed(oldLabel));
		if (!result.ok) throw new Error(JSON.stringify(result));
		for (const entry of result.workspace.templates) {
			expect(entry.template.format_version).toBe("1.1");
		}
	});

	it("packTemplates raises each template to what its fields need", async () => {
		const zip = unzipSync(await packTemplates(oldLabel));
		for (const bytes of Object.values(zip)) {
			const template = (await unpackTemplate(bytes)) as {
				format_version: string;
			};
			expect(template.format_version).toBe("1.1");
		}
	});
});
