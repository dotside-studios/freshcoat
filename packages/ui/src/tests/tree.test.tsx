import { render, screen } from "@testing-library/react";
import { Tree, TreeItem } from "../tree";

describe("Tree", () => {
	it("renders rows with nesting levels", () => {
		render(
			<Tree aria-label="Layers" defaultExpandedKeys={["group"]}>
				<TreeItem id="title" textValue="title" label="title" />
				<TreeItem id="group" textValue="group" label="group">
					<TreeItem id="child" textValue="child" label="child" />
				</TreeItem>
				<TreeItem id="bg" textValue="background" label="background" />
			</Tree>,
		);
		const rows = screen.getAllByRole("row");
		expect(rows.map((r) => r.textContent)).toEqual([
			"title",
			"group",
			"child",
			"background",
		]);
		expect(rows.map((r) => r.getAttribute("aria-level"))).toEqual([
			"1",
			"1",
			"2",
			"1",
		]);
		expect(rows[1]?.getAttribute("aria-expanded")).toBe("true");
	});

	it("renders the actions slot with row state", () => {
		render(
			<Tree
				aria-label="Layers"
				selectionMode="single"
				defaultSelectedKeys={["a"]}
			>
				<TreeItem
					id="a"
					textValue="a"
					label="a"
					actions={({ isSelected }) => (
						<span data-testid="state">{isSelected ? "on" : "off"}</span>
					)}
				/>
			</Tree>,
		);
		expect(screen.getByTestId("state").textContent).toBe("on");
	});
});
