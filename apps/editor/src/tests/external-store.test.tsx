import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createExternalStore } from "~/state/external-store";

afterEach(cleanup);

describe("createExternalStore", () => {
	test("set takes a value or an updater and notifies subscribers", () => {
		const store = createExternalStore(1);
		const listener = vi.fn();
		store.subscribe(listener);
		store.set(2);
		store.set((n) => n * 10);
		expect(store.get()).toBe(20);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	test("setting an equal value does not notify", () => {
		const value = { a: 1 };
		const store = createExternalStore(value);
		const listener = vi.fn();
		store.subscribe(listener);
		store.set(value);
		store.set((v) => v);
		expect(listener).not.toHaveBeenCalled();
	});

	test("an unsubscribed listener is not called", () => {
		const store = createExternalStore("a");
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);
		unsubscribe();
		store.set("b");
		expect(listener).not.toHaveBeenCalled();
	});

	test("a function initial value is read lazily, once", () => {
		const load = vi.fn(() => 5);
		const store = createExternalStore(load);
		expect(load).not.toHaveBeenCalled();
		expect(store.get()).toBe(5);
		expect(store.get()).toBe(5);
		expect(load).toHaveBeenCalledTimes(1);
	});

	test("a late subscriber reads the current value", () => {
		const store = createExternalStore(0);
		store.set(3);
		function Show() {
			return <span>{store.useStore()}</span>;
		}
		render(<Show />);
		expect(screen.getByText("3")).toBeTruthy();
		act(() => store.set(4));
		expect(screen.getByText("4")).toBeTruthy();
	});

	test("a selector re-renders only when its slice changes", () => {
		const store = createExternalStore({ a: 1, b: 1 });
		let renders = 0;
		function Show() {
			renders++;
			return <span>{store.useStore((s) => s.a)}</span>;
		}
		render(<Show />);
		act(() => store.set((s) => ({ ...s, b: 2 })));
		expect(renders).toBe(1);
		act(() => store.set((s) => ({ ...s, a: 2 })));
		expect(renders).toBe(2);
		expect(screen.getByText("2")).toBeTruthy();
	});
});
