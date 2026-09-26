import type { Template } from "@freshcoat/coatfile";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import * as download from "~/app/download";
import { IssuesList, IssuesPopover } from "~/app/IssuesPopover";
import { updateElement } from "~/doc/ops";
import { useEditor } from "~/state/hooks";
import { doc } from "./doc-fixture";

beforeEach(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
	vi.stubGlobal("fetch", async () => {
		throw new Error("offline");
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function List() {
	const t = useEditor((s) => s.doc?.history.present ?? null);
	return t ? <IssuesList template={t} /> : null;
}

function mount(ui: React.ReactNode, template: Template = doc()) {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template, fileName: "doc.coat" });
	render(<ControllerProvider controller={controller}>{ui}</ControllerProvider>);
	return { controller, user: userEvent.setup() };
}

/** The name of the text `breakText` breaks. */
const LAYER = "t1";

/** Points a text at a field that does not exist: one validation error. */
function breakText(controller: EditorController) {
	act(() => {
		controller.edit((t) =>
			updateElement(t, "0/1/1", { properties: { value: "{{nope}}" } }),
		);
	});
}

describe("the issues list", () => {
	test("the valid state", () => {
		mount(<List />);
		expect(screen.getByTestId("no-issues")).toBeTruthy();
	});

	test("a validation error reads as words, and its layer link selects the layer", async () => {
		const { controller, user } = mount(<List />);
		breakText(controller);
		const list = screen.getByRole("region", { name: "Validation" });
		expect(
			within(list).getByText("Uses {{nope}}, which isn't a field"),
		).toBeTruthy();
		// The code and the path stay in the tooltip, not the text.
		expect(within(list).queryByText(/unknown_field_reference/)).toBeNull();
		const entry = within(list).getByRole("listitem");
		expect(entry.title.split("\n").slice(0, 2)).toEqual([
			"unknown_field_reference",
			"/template_data/0/elements/1/properties/children/1/properties/value",
		]);
		const path = within(list).getByTestId("issue-path");
		// The fixture has two sides, so the link names the side too.
		expect(path.textContent).toBe(`front · ${LAYER}`);
		expect(path.getAttribute("aria-label")).toBe(`Select front · ${LAYER}`);
		await user.click(path);
		expect(controller.state.selection).toEqual(["0/1/1"]);
	});

	test("with one side, the layer link is the layer's name alone", () => {
		const one = doc();
		one.template_data = one.template_data.slice(0, 1);
		const { controller } = mount(<List />, one);
		breakText(controller);
		expect(screen.getByTestId("issue-path").textContent).toBe(LAYER);
	});

	test("file warnings, paint warnings and load notices", () => {
		const base = doc();
		base.warnings = [
			{ severity: "warn", code: "lossy_blend", message: "Blend dropped" },
		];
		const controller = new EditorController();
		controller.dispatch({
			type: "open",
			template: base,
			fileName: "doc.coat",
			notices: ["Renamed duplicate layer ids"],
		});
		controller.dispatch({
			type: "rendered",
			geometry: new Map(),
			timings: {} as never,
			stats: {} as never,
			warnings: ["Font failed to load: Inter"],
		});
		render(
			<ControllerProvider controller={controller}>
				<List />
			</ControllerProvider>,
		);
		expect(screen.getByText("Blend dropped")).toBeTruthy();
		expect(screen.getByText("Font failed to load: Inter")).toBeTruthy();
		expect(screen.getByText("Renamed duplicate layer ids")).toBeTruthy();
	});
});

describe("the status bar popover", () => {
	const badge = () => screen.getByTestId("issues-badge");

	test("no issues", async () => {
		const { user } = mount(<IssuesPopover />);
		expect(badge().getAttribute("aria-label")).toBe("No issues");
		await user.click(badge());
		expect(
			within(screen.getByTestId("issues-popover")).getByTestId("no-issues"),
		).toBeTruthy();
	});

	test("counts what the list counts, not the hints", () => {
		const base = doc();
		base.product = "card_cr80"; // print hints, which are not counted
		base.warnings = [
			{ severity: "warn", code: "lossy_blend", message: "Blend dropped" },
		];
		base.variants = [
			...(base.variants ?? []),
			{
				id: "stale",
				label: "Stale",
				overrides: [
					{
						name: "front",
						elements: [{ id: "gone", properties: {}, opacity: 0.5 }],
					},
				],
			},
		];
		const { controller } = mount(<IssuesPopover />, base);
		breakText(controller);
		// one validation error, one file warning, one variant change to a
		// layer that is gone
		expect(badge().getAttribute("aria-label")).toBe("3 issues");
		expect(badge().textContent).toBe("3");
	});

	test("opens the list, and following a link closes it", async () => {
		const { controller, user } = mount(<IssuesPopover />);
		breakText(controller);
		expect(badge().getAttribute("aria-label")).toBe("1 issue");
		await user.click(badge());
		const popover = screen.getByTestId("issues-popover");
		await user.click(within(popover).getByTestId("issue-path"));
		expect(controller.state.selection).toEqual(["0/1/1"]);
		expect(screen.queryByTestId("issues-popover")).toBeNull();
	});

	test("a save that fails validation opens it", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const { controller } = mount(<IssuesPopover />);
		breakText(controller);
		expect(screen.queryByTestId("issues-popover")).toBeNull();
		await act(async () => {
			expect(await controller.save("json")).toBe(false);
		});
		expect(save).not.toHaveBeenCalled();
		expect(screen.getByTestId("issues-popover")).toBeTruthy();
		expect(controller.state.rightTab).toBe("design");
	});

	test("so does a workspace save that fails validation", async () => {
		const { controller } = mount(<IssuesPopover />);
		breakText(controller);
		await act(async () => {
			expect(await controller.saveWorkspace()).toBe(false);
		});
		expect(screen.getByTestId("issues-popover")).toBeTruthy();
	});
});
