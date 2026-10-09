import * as ws from "@freshcoat-js/workspace";
import { newPreset } from "@freshcoat-js/workspace";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { ExportSection } from "~/export/ExportSection";
import { doc } from "./doc-fixture";

vi.mock("@freshcoat-js/workspace", async (original) => {
	const actual = await original<typeof import("@freshcoat-js/workspace")>();
	return { ...actual, planExport: vi.fn(actual.planExport) };
});

beforeEach(() => {
	vi.stubGlobal("fetch", async () => {
		throw new Error("offline");
	});
	vi.stubGlobal("innerWidth", 1440);
	localStorage.clear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

test("a history-only change does not replan the export", () => {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	const templateId = controller.state.workspace?.activeTemplateId as string;
	controller.dispatch({
		type: "setPreset",
		preset: newPreset(templateId, []),
	});
	controller.dispatch({ type: "setSection", section: "export" });
	render(
		<ControllerProvider controller={controller}>
			<ExportSection />
		</ControllerProvider>,
	);
	const planExport = vi.mocked(ws.planExport);
	planExport.mockClear();

	const before = controller.state.doc;
	act(() => {
		controller.beginTx();
		controller.endTx();
	});
	expect(controller.state.doc).not.toBe(before);
	expect(planExport).not.toHaveBeenCalled();

	act(() => {
		controller.dispatch({
			type: "commit",
			next: { ...doc(), name: "Renamed" },
		});
	});
	expect(planExport).toHaveBeenCalled();
});
