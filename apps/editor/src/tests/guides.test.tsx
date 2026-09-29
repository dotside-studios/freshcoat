import type { Template } from "@freshcoat-js/coatfile";
import type { Workspace } from "@freshcoat-js/workspace";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { COMMAND_BY_ID } from "~/app/commands";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { Guides } from "~/canvas/Guides";
import { Rulers } from "~/canvas/Rulers";
import { snapCandidates, snapMove } from "~/doc/geometry";
import {
	addGuide,
	clearGuides,
	guidesForSides,
	hasGuides,
	moveGuide,
	NO_GUIDES,
	removeGuide,
} from "~/doc/guides";
import {
	commit,
	commitGuides,
	createHistory,
	end,
	preview,
	redo,
	undo,
} from "~/doc/history";
import { addSide, removeSide, setFrameProp } from "~/doc/ops";
import { isDirty } from "~/state/store";
import { workspaceSnapshot } from "~/state/workspace";
import { doc, geometryOf } from "./doc-fixture";

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

afterEach(cleanup);

describe("guide operations", () => {
	test("add, move and remove by side and axis", () => {
		const a = addGuide(NO_GUIDES, "front", "x", 12.345);
		expect(a.index).toBe(0);
		expect(a.guides).toEqual({ front: { x: [12.35], y: [] } });
		const b = addGuide(a.guides, "front", "y", 40);
		const c = moveGuide(b.guides, "front", "x", 0, 20);
		expect(c).toEqual({ front: { x: [20], y: [40] } });
		expect(moveGuide(c, "front", "x", 0, 20)).toBe(c);
		expect(moveGuide(c, "front", "x", 5, 20)).toBe(c);
		expect(removeGuide(c, "front", "x", 3)).toBe(c);
		const d = removeGuide(removeGuide(c, "front", "x", 0), "front", "y", 0);
		expect(d).toEqual({});
		expect(hasGuides(d)).toBe(false);
		expect(clearGuides(c, "front")).toEqual({});
		expect(clearGuides(c, "back")).toBe(c);
	});

	test("follow a renamed side and leave with a removed one", () => {
		const g = { front: { x: [1], y: [] }, back: { x: [], y: [2] } };
		expect(guidesForSides(g, ["front", "back"], ["face", "back"])).toEqual({
			face: { x: [1], y: [] },
			back: { x: [], y: [2] },
		});
		expect(guidesForSides(g, ["front", "back"], ["front"])).toEqual({
			front: { x: [1], y: [] },
		});
		expect(guidesForSides(g, ["front", "back"], ["back", "front"])).toBe(g);
	});
});

describe("guide history", () => {
	test("guides and the template undo in one timeline", () => {
		const t = doc();
		const t2 = { ...t, name: "Two" };
		const g = addGuide(NO_GUIDES, "front", "x", 10).guides;
		let h = createHistory(t);
		h = commitGuides(h, g);
		h = commit(h, t2);
		expect(h.past).toHaveLength(2);
		h = undo(h);
		expect(h.present).toBe(t);
		expect(h.guides).toBe(g);
		h = undo(h);
		expect(h.guides).toBe(NO_GUIDES);
		h = redo(redo(h));
		expect(h.present).toBe(t2);
		expect(h.guides).toBe(g);
	});

	test("a drag previews guides and ends as one step", () => {
		const t = doc();
		let h = createHistory(t);
		const g1 = addGuide(NO_GUIDES, "front", "y", 5).guides;
		const g2 = moveGuide(g1, "front", "y", 0, 50);
		h = preview(h, t, g1);
		h = preview(h, t, g2);
		h = end(h);
		expect(h.past).toHaveLength(1);
		expect(h.guides).toBe(g2);
		expect(undo(h).guides).toBe(NO_GUIDES);
		expect(end(preview(h, t, g2))).toMatchObject({ past: h.past });
	});

	test("commits of the same guide merge within a second", () => {
		const t = doc();
		let h = createHistory(t);
		const g = addGuide(NO_GUIDES, "front", "x", 0).guides;
		h = commitGuides(h, g);
		h = commitGuides(h, moveGuide(g, "front", "x", 0, 1), {
			mergeKey: "k",
			now: 0,
		});
		h = commitGuides(h, moveGuide(g, "front", "x", 0, 2), {
			mergeKey: "k",
			now: 500,
		});
		expect(h.past).toHaveLength(2);
		expect(h.guides.front?.x).toEqual([2]);
	});
});

