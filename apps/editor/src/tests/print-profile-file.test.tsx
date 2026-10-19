import { type PrintProfile, parsePrintProfile } from "@freshcoat-js/for-print";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { CalibrateDialog } from "~/export/CalibrateDialog";
import { printProfileFile } from "~/export/calibrate";
import { ExportSettings } from "~/export/ExportSettings";
import { fastUser } from "./aria";
import { doc } from "./doc-fixture";

const downloads = vi.hoisted(
	() => [] as { data: unknown; name: string; type: string }[],
);
vi.mock("~/app/download", () => ({
	downloadBytes: async (data: unknown, name: string, type: string) => {
		downloads.push({ data, name, type });
	},
}));

afterEach(() => {
	cleanup();
	downloads.length = 0;
});

const profile: PrintProfile = {
	version: 1,
	name: "Shop printer, YMCKO ribbon",
	target: "ymcko-dye-sub",
	balance: { r: 1.1, g: 1, b: 0.9 },
	measuredAt: "2026-10-01T09:00:00.000Z",
	conditions: { printer: "Shop", media: "YMCKO", stock: "PVC" },
};

describe("printProfileFile", () => {
	test("writes JSON that parsePrintProfile reads back unchanged", () => {
		const file = printProfileFile(profile);
		expect(file.name).toBe("shop_printer_ymcko_ribbon.json");
		const back = parsePrintProfile(file.text);
		expect(back).toEqual({ ok: true, profile });
	});

	test("marks a profile written before versions as version 1", () => {
		const { version: _, ...old } = profile;
		expect(JSON.parse(printProfileFile(old).text).version).toBe(1);
	});
});

describe("CalibrateDialog", () => {
	const open = () => {
		const onSave = vi.fn();
		render(
			<CalibrateDialog
				isOpen
				onOpenChange={() => {}}
				target="ymcko-dye-sub"
				onSave={onSave}
			/>,
		);
		return { onSave, dialog: screen.getByRole("dialog") };
	};

	test("imports a profile file as the saved profile", async () => {
		const { onSave, dialog } = open();
		const input = dialog.querySelector(
			"input[type=file][accept*=json]",
		) as HTMLInputElement;
		await fastUser().upload(
			input,
			new File([printProfileFile(profile).text], "shop.json", {
				type: "application/json",
			}),
		);
		await waitFor(() => expect(onSave).toHaveBeenCalledWith(profile));
	});

	test("says why a file is not a profile", async () => {
		const { onSave, dialog } = open();
		const input = dialog.querySelector(
			"input[type=file][accept*=json]",
		) as HTMLInputElement;
		await fastUser().upload(
			input,
			new File(["{}"], "empty.json", { type: "application/json" }),
		);
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("Couldn't import empty.json");
		expect(onSave).not.toHaveBeenCalled();
	});

	test("exports a measured profile only once it can be measured", () => {
		open();
		expect(
			screen.getByRole("button", { name: "Export profile…" }),
		).toHaveProperty("disabled", true);
	});
});

describe("the print profile in export settings", () => {
	test("exports the preset's profile as the file the CLI reads", async () => {
		const controller = new EditorController();
		controller.dispatch({
			type: "open",
			template: doc(),
			fileName: "doc.coat",
		});
		const templateId = controller.state.workspace?.activeTemplateId as string;
		render(
			<ControllerProvider controller={controller}>
				<ExportSettings
					preset={{
						id: "p_1",
						name: "Cards",
						templateId,
						records: "all",
						sides: "all",
						format: "png-zip",
						scale: 1,
						dpi: 300,
						fileName: "{{index}}",
						markExported: false,
						print: { enabled: true, profile },
					}}
					template={doc()}
					plan={[]}
					listSelection={[]}
					collapsed={{ has: () => false, set: () => {} }}
					checks={[]}
					onCheckTarget={() => {}}
				/>
			</ControllerProvider>,
		);
		await fastUser().click(
			screen.getByRole("button", { name: "Export profile" }),
		);
		expect(downloads).toEqual([
			{
				data: printProfileFile(profile).text,
				name: "shop_printer_ymcko_ribbon.json",
				type: "application/json",
			},
		]);
	});
});
