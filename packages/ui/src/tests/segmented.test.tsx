import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { Key } from "react-aria-components";
import { SegmentedControl, SegmentedItem } from "../segmented";

function Switcher({ onChange }: { onChange: (key: Key) => void }) {
	const [section, setSection] = useState<Key>("edit");
	return (
		<SegmentedControl
			aria-label="Section"
			selectedKey={section}
			onSelectionChange={(key) => {
				setSection(key);
				onChange(key);
			}}
		>
			<SegmentedItem id="edit" shortcut="Mod+1">
				Edit
			</SegmentedItem>
			<SegmentedItem id="data" shortcut="Mod+2">
				Data
			</SegmentedItem>
			<SegmentedItem id="export" shortcut="Mod+3">
				Export
			</SegmentedItem>
		</SegmentedControl>
	);
}

describe("SegmentedControl", () => {
	it("reports the new key and keeps one item selected", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Switcher onChange={onChange} />);
		const pressed = () =>
			screen
				.getAllByRole("radio")
				.filter((b) => b.getAttribute("aria-checked") === "true")
				.map((b) => b.textContent);
		expect(pressed()).toEqual(["Edit"]);

		await user.click(screen.getByRole("radio", { name: "Data" }));
		expect(onChange).toHaveBeenLastCalledWith("data");
		expect(pressed()).toEqual(["Data"]);

		// Clicking the selected item does not empty the selection.
		await user.click(screen.getByRole("radio", { name: "Data" }));
		expect(pressed()).toEqual(["Data"]);
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
