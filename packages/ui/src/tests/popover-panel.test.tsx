import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../button";
import { PopoverPanel } from "../popover-panel";
import { SelectionBar } from "../selection-bar";

describe("PopoverPanel", () => {
	it("opens from its trigger and closes from the header", async () => {
		const user = userEvent.setup();
		render(
			<PopoverPanel trigger={<Button>Open</Button>} title="Gradient">
				<p>Stops</p>
			</PopoverPanel>,
		);
		expect(screen.queryByText("Stops")).toBeNull();
		await user.click(screen.getByRole("button", { name: "Open" }));
		expect(screen.getByRole("dialog", { name: "Gradient" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(screen.queryByText("Stops")).toBeNull();
	});
});

describe("SelectionBar", () => {
	it("renders only with a label and clears", async () => {
		const user = userEvent.setup();
		const onClear = vi.fn();
		const { rerender } = render(
			<SelectionBar label={null} onClear={onClear} />,
		);
		expect(screen.queryByTestId("selection-bar")).toBeNull();
		rerender(<SelectionBar label="3 records" onClear={onClear} />);
		expect(screen.getByText("3 records")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Clear selection" }));
		expect(onClear).toHaveBeenCalledOnce();
	});
});
