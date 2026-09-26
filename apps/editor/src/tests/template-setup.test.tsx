import type { Template } from "@freshcoat/coatfile";
import {
	act,
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import {
	COMMAND_BY_ID,
	type CommandContext,
	findCommand,
} from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import * as download from "~/app/download";
import {
	TemplateSetupDialog,
	useTemplateSetup,
} from "~/app/TemplateSetupDialog";
import { newDocument } from "~/doc/new-document";
import { slugId } from "~/panels/setup/GeneralSection";
import { doc } from "./doc-fixture";

const fetches: string[] = [];

beforeEach(() => {
	// jsdom has no CSS.escape, which react-aria uses to find list items by key.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
	fetches.length = 0;
	vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
		const url = String(input);
		fetches.push(url);
		if (url.includes("family=Lobster:wght"))
			return new Response("@font-face { font-family: Lobster; }");
		if (url.includes("fonts.googleapis.com/css2"))
			return new Response("bad", { status: 400 });
		throw new Error("offline");
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** The dialog wired to the controller as the editor wires it. */
function Harness({
	controller,
	onReady,
}: {
	controller: EditorController;
	onReady?: (show: () => void) => void;
}) {
	const setup = useTemplateSetup(controller);
	onReady?.(setup.show);
	return <TemplateSetupDialog request={setup.request} onClose={setup.close} />;
}

function mount(template: Template = doc(), fileName = "doc.coat") {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template, fileName });
	let show = () => {};
	render(
		<ControllerProvider controller={controller}>
			<Harness
				controller={controller}
				onReady={(fn) => {
					show = fn;
				}}
			/>
		</ControllerProvider>,
	);
	const t = () => controller.template as Template;
	const past = () => controller.state.doc?.history.past.length ?? 0;
	return {
		controller,
		t,
		past,
		show: () => act(() => show()),
		user: userEvent.setup(),
	};
}

function setup(template: Template = doc()) {
	const m = mount(template);
	m.show();
	return m;
}

const dialog = () => screen.getByRole("dialog");

describe("Template setup", () => {
	test("opens from its command, with General, Size and Fonts", () => {
		const m = mount();
		const ctx = {
			controller: m.controller,
			showTemplateSetup: () => m.show(),
		} as unknown as CommandContext;
		void COMMAND_BY_ID.get("file.templateSetup")?.run(ctx);
		const d = dialog();
		expect(within(d).getByRole("heading", { level: 2 }).textContent).toBe(
			"Template setup",
		);
		for (const name of ["General", "Size", "Fonts"])
			expect(within(d).getByRole("region", { name })).toBeTruthy();
	});

	test("the command is File › Template setup… on Mod+Alt+,", () => {
		const command = COMMAND_BY_ID.get("file.templateSetup");
		expect(command?.label).toBe("Template setup…");
		expect(command?.group).toBe("File");
		// Alt+, types ≤ on a Mac, so the key is matched by its physical code.
		const key = {
			key: "≤",
			code: "Comma",
			metaKey: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: true,
		};
		expect(findCommand(key, true, false)?.id).toBe("file.templateSetup");
		expect(
			findCommand(
				{ ...key, key: ",", metaKey: false, ctrlKey: true },
				false,
				false,
			)?.id,
		).toBe("file.templateSetup");
	});

	test("Done and Escape close it", async () => {
		const { show, user } = setup();
		await user.click(within(dialog()).getByRole("button", { name: "Done" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		show();
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});

describe("General", () => {
	test("typing the name is one undo step", async () => {
		const { t, past, user } = setup();
		const name = screen.getByRole("textbox", { name: "Name" });
		await user.type(name, " card");
		expect(t().name).toBe("Doc card");
		expect(t().id).toBe("doc");
		expect(past()).toBe(1);
	});

	test("an empty name is not committed", async () => {
		const { t, user } = setup();
		const name = screen.getByRole("textbox", { name: "Name" });
		await user.clear(name);
		expect(t().name).toBe("Doc");
		expect(name.getAttribute("aria-invalid")).toBe("true");
		await user.tab();
		expect(name).toHaveProperty("value", "Doc");
	});

	test("an emptied version is removed", async () => {
		const base = doc();
		base.version = "2";
		const { t, user } = setup(base);
		await user.clear(screen.getByRole("textbox", { name: "Version" }));
		expect("version" in t()).toBe(false);
	});

	test("on an unnamed template the id follows the name until it is edited", async () => {
		const { t, past, user } = setup(newDocument({ width: 100, height: 100 }));
		const name = screen.getByRole("textbox", { name: "Name" });
		await user.clear(name);
		await user.type(name, "Spring Badge");
		expect([t().name, t().id]).toEqual(["Spring Badge", "spring-badge"]);
		expect(past()).toBe(1);
		const id = screen.getByRole("textbox", { name: "ID" });
		await user.clear(id);
		await user.type(id, "badge");
		await user.type(name, " 2");
		expect([t().name, t().id]).toEqual(["Spring Badge 2", "badge"]);
	});

	test("slugs", () => {
		expect(slugId("  Café Menu / 2026 ")).toBe("cafe-menu-2026");
		expect(slugId("!!!")).toBe("template");
	});
});

describe("Size", () => {
	test("resize, and resize with the ratio locked", async () => {
		const { t, user } = setup();
		const w = screen.getByRole("spinbutton", { name: "Template width" });
		await user.clear(w);
		await user.type(w, "500{Enter}");
		expect([t().width, t().height]).toEqual([500, 600]);
		expect(t().template_data[0]?.background.size).toEqual({
			width: 500,
			height: 600,
		});
		await user.click(screen.getByRole("button", { name: "Lock aspect ratio" }));
		await user.clear(w);
		await user.type(w, "250{Enter}");
		expect([t().width, t().height]).toEqual([250, 300]);
	});
});

describe("Fonts", () => {
	const saved = new Map<string, PropertyDescriptor | undefined>();
	beforeAll(() => {
		// jsdom lays nothing out; the picker's list needs a size to mount rows.
		for (const [prop, size] of [
			["offsetWidth", 300],
			["offsetHeight", 320],
		] as const) {
			saved.set(
				prop,
				Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop),
			);
			Object.defineProperty(HTMLElement.prototype, prop, {
				configurable: true,
				get: () => size,
			});
		}
	});
	afterAll(() => {
		for (const [prop, d] of saved)
			if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
	});

	test("lists the declared font and its status", async () => {
		setup();
		const row = screen.getByTestId("font-Inter");
		expect(within(row).getByText("google")).toBeTruthy();
		await waitFor(() => expect(within(row).getByText("missing")).toBeTruthy());
	});

	test("remove is refused while text uses the family", async () => {
		const { controller, t, user } = setup();
		await user.click(screen.getByRole("button", { name: "Remove font Inter" }));
		expect(t().fonts).toHaveLength(1);
		const chips = within(screen.getByRole("alert")).getAllByTestId(
			"reference-chip",
		);
		expect(chips.map((c) => c.textContent)).toEqual([
			"front · t1",
			"front · title",
		]);
		await user.click(chips[1] as HTMLElement);
		expect(controller.state.selection).toEqual(["0/4"]);
	});

	test("add a catalogue family from the picker, in one undo step", async () => {
		const { t, past, user } = setup();
		await user.click(screen.getByRole("button", { name: "Add font…" }));
		const search = await screen.findByRole("combobox", {
			name: "Search fonts",
		});
		await user.type(search, "Lobster");
		await screen.findByRole("option", { name: "Lobster" });
		await user.keyboard("{Enter}");
		await waitFor(() => expect(t().fonts).toHaveLength(2));
		// Lobster has only a regular weight, so bold resolves to it.
		expect(t().fonts?.[1]).toEqual({
			kind: "google",
			family: "Lobster",
			url: "https://fonts.googleapis.com/css2?family=Lobster:wght@400&display=swap",
		});
		expect(past()).toBe(1);
		expect(screen.queryByRole("combobox", { name: "Search fonts" })).toBeNull();
	});

	test("a name the catalogue lacks is looked up, and not added when Google has none", async () => {
		const { t, user } = setup();
		await user.click(screen.getByRole("button", { name: "Add font…" }));
		const search = await screen.findByRole("combobox", {
			name: "Search fonts",
		});
		await user.type(search, "Nopefont");
		await screen.findByRole("option", { name: /Look up “Nopefont”/ });
		await user.keyboard("{Enter}");
		await waitFor(() =>
			expect(fetches.filter((u) => u.includes("Nopefont"))).toHaveLength(2),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Add font…" }),
			).not.toHaveProperty("disabled", true),
		);
		expect(t().fonts).toHaveLength(1);
	});
});

describe("naming on first save", () => {
	const unnamed = () => newDocument({ width: 200, height: 100 });

	test("a .coat export of an unnamed template asks for a name, and Save saves it named", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const { controller, t, user } = mount(unnamed(), "Untitled.coat");
		let saving: Promise<boolean> | undefined;
		act(() => {
			saving = controller.save("coat");
		});
		const d = await screen.findByRole("dialog");
		expect(within(d).getByRole("heading", { level: 2 }).textContent).toBe(
			"Name this template",
		);
		expect(within(d).getByTestId("naming-file").textContent).toBe(
			"Untitled.coat has no name yet",
		);
		const name = within(d).getByRole("textbox", { name: "Name" });
		expect(document.activeElement).toBe(name);
		// The name starts selected, so typing replaces it.
		await user.keyboard("Spring badge");
		expect([t().name, t().id]).toEqual(["Spring badge", "spring-badge"]);
		expect(save).not.toHaveBeenCalled();
		await user.click(within(d).getByRole("button", { name: "Save" }));
		expect(await saving).toBe(true);
		expect(save).toHaveBeenCalledOnce();
		expect(save.mock.calls[0]?.[1]).toBe("spring-badge.coat");
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	test("Skip saves it unnamed", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const { controller, user } = mount(unnamed(), "Untitled.coat");
		let saving: Promise<boolean> | undefined;
		act(() => {
			saving = controller.save("json");
		});
		const d = await screen.findByRole("dialog");
		await user.click(within(d).getByRole("button", { name: "Skip" }));
		expect(await saving).toBe(true);
		expect(save.mock.calls[0]?.[1]).toBe("untitled.coat.json");
	});

	test("Escape cancels the save", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const { controller, user } = mount(unnamed(), "Untitled.coat");
		let saving: Promise<boolean> | undefined;
		act(() => {
			saving = controller.save("json");
		});
		await screen.findByRole("dialog");
		await user.keyboard("{Escape}");
		expect(await saving).toBe(false);
		expect(save).not.toHaveBeenCalled();
	});

	test("a named template saves without asking", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const { controller } = mount();
		expect(await controller.save("json")).toBe(true);
		expect(save).toHaveBeenCalledOnce();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	test("a workspace with two unnamed templates asks about each, showing it, then saves", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const { controller, user } = mount(doc(), "doc.coat");
		act(() => {
			controller.dispatch({
				type: "addTemplate",
				template: unnamed(),
				fileName: "Untitled.coat",
				id: "one",
			});
			controller.dispatch({
				type: "addTemplate",
				template: unnamed(),
				fileName: "Untitled 2.coat",
				id: "two",
			});
			controller.switchTemplate(
				controller.state.workspace?.templates[0]?.id as string,
			);
		});
		const first = controller.state.workspace?.activeTemplateId;
		let saving: Promise<boolean> | undefined;
		act(() => {
			saving = controller.saveWorkspace();
		});

		let d = await screen.findByRole("dialog");
		expect(within(d).getByTestId("naming-file").textContent).toBe(
			"Untitled.coat has no name yet",
		);
		expect(controller.state.workspace?.activeTemplateId).toBe("one");
		await user.keyboard("Front desk");
		await user.click(within(d).getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(screen.getByTestId("naming-file").textContent).toBe(
				"Untitled 2.coat has no name yet",
			),
		);
		d = screen.getByRole("dialog");
		expect(controller.state.workspace?.activeTemplateId).toBe("two");
		await user.click(within(d).getByRole("button", { name: "Skip" }));

		expect(await saving).toBe(true);
		expect(save).toHaveBeenCalledOnce();
		expect(controller.state.workspace?.activeTemplateId).toBe(first);
		const saved = controller.state.workspace?.saved.templates.map(
			(e) => e.template.id,
		);
		expect(saved).toEqual(["doc", "front-desk", "untitled"]);
	});

	test("dismissing the first of several prompts cancels the whole save", async () => {
		const save = vi.spyOn(download, "downloadBytes").mockResolvedValue();
		const { controller, user } = mount(unnamed(), "Untitled.coat");
		act(() => {
			controller.dispatch({
				type: "addTemplate",
				template: unnamed(),
				fileName: "Untitled 2.coat",
			});
		});
		let saving: Promise<boolean> | undefined;
		act(() => {
			saving = controller.saveWorkspace();
		});
		await screen.findByRole("dialog");
		await user.keyboard("{Escape}");
		expect(await saving).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
