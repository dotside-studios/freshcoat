import type { Template, TextElement } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { TextEditor } from "~/canvas/TextEditor";
import { updateElement } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { doc, geometryOf } from "./doc-fixture";

const T1 = "0/1/1";

function open(t: Template = doc()) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	return c;
}

const value = (c: EditorController, key = T1) =>
	(getElement(c.template as Template, key) as TextElement).properties.value;

afterEach(cleanup);

describe("editing text on the canvas", () => {
	it("records the whole edit as one undo step", () => {
		const c = open();
		expect(c.beginTextEdit(T1)).toBe(true);
		expect(c.state.textEdit).toBe(T1);
		expect(c.state.selection).toEqual([T1]);
		c.setEditedText("H");
		c.setEditedText("Hello {{ name }}");
		c.setEditedText("Hello there {{ name }}");
		c.endTextEdit();
		expect(c.state.textEdit).toBeNull();
		expect(value(c)).toBe("Hello there {{ name }}");
		expect(c.state.doc?.history.past).toHaveLength(1);
		expect(validate(c.template as Template).ok).toBe(true);
		c.undo();
		expect(value(c)).toBe("Hi {{ name }}");
	});

	it("leaves no undo step when the text ends as it began", () => {
		const c = open();
		c.beginTextEdit(T1);
		c.setEditedText("Something else");
		c.setEditedText("Hi {{ name }}");
		c.endTextEdit();
		expect(c.state.doc?.history.past).toHaveLength(0);
	});

	it("edits the raw template text while a record preview fills the fields", () => {
		const c = open();
		c.dispatch({ type: "setValue", field: "name", value: "Grace" });
		c.beginTextEdit(T1);
		c.setEditedText("Dear {{ name }}");
		c.endTextEdit();
		expect(value(c)).toBe("Dear {{ name }}");
	});

	it("declines mixed-style text, which the inspector edits", () => {
		const t = doc();
		const r = updateElement(t, T1, {
			properties: { spans: [{ text: "Hi " }, { text: "there" }] },
		});
		if (!r.ok) throw new Error(r.reason);
		const c = open(r.template);
		expect(c.beginTextEdit(T1)).toBe(false);
		expect(c.beginTextEdit("0/0")).toBe(false);
		expect(c.state.textEdit).toBeNull();
	});
});

describe("TextEditor", () => {
	const mount = (c: EditorController) =>
		render(
			<ControllerProvider controller={c}>
				<TextEditor />
			</ControllerProvider>,
		);

	it("opens over the layer with its raw text, and Escape keeps the edit", () => {
		const c = open();
		mount(c);
		expect(screen.queryByLabelText("Edit text on canvas")).toBeNull();
		act(() => {
			c.beginTextEdit(T1);
		});
		const area = screen.getByLabelText(
			"Edit text on canvas",
		) as HTMLTextAreaElement;
		expect(area.value).toBe("Hi {{ name }}");
		expect(document.activeElement).toBe(area);
		act(() => {
			fireEvent.input(area, { target: { value: "Hi {{ name }}!" } });
		});
		expect(value(c)).toBe("Hi {{ name }}!");
		act(() => {
			fireEvent.keyDown(area, { key: "Escape" });
		});
		expect(c.state.textEdit).toBeNull();
		expect(screen.queryByLabelText("Edit text on canvas")).toBeNull();
		expect(value(c)).toBe("Hi {{ name }}!");
		expect(c.state.doc?.history.past).toHaveLength(1);
	});

	it("commits on blur", () => {
		const c = open();
		mount(c);
		act(() => {
			c.beginTextEdit(T1);
		});
		const area = screen.getByLabelText("Edit text on canvas");
		act(() => {
			fireEvent.input(area, { target: { value: "Bye" } });
			fireEvent.blur(area);
		});
		expect(c.state.textEdit).toBeNull();
		expect(value(c)).toBe("Bye");
	});

	it("keeps its keys from the editor's shortcuts", () => {
		const c = open();
		mount(c);
		act(() => {
			c.beginTextEdit(T1);
		});
		const seen: string[] = [];
		const listen = (e: KeyboardEvent) => seen.push(e.key);
		window.addEventListener("keydown", listen);
		fireEvent.keyDown(screen.getByLabelText("Edit text on canvas"), {
			key: "z",
			metaKey: true,
		});
		window.removeEventListener("keydown", listen);
		expect(seen).toEqual([]);
	});
});
