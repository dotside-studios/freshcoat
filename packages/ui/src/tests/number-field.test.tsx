import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { evaluateExpression, NumberField } from "../number-field";

describe("evaluateExpression", () => {
	it.each([
		["100+20", 120],
		["50*2", 100],
		["10/4", 2.5],
		["100 - 30", 70],
		["-(3+2)*2", -10],
		["2*-3", -6],
		["1.5+.5", 2],
		["2+3*4", 14],
		["(2+3)*4", 20],
		["+7", 7],
		["42", 42],
	])("%s = %s", (src, expected) => {
		expect(evaluateExpression(src)).toBe(expected);
	});

	it.each([
		"",
		"abc",
		"1+",
		"(1",
		"1)",
		"1/0",
		"2**3",
		"alert(1)",
		"1..2",
	])("rejects %j", (src) => {
		expect(evaluateExpression(src)).toBeNull();
	});
});

function Harness(props: {
	initial: number | null;
	onChange?: (v: number) => void;
	onCommit?: () => void;
	step?: number;
	unit?: string;
	min?: number;
	max?: number;
}) {
	const [value, setValue] = useState(props.initial);
	return (
		<NumberField
			label="X"
			value={value}
			step={props.step}
			unit={props.unit}
			min={props.min}
			max={props.max}
			onChange={(v) => {
				setValue(v);
				props.onChange?.(v);
			}}
			onCommit={props.onCommit}
		/>
	);
}

const handle = (container: HTMLElement) => {
	const el = container.querySelector("[data-scrub-handle]");
	if (!el) throw new Error("no scrub handle");
	return el;
};

describe("NumberField scrub", () => {
	it("changes by Δpx × step, commits once on release", () => {
		const onChange = vi.fn();
		const onCommit = vi.fn();
		const { container } = render(
			<Harness
				initial={100}
				step={2}
				onChange={onChange}
				onCommit={onCommit}
			/>,
		);
		const h = handle(container);
		fireEvent.pointerDown(h, { pointerId: 1, button: 0, clientX: 50 });
		fireEvent.pointerMove(h, { pointerId: 1, clientX: 60 });
		expect(onChange).toHaveBeenLastCalledWith(120);
		fireEvent.pointerMove(h, { pointerId: 1, clientX: 55 });
		expect(onChange).toHaveBeenLastCalledWith(110);
		expect(onCommit).not.toHaveBeenCalled();
		fireEvent.pointerUp(h, { pointerId: 1, clientX: 55 });
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("spinbutton")).toHaveProperty("value", "110");
	});

	it("multiplies by 10 with Shift and 0.1 with Alt", () => {
		const onChange = vi.fn();
		const { container } = render(<Harness initial={0} onChange={onChange} />);
		const h = handle(container);
		fireEvent.pointerDown(h, { pointerId: 1, button: 0, clientX: 0 });
		fireEvent.pointerMove(h, { pointerId: 1, clientX: 5, shiftKey: true });
		expect(onChange).toHaveBeenLastCalledWith(50);
		fireEvent.pointerMove(h, { pointerId: 1, clientX: 8, altKey: true });
		expect(onChange).toHaveBeenLastCalledWith(50.3);
		fireEvent.pointerUp(h, { pointerId: 1 });
	});

	it("clamps to min and max", () => {
		const onChange = vi.fn();
		const { container } = render(
			<Harness initial={95} max={100} min={0} onChange={onChange} />,
		);
		const h = handle(container);
		fireEvent.pointerDown(h, { pointerId: 1, button: 0, clientX: 0 });
		fireEvent.pointerMove(h, { pointerId: 1, clientX: 40 });
		expect(onChange).toHaveBeenLastCalledWith(100);
		fireEvent.pointerMove(h, { pointerId: 1, clientX: 35 });
		expect(onChange).toHaveBeenLastCalledWith(95);
		fireEvent.pointerUp(h, { pointerId: 1 });
	});

	it("ignores jitter below the threshold and focuses the input on click", () => {
		const onChange = vi.fn();
		const onCommit = vi.fn();
		const { container } = render(
			<Harness initial={10} onChange={onChange} onCommit={onCommit} />,
		);
		const h = handle(container);
		fireEvent.pointerDown(h, { pointerId: 1, button: 0, clientX: 0 });
		fireEvent.pointerMove(h, { pointerId: 1, clientX: 2 });
		fireEvent.pointerUp(h, { pointerId: 1, clientX: 2 });
		expect(onChange).not.toHaveBeenCalled();
		expect(onCommit).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(screen.getByRole("spinbutton"));
	});
});

