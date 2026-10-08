import { toast } from "@freshcoat-js/ui/toast";
import type { Dataset } from "@freshcoat-js/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorController } from "~/app/controller";
import { announceImport } from "~/data/imported";
import { doc } from "./doc-fixture";

vi.mock("@freshcoat-js/ui/toast", () => ({ toast: vi.fn() }));

function dataset(id: string): Dataset {
	return {
		id,
		name: id,
		columns: [{ key: "Name", type: "text" }],
		records: [],
		assets: [],
	};
}

let controller: EditorController;
const binding = () => {
	const ws = controller.state.workspace;
	return ws?.templates.find((t) => t.id === ws.activeTemplateId)?.binding;
};

beforeEach(() => {
	vi.mocked(toast).mockClear();
	controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	controller.dispatch({
		type: "datasetEdit",
		datasets: [dataset("d_a"), dataset("d_b")],
	});
});

describe("announceImport", () => {
	it("binds a new dataset to an unbound template", () => {
		announceImport(controller, "d_a", "Imported", true);
		expect(binding()).toMatchObject({
			datasetId: "d_a",
			fields: { name: { kind: "column", column: "Name" } },
		});
		expect(vi.mocked(toast).mock.calls[0]?.[1]?.action).toBeUndefined();
	});

	it("offers a new dataset to a bound template from the toast", () => {
		controller.bindTemplate(
			controller.state.workspace?.activeTemplateId as string,
			"d_a",
		);
		announceImport(controller, "d_b", "Imported", true);
		expect(binding()?.datasetId).toBe("d_a");
		const action = vi.mocked(toast).mock.calls[0]?.[1]?.action;
		expect(action?.label).toBe("Use with doc.coat");
		action?.onAction();
		expect(binding()?.datasetId).toBe("d_b");
	});

	it("leaves the binding alone for records imported into a dataset", () => {
		announceImport(controller, "d_a", "Imported", false);
		expect(binding()).toBeUndefined();
		expect(vi.mocked(toast).mock.calls[0]).toEqual([
			"Imported",
			{ tone: "success", timeout: 6000 },
		]);
	});
});
