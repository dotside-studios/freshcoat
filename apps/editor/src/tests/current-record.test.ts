import type { Template } from "@freshcoat-js/coatfile";
import { autoBinding, type Dataset } from "@freshcoat-js/workspace";
import { describe, expect, test } from "vitest";
import { EditorController } from "~/app/controller";
import { doc } from "./doc-fixture";

function members(id = "d_m", names = ["Ada", "Grace", "Hedy"]): Dataset {
	return {
		id,
		name: "Members",
		columns: [{ key: "name", type: "text" }],
		records: names.map((name, i) => ({
			id: `${id}_${i}`,
			values: { name },
			status: "pending",
		})),
		assets: [],
	};
}

function bound(datasets: Dataset[] = [members()]) {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	controller.dispatch({ type: "datasetEdit", datasets });
	controller.dispatch({
		type: "setBinding",
		id: controller.state.workspace?.activeTemplateId as string,
		binding: autoBinding(
			controller.template as Template,
			datasets[0] as Dataset,
		),
	});
	return controller;
}

describe("current record", () => {
	test("previewing a record in Edit makes it the current record", () => {
		const controller = bound();
		controller.previewRecord("d_m_1");
		expect(controller.state.recordId).toBe("d_m_1");
		expect(controller.state.values.name).toBe("Grace");
	});

	test("Edit follows a record chosen elsewhere when it comes into view", () => {
		const controller = bound();
		controller.dispatch({ type: "setSection", section: "data" });
		controller.dispatch({ type: "setRecord", id: "d_m_2" });
		expect(controller.state.previewRecordId).toBeNull();
		controller.dispatch({ type: "setSection", section: "edit" });
		expect(controller.state.previewRecordId).toBe("d_m_2");
		expect(controller.state.values.name).toBe("Hedy");
	});

	test("a record outside Edit's dataset leaves its preview alone", () => {
		const controller = bound([members(), members("d_o", ["Lin"])]);
		controller.previewRecord("d_m_0");
		controller.dispatch({ type: "setSection", section: "export" });
		controller.dispatch({ type: "setRecord", id: "d_o_0" });
		controller.dispatch({ type: "setSection", section: "edit" });
		expect(controller.state.previewRecordId).toBe("d_m_0");
		expect(controller.state.recordId).toBe("d_o_0");
	});

	test("a value typed by hand is not replaced by the current record", () => {
		const controller = bound();
		controller.previewRecord("d_m_1");
		controller.dispatch({ type: "setValue", field: "name", value: "Typed" });
		controller.dispatch({ type: "setRulers", on: true });
		expect(controller.state.values.name).toBe("Typed");
		expect(controller.state.recordId).toBe("d_m_1");
	});
});
