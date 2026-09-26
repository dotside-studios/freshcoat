import { render, screen } from "@testing-library/react";
import { ProgressBar } from "../progress";

describe("ProgressBar", () => {
	it("exposes aria values and the formatted value", () => {
		render(
			<ProgressBar
				label="Exporting"
				value={64}
				minValue={0}
				maxValue={120}
				valueLabel="64 / 120"
			/>,
		);
		const bar = screen.getByRole("progressbar", { name: "Exporting" });
		expect(bar.getAttribute("aria-valuenow")).toBe("64");
		expect(bar.getAttribute("aria-valuemin")).toBe("0");
		expect(bar.getAttribute("aria-valuemax")).toBe("120");
		expect(bar.getAttribute("aria-valuetext")).toBe("64 / 120");
		expect(bar.textContent).toContain("64 / 120");
	});

	it("omits aria-valuenow when indeterminate", () => {
		render(<ProgressBar aria-label="Loading" isIndeterminate tone="success" />);
		const bar = screen.getByRole("progressbar", { name: "Loading" });
		expect(bar.hasAttribute("aria-valuenow")).toBe(false);
	});

	it("defaults to a percentage value text", () => {
		render(<ProgressBar aria-label="Done" value={25} />);
		expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe(
			"25%",
		);
	});
});