describe("NumberField typing", () => {
	it("commits arithmetic on Enter", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const onCommit = vi.fn();
		render(<Harness initial={100} onChange={onChange} onCommit={onCommit} />);
		const input = screen.getByRole("spinbutton");
		await user.click(input);
		await user.clear(input);
		await user.type(input, "100+20{Enter}");
		expect(onChange).toHaveBeenCalledWith(120);
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(input).toHaveProperty("value", "120");
	});

	it("selects the value after Enter only while it still has focus", () => {
		// Blink's select() focuses the input, so a late one would pull focus back
		// from the next field.
		const frames: FrameRequestCallback[] = [];
		const raf = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((cb) => frames.push(cb));
		const select = vi.spyOn(HTMLInputElement.prototype, "select");
		render(
			<>
				<Harness initial={1} />
				<input aria-label="next" />
			</>,
		);
		const input = screen.getByRole("spinbutton");
		const next = screen.getByLabelText("next");
		act(() => input.focus());
		select.mockClear();
		fireEvent.change(input, { target: { value: "2" } });
		fireEvent.keyDown(input, { key: "Enter" });
		act(() => next.focus());
		for (const frame of frames.splice(0)) frame(0);
		expect(select).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(next);

		act(() => input.focus());
		select.mockClear();
		fireEvent.keyDown(input, { key: "Enter" });
		for (const frame of frames.splice(0)) frame(0);
		expect(select).toHaveBeenCalledTimes(1);
		raf.mockRestore();
		select.mockRestore();
	});

	it("reverts on Escape", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={100} onChange={onChange} />);
		const input = screen.getByRole("spinbutton");
		await user.click(input);
		await user.clear(input);
		await user.type(input, "999");
		expect(input).toHaveProperty("value", "999");
		await user.keyboard("{Escape}");
		expect(input).toHaveProperty("value", "100");
		await user.tab();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("commits on blur, and reverts an unparseable entry", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={5} onChange={onChange} />);
		const input = screen.getByRole("spinbutton");
		await user.click(input);
		await user.clear(input);
		await user.type(input, "50*2");
		await user.tab();
		expect(onChange).toHaveBeenLastCalledWith(100);
		await user.click(input);
		await user.clear(input);
		await user.type(input, "nope");
		await user.tab();
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(input).toHaveProperty("value", "100");
	});

	it("steps with arrows, ×10 with Shift", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={1} onChange={onChange} />);
		const input = screen.getByRole("spinbutton");
		await user.click(input);
		await user.keyboard("{ArrowUp}");
		expect(onChange).toHaveBeenLastCalledWith(2);
		await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
		expect(onChange).toHaveBeenLastCalledWith(-8);
	});

	it("shows the unit and ignores a typed copy of it", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={45} unit="°" onChange={onChange} />);
		const input = screen.getByRole("spinbutton");
		expect(input).toHaveProperty("value", "45°");
		await user.click(input);
		await user.clear(input);
		await user.type(input, "90°{Enter}");
		expect(onChange).toHaveBeenLastCalledWith(90);
	});

	it("renders null as Mixed", () => {
		render(<Harness initial={null} />);
		const input = screen.getByRole("spinbutton");
		expect(input).toHaveProperty("value", "");
		expect(input.getAttribute("placeholder")).toBe("Mixed");
		expect(input.getAttribute("aria-valuetext")).toBe("Mixed");
		act(() => {});
	});
});
