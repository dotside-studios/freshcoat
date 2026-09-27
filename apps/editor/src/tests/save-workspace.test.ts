import { FORMAT_MAJOR, FORMAT_MINOR } from "@freshcoat-js/coatfile";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EditorController, NEWER_FORMAT } from "~/app/controller";
import * as download from "~/app/download";
import { doc } from "./doc-fixture";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@freshcoat-js/ui/toast", async (actual) => ({
	...(await actual<object>()),
	toast,
}));

afterEach(() => {
	vi.restoreAllMocks();
	toast.mockClear();
});

describe("saveWorkspace", () => {
	test("refuses a workspace holding a template from a newer format", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const controller = new EditorController();
		controller.dispatch({ type: "open", template: doc(), fileName: "a.coat" });
		controller.dispatch({
			type: "addTemplate",
			template: {
				...doc(),
				id: "newer",
				format_version: `${FORMAT_MAJOR}.${FORMAT_MINOR + 1}`,
			},
			fileName: "newer.coat",
		});
		expect(await controller.saveWorkspace()).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(`newer.coat: ${NEWER_FORMAT}`, {
			tone: "danger",
		});
	});

	test("saves a workspace of current templates", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const controller = new EditorController();
		controller.dispatch({ type: "open", template: doc(), fileName: "a.coat" });
		expect(await controller.saveWorkspace()).toBe(true);
		expect(save).toHaveBeenCalledOnce();
	});
});
