import type { Template } from "@freshcoat/coatfile";
import type { Binding, Dataset } from "@freshcoat/workspace";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent, {
	PointerEventsCheckLevel,
} from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { BindingEditor, TemplateBindingEditor } from "~/binding/BindingEditor";
import { chooseOption } from "./aria";
import { doc } from "./doc-fixture";

beforeAll(() => {
	// jsdom has no CSS.escape, which react-aria uses to find items by key.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

afterEach(cleanup);

const people: Dataset = {
	id: "d_people",
	name: "People",
	columns: [
		{ key: "name", type: "text" },
		{ key: "job", type: "text" },
		{ key: "look", type: "text" },
	],
	records: [],
	assets: [],
};

function template(): Template {
	return {
		...doc(),
		variants: [{ id: "dark", label: "Dark", overrides: [] }],
	} as Template;
}

function Harness({
	initial,
	log,
}: {
	initial?: Binding;
	log: (Binding | undefined)[];
}) {
	const [binding, setBinding] = useState<Binding | undefined>(initial);
	return (
		<BindingEditor
			template={template()}
			binding={binding}
			datasets={[people]}
			onChange={(next) => {
				log.push(next);
				setBinding(next);
			}}
		/>
	);
}

function setup(initial?: Binding) {
	const log: (Binding | undefined)[] = [];
	render(<Harness initial={initial} log={log} />);
	return {
		log,
		// jsdom has none of the app's CSS, so checking `pointer-events` up the
		// tree on every click only costs time.
		user: userEvent.setup({
			pointerEventsCheck: PointerEventsCheckLevel.Never,
		}),
		last: () => log.at(-1),
	};
}

function choose(
	user: ReturnType<typeof userEvent.setup>,
	trigger: RegExp,
	option: string,
) {
	// By label rather than by role: see chooseOption.
	const button = screen.getByLabelText(trigger, { selector: "button" });
	return chooseOption(user, button, option);
}

/** A binding with no dataset that only picks the variant. */
const unboundDark: Binding = {
	datasetId: "",
	fields: {},
	variant: { kind: "fixed", id: "dark" },
};

const bound: Binding = {
	datasetId: "d_people",
	fields: { name: { kind: "column", column: "name" } },
};

describe("binding editor", () => {
	test("choosing a dataset binds matching fields", async () => {
		const { user, last } = setup();
		expect(screen.getByText(/Not bound/)).toBeTruthy();
		await choose(user, /Dataset/, "People");
		expect(last()).toEqual(bound);
	});

	test("choosing None removes the binding", async () => {
		const { user, log } = setup(bound);
		await choose(user, /Dataset/, "None (use defaults)");
		expect(log).toEqual([undefined]);
	});

	test("a column source names the chosen column", async () => {
		const { user, last } = setup(bound);
		await choose(user, /Column for name/, "job");
		expect(last()?.fields.name).toEqual({ kind: "column", column: "job" });
	});

	test("a constant source holds what is typed", async () => {
		const { user, last } = setup(bound);
		await choose(user, /Source for title/, "Fixed");
		expect(last()?.fields.title).toEqual({ kind: "constant", value: "" });
		await user.type(
			screen.getByRole("textbox", { name: "Fixed value for title" }),
			"Dr",
		);
		expect(last()?.fields.title).toEqual({ kind: "constant", value: "Dr" });
	});

	test("a serial source takes start, step, padding, prefix and suffix", async () => {
		const { user, last } = setup(bound);
		await choose(user, /Source for title/, "Serial");
		expect(last()?.fields.title).toEqual({
			kind: "serial",
			start: 1,
			step: 1,
			pad: 4,
		});
		const start = screen.getByRole("spinbutton", {
			name: "Serial start for title",
		});
		await user.clear(start);
		await user.type(start, "100{Enter}");
		const step = screen.getByRole("spinbutton", {
			name: "Serial step for title",
		});
		await user.clear(step);
		await user.type(step, "5{Enter}");
		const pad = screen.getByRole("spinbutton", {
			name: "Serial padding for title",
		});
		await user.clear(pad);
		await user.type(pad, "6{Enter}");
		await user.type(
			screen.getByRole("textbox", { name: "Serial prefix for title" }),
			"A-",
		);
		await user.type(
			screen.getByRole("textbox", { name: "Serial suffix for title" }),
			"/x",
		);
		expect(last()?.fields.title).toEqual({
			kind: "serial",
			start: 100,
			step: 5,
			pad: 6,
			prefix: "A-",
			suffix: "/x",
		});
		expect(screen.getByText("A-000100/x, …")).toBeTruthy();
	});

	test("Default leaves the field out of the binding", async () => {
		const { user, last } = setup(bound);
		await choose(user, /Source for name/, "Default");
		expect(last()?.fields).toEqual({});
	});

	test("the variant comes from a fixed variant or a column", async () => {
		const { user, last } = setup(bound);
		await choose(user, /Variant source/, "Fixed");
		expect(last()?.variant).toEqual({ kind: "fixed", id: "dark" });
		await choose(user, /Fixed variant/, "Default");
		expect(last()?.variant).toEqual({ kind: "fixed" });
		await choose(user, /Variant source/, "Column");
		expect(last()?.variant).toEqual({ kind: "column", column: "name" });
		await choose(user, /Variant column/, "look");
		expect(last()?.variant).toEqual({ kind: "column", column: "look" });
		await choose(user, /Variant source/, "Default");
		expect(last()).not.toHaveProperty("variant");
	});

	test("All variants exports Default and every variant", async () => {
		const { user, last } = setup(bound);
		await choose(user, /Variant source/, "All variants");
		expect(last()?.variant).toEqual({ kind: "all" });
		// The fixture's one variant changes nothing, so it exports as Default.
		expect(screen.getByTestId("binding-variant-hint").textContent).toBe(
			"Default only, no variant changes anything",
		);
	});

	test("with no dataset, the variant choice has no Column", async () => {
		const { user } = setup();
		expect(screen.getByText(/Not bound/)).toBeTruthy();
		await user.click(
			screen.getByLabelText(/Variant source/, { selector: "button" }),
		);
		const options = screen.getAllByRole("option").map((o) => o.textContent);
		expect(options).toEqual(["Default", "Fixed", "All variants"]);
	});

	test("with no dataset, a variant choice is kept alone", async () => {
		const { user, last } = setup();
		await choose(user, /Variant source/, "All variants");
		expect(last()).toEqual({
			datasetId: "",
			fields: {},
			variant: { kind: "all" },
		});
		expect(screen.queryByText(/Dataset not found/)).toBeNull();
		expect(screen.queryByTestId("binding-field-name")).toBeNull();
		await choose(user, /Variant source/, "Fixed");
		await choose(user, /Fixed variant/, "Dark");
		expect(last()?.variant).toEqual({ kind: "fixed", id: "dark" });
	});

	test("a variant kept alone survives choosing and clearing a dataset", async () => {
		const { user, last } = setup(unboundDark);
		await choose(user, /Dataset/, "People");
		expect(last()).toEqual({
			...bound,
			variant: { kind: "fixed", id: "dark" },
		});
		await choose(user, /Dataset/, "None (use defaults)");
		expect(last()).toEqual(unboundDark);
	});

	test("with no dataset, choosing Default removes the binding", async () => {
		const { user, log } = setup(unboundDark);
		await choose(user, /Variant source/, "Default");
		expect(log).toEqual([undefined]);
	});

	test("required fields with no source are flagged", () => {
		setup({
			datasetId: "d_people",
			fields: { name: { kind: "column", column: "gone" } },
		});
		const name = screen.getByTestId("binding-field-name");
		expect(name.dataset.unmatched).toBe("true");
		expect(
			within(name).getByRole("img", { name: 'Required: no column "gone"' }),
		).toBeTruthy();
		expect(screen.getByTestId("binding-field-title").dataset.unmatched).toBe(
			"true",
		);
		expect(
			screen.getByTestId("binding-field-show").dataset.unmatched,
		).toBeUndefined();
	});
});

describe("template binding editor", () => {
	test("writes the binding to the template's slot", async () => {
		const controller = new EditorController();
		controller.dispatch({
			type: "open",
			template: doc(),
			fileName: "doc.coat",
		});
		controller.dispatch({ type: "datasetEdit", datasets: [people] });
		const id = controller.state.workspace?.activeTemplateId as string;
		render(
			<ControllerProvider controller={controller}>
				<TemplateBindingEditor templateId={id} />
			</ControllerProvider>,
		);
		const user = userEvent.setup();
		await choose(user, /Dataset/, "People");
		expect(controller.state.workspace?.templates[0]?.binding).toEqual(bound);
	});
});