describe("guides in the editor", () => {
	test("each side keeps its own guides, and undo takes them back", () => {
		const c = open();
		c.addGuide("x", 100);
		c.addGuide("y", 40);
		expect(c.sideGuides()).toEqual({ x: [100], y: [40] });
		c.dispatch({ type: "setSide", side: 1 });
		expect(c.sideGuides()).toEqual({ x: [], y: [] });
		c.addGuide("x", 7);
		c.dispatch({ type: "setSide", side: 0 });
		expect(c.sideGuides()).toEqual({ x: [100], y: [40] });
		c.undo();
		c.dispatch({ type: "setSide", side: 1 });
		expect(c.sideGuides()).toEqual({ x: [], y: [] });
		c.dispatch({ type: "setSide", side: 0 });
		c.moveGuide("x", 0, 120);
		c.removeGuide("y", 0);
		expect(c.sideGuides()).toEqual({ x: [120], y: [] });
		c.undo();
		c.undo();
		expect(c.sideGuides()).toEqual({ x: [100], y: [40] });
	});

	test("a renamed side keeps its guides, in the same undo step", () => {
		const c = open();
		c.addGuide("x", 10);
		c.edit((t) => setFrameProp(t, 0, { name: "face" }), { scope: "base" });
		expect(c.state.doc?.history.guides).toEqual({ face: { x: [10], y: [] } });
		c.undo();
		expect(c.state.doc?.history.guides).toEqual({ front: { x: [10], y: [] } });
		c.edit((t) => removeSide(t, 0), { scope: "base" });
		expect(c.state.doc?.history.guides).toEqual({});
		c.edit((t) => addSide(t, "extra"), { scope: "base" });
		c.undo();
		c.undo();
		expect(c.state.doc?.history.guides).toEqual({ front: { x: [10], y: [] } });
	});

	test("layers snap to guides", () => {
		const candidates = snapCandidates(new Map(), doc(), [], new Set(), {
			x: [333],
			y: [],
		});
		const snap = snapMove(
			{ x: 330, y: 200, width: 20, height: 20, rotation: 0 },
			candidates,
			6,
		);
		expect(snap.dx).toBe(3);
		expect(snap.guides[0]).toMatchObject({ x1: 333, x2: 333 });
	});

	test("are saved in the workspace, not the template, and mark it unsaved", () => {
		const c = open();
		expect(isDirty(c.state)).toBe(false);
		const template = c.base;
		c.addGuide("y", 25);
		expect(c.base).toBe(template);
		expect(isDirty(c.state)).toBe(true);
		const snap = workspaceSnapshot(c.state) as Workspace;
		expect(snap.templates[0]?.guides).toEqual({ front: { x: [], y: [25] } });
		expect(snap.templates[0]?.template).toBe(template);
		c.undo();
		expect(isDirty(c.state)).toBe(false);
		expect(workspaceSnapshot(c.state)?.templates[0]).not.toHaveProperty(
			"guides",
		);
	});

	test("open with a workspace and survive switching templates", () => {
		const c = new EditorController();
		const guides = { front: { x: [5], y: [] } };
		c.openWorkspace(
			{
				formatVersion: "1.0",
				name: "W",
				templates: [
					{ id: "t_a", fileName: "a.coat", template: doc(), guides },
					{ id: "t_b", fileName: "b.coat", template: doc() },
				],
				datasets: [],
				presets: [],
			},
			"w.coatworkspace",
		);
		expect(c.sideGuides()).toEqual({ x: [5], y: [] });
		expect(isDirty(c.state)).toBe(false);
		c.switchTemplate("t_b");
		expect(c.sideGuides()).toEqual({ x: [], y: [] });
		expect(workspaceSnapshot(c.state)?.templates[0]?.guides).toBe(guides);
		c.switchTemplate("t_a");
		expect(c.sideGuides()).toEqual({ x: [5], y: [] });
		expect(isDirty(c.state)).toBe(false);
	});

	test("Remove guides clears the side as one step", () => {
		const c = open();
		const cmd = COMMAND_BY_ID.get("view.clearGuides");
		expect(cmd?.enabled?.(c.state)).toBe(false);
		c.addGuide("x", 1);
		c.addGuide("y", 2);
		expect(cmd?.enabled?.(c.state)).toBe(true);
		void cmd?.run({ controller: c } as never);
		expect(c.sideGuides()).toEqual({ x: [], y: [] });
		c.undo();
		expect(c.sideGuides()).toEqual({ x: [1], y: [2] });
	});
});

