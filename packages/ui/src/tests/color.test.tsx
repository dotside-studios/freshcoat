import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseColor } from "react-aria-components";
import {
	ColorInput,
	colorToHex,
	resolveColorText,
	tryParseColor,
} from "../color";

describe("colour parsing", () => {
	it("round-trips hex with and without alpha", () => {
		expect(colorToHex(parseColor("#2F7CF6"))).toBe("#2f7cf6");
		const withAlpha = tryParseColor("#2f7cf680");
		expect(withAlpha).not.toBeNull();
		expect(colorToHex(withAlpha as NonNullable<typeof withAlpha>)).toBe(
			"#2f7cf680",
		);
	});

	it("does not parse tokens", () => {
		expect(tryParseColor("{{brand_color}}")).toBeNull();
	});

	it("resolves typed text", () => {
		expect(resolveColorText("ff0000")).toBe("#ff0000");
		expect(resolveColorText("#f00")).toBe("#ff0000");
		expect(resolveColorText("rgba(0, 0, 255, 0.5)")).toBe("#0000ff80");
		expect(resolveColorText("{{accent}}")).toBe("{{accent}}");
		expect(resolveColorText("   ")).toBeNull();
	});
});

describe("ColorInput", () => {
	it("shows an unparseable value raw and leaves it untouched", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(
			<ColorInput
				aria-label="Fill"
				value="{{brand_color}}"
				onChange={onChange}
			/>,
		);
		const input = screen.getByRole("textbox", { name: "Fill" });
		expect(input).toHaveProperty("value", "{{brand_color}}");
		await user.click(input);
		await user.tab();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("emits hex for typed colours and passes tokens through", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const onCommit = vi.fn();
		render(
			<ColorInput
				aria-label="Fill"
				value="#000000"
				onChange={onChange}
				onCommit={onCommit}
			/>,
		);
		const input = screen.getByRole("textbox", { name: "Fill" });
		await user.click(input);
		await user.clear(input);
		await user.type(input, "2F7CF680{Enter}");
		expect(onChange).toHaveBeenLastCalledWith("#2f7cf680");
		expect(onCommit).toHaveBeenCalledTimes(1);
		await user.clear(input);
		await user.type(input, "{{{{x}}{Enter}");
		expect(onChange).toHaveBeenLastCalledWith("{{x}}");
	});

	it("reverts on Escape", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(
			<ColorInput aria-label="Fill" value="#123456" onChange={onChange} />,
		);
		const input = screen.getByRole("textbox", { name: "Fill" });
		await user.click(input);
		await user.clear(input);
		await user.type(input, "ffffff");
		await user.keyboard("{Escape}");
		expect(input).toHaveProperty("value", "#123456");
		await user.tab();
		expect(onChange).not.toHaveBeenCalled();
	});
});
