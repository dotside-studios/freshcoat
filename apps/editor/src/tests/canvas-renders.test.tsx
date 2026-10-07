import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { FunctionComponent } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { Viewport } from "~/canvas/Viewport";
import { doc, geometryOf } from "./doc-fixture";

const renders = vi.hoisted(() => ({ Rulers: 0, Guides: 0 }));

type Memo = { type: FunctionComponent };

function counted<T>(name: keyof typeof renders, component: T): T {
	const memo = component as Memo;
	if (typeof memo.type !== "function") throw new Error(`${name} isn't memo`);
	const inner = memo.type;
	return {
		...memo,
		type: (props: object) => {
			renders[name]++;
			return inner(props);
		},
	} as T;
}

vi.mock("~/canvas/Rulers", async (load) => {
	const m = await load<typeof import("~/canvas/Rulers")>();
	return { ...m, Rulers: counted("Rulers", m.Rulers) };
});
vi.mock("~/canvas/Guides", async (load) => {
	const m = await load<typeof import("~/canvas/Guides")>();
	return { ...m, Guides: counted("Guides", m.Guides) };
});
vi.mock("~/canvas/use-live-render", () => ({
	useLiveRender: () => ({ canvas: null, scale: 1, fontsLoading: false }),
}));

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		disconnect() {}
	},
);

afterEach(cleanup);

beforeEach(() => {
	renders.Rulers = 0;
	renders.Guides = 0;
});

function mount() {
	const t = doc();
	const c = new EditorController();
	c.open(t, "doc.coat");
	const geometry = geometryOf(t);
	c.dispatch({
		type: "rendered",
		geometry,
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	c.dispatch({ type: "setRulers", on: true });
	c.addGuide("x", 100);
	c.setViewportSize(1200, 800);
	c.setView({ x: 0, y: 0, zoom: 1 });
	render(
		<ControllerProvider controller={c}>
			<Viewport />
		</ControllerProvider>,
	);
	return { c, geometry };
}

function drag(from: { x: number; y: number }, steps: number) {
	const viewport = screen.getByTestId("viewport");
	fireEvent.pointerDown(viewport, {
		pointerId: 1,
		button: 0,
		pointerType: "mouse",
		clientX: from.x,
		clientY: from.y,
	});
	for (let i = 1; i <= steps; i++)
		fireEvent.pointerMove(viewport, {
			pointerId: 1,
			pointerType: "mouse",
			clientX: from.x + i * 10,
			clientY: from.y + i * 5,
		});
}

function snapshot() {
	return { ...renders };
}

describe("canvas renders on pointermove", () => {
	test("moving a layer leaves rulers and guides alone", () => {
		const { c, geometry } = mount();
		const [key, box] = [...geometry].find(
			([k, g]) => !k.endsWith("/bg") && g.parentKey === null,
		) as [string, { rect: { x: number; y: number; width: number } }];
		const at = { x: box.rect.x + 2, y: box.rect.y + 2 };
		const before = snapshot();
		expect(Object.values(before).every((n) => n > 0)).toBe(true);
		drag(at, 5);
		expect(c.state.doc?.history.tx).toBeDefined();
		expect(c.state.selection).toContain(key);
		expect(renders).toEqual(before);
	});

	test("drawing a shape leaves rulers and guides alone", () => {
		const { c } = mount();
		act(() => c.dispatch({ type: "setTool", tool: "rect" }));
		const before = snapshot();
		drag({ x: 900, y: 500 }, 5);
		expect(renders).toEqual(before);
	});

	test("the pen's rubber band leaves them alone", () => {
		const { c } = mount();
		act(() => c.dispatch({ type: "setTool", tool: "pen" }));
		const viewport = screen.getByTestId("viewport");
		fireEvent.pointerDown(viewport, {
			pointerId: 1,
			button: 0,
			clientX: 10,
			clientY: 10,
		});
		fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 10, clientY: 10 });
		const before = snapshot();
		for (let i = 1; i <= 5; i++)
			fireEvent.pointerMove(viewport, {
				pointerId: 1,
				clientX: 10 + i * 20,
				clientY: 10,
			});
		expect(screen.getByTestId("pen-draft")).toBeTruthy();
		expect(renders).toEqual(before);
	});
});
