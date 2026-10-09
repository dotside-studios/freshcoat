import { toast } from "@freshcoat-js/ui/toast";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EditorController } from "~/app/controller";
import { newDatasetFromPhotos } from "~/data/actions";
import { PhotoImportBar } from "~/data/PhotoImportBar";
import { button, fastUser } from "./aria";
import { doc } from "./doc-fixture";

vi.mock("@freshcoat-js/ui/toast", async (importOriginal) => ({
	...(await importOriginal<object>()),
	toast: vi.fn(),
}));

vi.mock("@freshcoat-js/workspace", async (importOriginal) => ({
	...(await importOriginal<object>()),
	prepareAssets: (
		files: readonly unknown[],
		opts: {
			onProgress?: (done: number, total: number) => void;
			signal?: AbortSignal;
		},
	) =>
		new Promise((_, reject) => {
			opts.onProgress?.(1, files.length);
			opts.signal?.addEventListener("abort", () => reject(opts.signal?.reason));
		}),
}));

afterEach(cleanup);

describe("photo import", () => {
	test("cancels while reading photos", async () => {
		const controller = new EditorController();
		controller.dispatch({
			type: "open",
			template: doc(),
			fileName: "doc.coat",
		});
		render(<PhotoImportBar />);
		const files = ["a.png", "b.png"].map(
			(name) => new File([new Uint8Array([1])], name, { type: "image/png" }),
		);
		let made: unknown;
		const importing = newDatasetFromPhotos(controller, files).then((d) => {
			made = d;
		});
		const bar = await screen.findByTestId("photo-import-progress");
		expect(bar.textContent).toContain("1 of 2");
		await fastUser().click(button("Cancel"));
		await act(() => importing);
		expect(made).toBeNull();
		expect(screen.queryByTestId("photo-import-progress")).toBeNull();
		expect(toast).toHaveBeenCalledWith("Photo import canceled");
		expect(controller.state.workspace?.datasets).toEqual([]);
	});
});