describe("guides on the canvas", () => {
	function mount(c: EditorController) {
		c.dispatch({ type: "setRulers", on: true });
		return render(
			<ControllerProvider controller={c}>
				<div data-testid="viewport">
					<Guides />
					<Rulers />
				</div>
			</ControllerProvider>,
		);
	}

	test("rulers are buttons that add a guide with the keyboard", async () => {
		const c = open();
		c.setViewportSize(800, 600);
		c.setView({ x: 0, y: 0, zoom: 1 });
		mount(c);
		const top = screen.getByRole("button", { name: "Add horizontal guide" });
		const left = screen.getByRole("button", { name: "Add vertical guide" });
		fireEvent.keyDown(top, { key: "Enter" });
		fireEvent.keyDown(left, { key: " " });
		expect(c.sideGuides()).toEqual({ x: [400], y: [300] });
		const guide = screen.getByRole("slider", { name: "Horizontal guide" });
		expect(guide.getAttribute("aria-valuenow")).toBe("300");
		expect(screen.getByRole("slider", { name: "Vertical guide" })).toBeTruthy();
	});

	test("arrow keys move a guide and Delete removes it", () => {
		const c = open();
		c.addGuide("x", 100);
		c.setView({ x: 10, y: 0, zoom: 2 });
		mount(c);
		const guide = screen.getByRole("slider", { name: "Vertical guide" });
		expect(guide.style.left).toBe(`${10 + 100 * 2 - 3}px`);
		fireEvent.keyDown(guide, { key: "ArrowRight" });
		fireEvent.keyDown(guide, { key: "ArrowRight", shiftKey: true });
		fireEvent.keyDown(guide, { key: "ArrowLeft" });
		expect(c.sideGuides().x).toEqual([110]);
		expect(c.state.doc?.history.past).toHaveLength(2);
		fireEvent.keyDown(screen.getByRole("slider"), { key: "Delete" });
		expect(c.sideGuides().x).toEqual([]);
		expect(screen.queryByRole("slider")).toBeNull();
		expect(document.activeElement?.getAttribute("aria-label")).toBe(
			"Add vertical guide",
		);
	});

	test("dragging from a ruler adds a guide, and back onto it removes it", () => {
		const c = open();
		c.setView({ x: 0, y: 0, zoom: 1 });
		mount(c);
		const top = screen.getByRole("button", { name: "Add horizontal guide" });
		act(() => {
			fireEvent.pointerDown(top, { button: 0, clientX: 50, clientY: 5 });
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: 50, clientY: 80 }),
			);
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: 50, clientY: 120 }),
			);
			window.dispatchEvent(
				new MouseEvent("pointerup", { clientX: 50, clientY: 120 }),
			);
		});
		expect(c.sideGuides().y).toEqual([120]);
		expect(c.state.doc?.history.past).toHaveLength(1);

		const guide = screen.getByRole("slider", { name: "Horizontal guide" });
		act(() => {
			fireEvent.pointerDown(guide, { button: 0, clientX: 50, clientY: 120 });
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: 50, clientY: 8 }),
			);
			window.dispatchEvent(
				new MouseEvent("pointerup", { clientX: 50, clientY: 8 }),
			);
		});
		expect(c.sideGuides().y).toEqual([]);
		expect(c.state.doc?.history.past).toHaveLength(2);
		c.undo();
		expect(c.sideGuides().y).toEqual([120]);
	});

	test("a click on a ruler or a drag Esc cancels adds nothing", () => {
		const c = open();
		mount(c);
		const left = screen.getByRole("button", { name: "Add vertical guide" });
		act(() => {
			fireEvent.pointerDown(left, { button: 0, clientX: 5, clientY: 50 });
			window.dispatchEvent(
				new MouseEvent("pointerup", { clientX: 5, clientY: 50 }),
			);
		});
		act(() => {
			fireEvent.pointerDown(left, { button: 0, clientX: 5, clientY: 50 });
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: 90, clientY: 50 }),
			);
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(c.sideGuides().x).toEqual([]);
		expect(c.state.doc?.history.past).toHaveLength(0);
		expect(c.state.doc?.history.tx).toBeUndefined();
	});
});
