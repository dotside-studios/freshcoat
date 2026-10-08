import { afterEach, describe, expect, test, vi } from "vitest";
import { EditorController } from "~/app/controller";
import { unwrap, updateElement } from "~/doc/ops";
import { doc } from "./doc-fixture";

const toast = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("@freshcoat-js/ui/toast", async (actual) => ({
	...(await actual<object>()),
	toast,
}));

afterEach(() => toast.mockClear());

type Undo = { action: { label: string; onAction: () => void } };

function twoTemplates() {
	const c = new EditorController();
	c.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	c.dispatch({
		type: "addTemplate",
		template: { ...doc(), id: "other", name: "Other" },
		fileName: "other.coat",
	});
	return c;
}

describe("removing a template", () => {
	test("offers Undo, which brings back its place, edits and presets", () => {
		const c = twoTemplates();
		const ws = () => c.state.workspace;
		const removed = ws()?.activeTemplateId as string;
		const present = c.state.doc?.history.present;
		if (!present) throw new Error("no doc");
		const edited = unwrap(
			updateElement(present, "0/0", { opacity: 0.5 }),
		).template;
		c.dispatch({ type: "commit", next: edited });
		c.dispatch({
			type: "setPreset",
			preset: {
				id: "p_1",
				name: "Other PNG",
				templateId: removed,
				records: "all",
				sides: "all",
				format: "png-zip",
				scale: 1,
				dpi: 300,
				fileName: "{{index}}",
				markExported: true,
			},
		});

		c.removeTemplate(removed);
		expect(ws()?.templates.map((t) => t.fileName)).toEqual(["doc.coat"]);
		expect(ws()?.presets).toEqual([]);
		expect(toast).toHaveBeenCalledWith(
			"Deleted other.coat",
			expect.objectContaining({
				action: expect.objectContaining({ label: "Undo" }),
			}),
		);

		const [, options] = toast.mock.calls[0] as unknown as [string, Undo];
		options.action.onAction();
		expect(ws()?.templates.map((t) => t.fileName)).toEqual([
			"doc.coat",
			"other.coat",
		]);
		expect(ws()?.activeTemplateId).toBe(removed);
		expect(c.state.doc?.history.present).toBe(edited);
		expect(c.state.doc?.history.past).toHaveLength(1);
		expect(ws()?.presets.map((p) => p.id)).toEqual(["p_1"]);
	});

	test("the last template stays, with a warning", () => {
		const c = new EditorController();
		c.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
		c.removeTemplate(c.state.workspace?.activeTemplateId as string);
		expect(c.state.workspace?.templates).toHaveLength(1);
		expect(toast).toHaveBeenCalledWith(
			"A workspace needs at least one template",
			{ tone: "warning" },
		);
	});
});
