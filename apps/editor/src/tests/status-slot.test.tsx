import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { Slot } from "~/app/status/Slot";
import type { StatusItem } from "~/app/status/types";
import { doc } from "./doc-fixture";

afterEach(cleanup);

function item(
	id: string,
	align: StatusItem["align"],
	priority: number,
	when?: StatusItem["when"],
): StatusItem {
	return {
		id,
		name: id,
		sections: "all",
		align,
		priority,
		when,
		component: () => <span data-testid="item">{id}</span>,
	};
}

function shown(): string[] {
	return screen.queryAllByTestId("item").map((e) => e.textContent ?? "");
}

function mount(items: StatusItem[], align: StatusItem["align"]) {
	const c = new EditorController();
	c.open(doc(), "doc.coat");
	render(
		<ControllerProvider controller={c}>
			<Slot items={items} align={align} />
		</ControllerProvider>,
	);
	return c;
}

describe("status slot", () => {
	const items = [
		item("low", "start", 1),
		item("end-low", "end", 1),
		item("high", "start", 9),
		item("end-high", "end", 9),
		item("mid", "start", 5),
	];

	it("puts the highest priority first at the start", () => {
		mount(items, "start");
		expect(shown()).toEqual(["high", "mid", "low"]);
	});

	it("puts the highest priority last at the end", () => {
		mount(items, "end");
		expect(shown()).toEqual(["end-low", "end-high"]);
	});

	it("mounts an item only while its when holds", () => {
		const c = mount(
			[
				item("a", "start", 2),
				item("b", "start", 1, (s) => s.selection.length > 0),
			],
			"start",
		);
		expect(shown()).toEqual(["a"]);
		act(() => c.dispatch({ type: "select", keys: ["0/0"] }));
		expect(shown()).toEqual(["a", "b"]);
		act(() => c.dispatch({ type: "select", keys: [] }));
		expect(shown()).toEqual(["a"]);
	});
});
