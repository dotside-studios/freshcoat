import { describe, expect, it } from "vitest";
import { EditorController } from "~/app/controller";
import { workspaceDirty } from "~/state/workspace";

describe("the photo watermark starter", () => {
	it("opens with a preset at each variant's size, as JPEG 90", async () => {
		const c = new EditorController();
		await c.openStarter("photo-watermark");
		const ws = c.state.workspace;
		expect(ws?.presets).toHaveLength(1);
		expect(ws?.presets[0]).not.toHaveProperty("size");
		expect(ws?.presets[0]).toMatchObject({
			templateId: ws?.activeTemplateId,
			scale: 2,
			format: "jpeg-zip",
			quality: 90,
			fileName: "{{file_name}}",
		});
		expect(ws?.activePresetId).toBe(ws?.presets[0]?.id);
		expect(workspaceDirty(c.state)).toBe(false);
	});

	it("adds its preset beside an open workspace's", async () => {
		const c = new EditorController();
		await c.openStarter("davi-card");
		const card = c.state.workspace?.presets[0]?.templateId;
		await c.openStarter("photo-watermark");
		const ws = c.state.workspace;
		expect(ws?.templates).toHaveLength(2);
		expect(ws?.presets.map((p) => p.templateId)).toEqual([
			card,
			ws?.activeTemplateId,
		]);
	});
});

describe("the Davi card starters", () => {
	it.each([
		"davi-card",
		"davi-card-portrait",
	])("%s opens with a preset that prints", async (id) => {
		const c = new EditorController();
		await c.openStarter(id);
		const ws = c.state.workspace;
		expect(ws?.presets).toHaveLength(1);
		expect(ws?.presets[0]).toMatchObject({
			templateId: ws?.activeTemplateId,
			format: "png-zip",
			print: { enabled: true },
		});
		expect(workspaceDirty(c.state)).toBe(false);
	});
});

describe("the Event badge starter", () => {
	it("opens with Badges on A4: a PDF on sheets with crop marks", async () => {
		const c = new EditorController();
		await c.openStarter("event-badge");
		const ws = c.state.workspace;
		expect(ws?.presets).toHaveLength(1);
		expect(ws?.presets[0]).toMatchObject({
			name: "Badges on A4",
			templateId: ws?.activeTemplateId,
			format: "pdf",
			layout: {
				kind: "sheet",
				paper: "a4",
				orientation: "auto",
				cropMarks: true,
				duplex: "none",
			},
		});
		expect(workspaceDirty(c.state)).toBe(false);
	});
});
