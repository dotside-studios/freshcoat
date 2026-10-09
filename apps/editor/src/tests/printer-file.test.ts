import { type ExportPreset, newPreset } from "@freshcoat-js/workspace";
import { itemRequest } from "@freshcoat-js/workspace/export";
import { describe, expect, it } from "vitest";
import {
	PRINTER_FILE_MAX_EDGE,
	printerFileRequest,
} from "~/export/printer-file";
import { doc } from "./doc-fixture";

const item = { key: "r1:front", side: "front", values: { name: "Ana" } };
const none = new Map();

function preset(patch: Partial<ExportPreset>): ExportPreset {
	return { ...newPreset("t_doc", [], "p_1"), ...patch };
}

describe("printerFileRequest", () => {
	it("is the export's request, capped at the printer file's edge", () => {
		const jpeg = preset({ format: "jpeg-zip", quality: 70, scale: 4 });
		const built = itemRequest(doc(), jpeg, item, none);
		if ("error" in built) throw new Error(built.error);
		const request = printerFileRequest(doc(), jpeg, item, none);
		if ("error" in request) throw new Error(request.error);
		const edge = Math.max(built.size.width, built.size.height);
		expect(request).toEqual({
			...built.request,
			scale: built.size.scale * Math.min(1, PRINTER_FILE_MAX_EDGE / edge),
		});
	});

	it("shows a PDF's pages as PNG", () => {
		const pdf = preset({ format: "pdf", pdfPageImage: "jpeg" });
		const request = printerFileRequest(doc(), pdf, item, none);
		expect(request).toMatchObject({ format: "png" });
		expect(request).not.toHaveProperty("quality");
	});
});
