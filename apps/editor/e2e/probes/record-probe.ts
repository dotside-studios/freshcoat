import { autoBinding } from "@freshcoat-js/workspace";
import type { EditorController } from "~/app/controller";

/** Adds a three-record dataset and binds the active template to it. */
export function bindSampleRecords(names: string[]) {
	const c = (
		window as unknown as { __freshcoat: { controller: EditorController } }
	).__freshcoat.controller;
	const dataset = {
		id: "d_m",
		name: "Members",
		columns: [
			{ key: "display_name", type: "text" as const },
			{ key: "tier", type: "text" as const },
		],
		records: names.map((name, i) => ({
			id: `r_${i}`,
			values: { display_name: name, tier: "Gold" },
			status: "pending" as const,
		})),
		assets: [],
	};
	c.dispatch({ type: "datasetEdit", datasets: [dataset] });
	const t = c.template;
	const id = c.state.workspace?.activeTemplateId;
	if (!t || !id) throw new Error("no template");
	c.dispatch({ type: "setBinding", id, binding: autoBinding(t, dataset) });
	c.dispatch({ type: "setRightTab", tab: "content" });
}

/** Opens a template that is one full-bleed photo, with a dataset of the
 *  given photos bound to it, one record each. */
export async function bindPhotoRecords(photos: Blob[]) {
	const c = (
		window as unknown as { __freshcoat: { controller: EditorController } }
	).__freshcoat.controller;
	const { photoDataset, prepareAssets } = await import(
		"@freshcoat-js/workspace"
	);
	const { FORMAT_VERSION } = await import("@freshcoat-js/coatfile");
	c.open(
		{
			format_version: FORMAT_VERSION,
			id: "photo",
			name: "Photo",
			version: "1.0.0",
			width: 400,
			height: 300,
			fields: {
				type: "object",
				properties: {
					photo: { type: "string", title: "Photo", format: "image" },
				},
			},
			template_data: [
				{
					name: "front",
					background: {
						id: "bg",
						type: "rect",
						properties: { fill: "#ffffff" },
					},
					elements: [
						{
							id: "img",
							type: "image",
							pos: { x: 0, y: 0 },
							size: { width: 400, height: 300 },
							properties: { src: "{{photo}}", fit: "cover" },
						},
					],
				},
			],
		},
		"photo.coat",
	);
	const prepared = await prepareAssets(
		photos.map((blob, i) => ({ name: `p${i}.jpg`, blob })),
	);
	const dataset = photoDataset("Photos", prepared, "d_photos");
	c.dispatch({ type: "datasetEdit", datasets: [dataset] });
	const id = c.state.workspace?.activeTemplateId;
	const t = c.template;
	if (!id || !t) throw new Error("no template");
	c.dispatch({ type: "setBinding", id, binding: autoBinding(t, dataset) });
	return dataset.records.map((r) => r.id);
}
